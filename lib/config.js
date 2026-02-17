import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_DIR = path.join(__dirname, '..', 'session');
const DATA_DIR = path.join(__dirname, '..', 'data');

const SESSION_FILE = path.join(SESSION_DIR, 'session.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
}
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ─── Redis Client (lazy singleton) ──────────────────────────────────────────
let _redis = null;

async function getRedis() {
    if (_redis) return _redis;
    if (!process.env.REDIS_URL) return null;
    try {
        const { default: Redis } = await import('ioredis');
        _redis = new Redis(process.env.REDIS_URL, {
            maxRetriesPerRequest: 3,
            retryStrategy: (times) => Math.min(times * 200, 2000),
        });
        _redis.on('error', (err) => console.error('[Redis] Connection error:', err.message));
        return _redis;
    } catch (e) {
        console.error('[Redis] Failed to initialize:', e.message);
        return null;
    }
}

// ─── Storage abstraction ─────────────────────────────────────────────────────

async function readStore(key, filePath) {
    const redis = await getRedis();
    if (redis) {
        try {
            const val = await redis.get(key);
            return val ? JSON.parse(val) : null;
        } catch (e) {
            console.error(`[Redis] Read error for "${key}":`, e.message);
            return null;
        }
    }
    // File fallback
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return null;
    }
}

async function writeStore(key, filePath, data) {
    const redis = await getRedis();
    if (redis) {
        try {
            await redis.set(key, JSON.stringify(data));
            return;
        } catch (e) {
            console.error(`[Redis] Write error for "${key}":`, e.message);
        }
    }
    // File fallback
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ─── Cookie helpers (unchanged) ──────────────────────────────────────────────

/** تحويل سلسلة Cookie (name=val; name2=val2) إلى كائن للقراءة والحفظ الصحيح */
function cookieStringToObject(str) {
    if (!str || typeof str !== 'string') return {};
    const out = {};
    for (const part of str.split(';').map(s => s.trim())) {
        if (!part) continue;
        const eq = part.indexOf('=');
        if (eq > 0) {
            const name = part.slice(0, eq).trim();
            const value = part.slice(eq + 1).trim();
            if (name) out[name] = value;
        }
    }
    return out;
}

/** تحويل كائن الكوكيز إلى سلسلة للرأس Cookie */
function cookieObjectToString(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj.trim();
    return Object.entries(obj)
        .filter(([k, v]) => k && v != null)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
}

/** أسماء الكوكيز المستخدمة للتحقق من الجلسة وطلبات الـ API فقط (بدون كوكيز إضافية) */
const AUTH_COOKIE_NAMES = ['__cf_bm', 'AuthToken', 'JWTUserToken'];

export function getAuthCookieString(cookie) {
    if (!cookie) return '';
    const obj = typeof cookie === 'string' ? cookieStringToObject(cookie) : cookie;
    if (!obj || typeof obj !== 'object') return '';
    const out = {};
    for (const name of AUTH_COOKIE_NAMES) {
        if (obj[name] != null && obj[name] !== '') out[name] = obj[name];
    }
    return cookieObjectToString(out);
}

// ─── Normalization helpers (unchanged) ───────────────────────────────────────

function normalizeMerged(config) {
    if (!config) return config;
    const next = { ...config };
    if (!next.token && next.JWT_TOKEN) next.token = next.JWT_TOKEN;
    if (!next.cookie && next.COOKIES) next.cookie = next.COOKIES;
    if (!next.username && next.USERNAME) next.username = next.USERNAME;
    if (next.token && !next.JWT_TOKEN) next.JWT_TOKEN = next.token;
    if (next.cookie && !next.COOKIES) next.COOKIES = next.cookie;
    if (next.username && !next.USERNAME) next.USERNAME = next.username;
    return next;
}

function splitData(data) {
    const session = {};
    const token = data.JWT_TOKEN ?? data.token;
    let cookie = data.COOKIES ?? data.cookie;
    const username = data.USERNAME ?? data.username;
    if (token) session.JWT_TOKEN = token;
    if (cookie) {
        session.COOKIES = typeof cookie === 'object' && !Array.isArray(cookie)
            ? cookie
            : cookieStringToObject(cookie);
    }
    if (username) session.USERNAME = username;

    const config = { ...data };
    delete config.JWT_TOKEN;
    delete config.token;
    delete config.COOKIES;
    delete config.cookie;
    delete config.USERNAME;
    delete config.username;

    if (username) config.USERNAME = username;
    return { session, config };
}

function migrateLegacy(sessionRaw, configRaw) {
    const merged = normalizeMerged({ ...configRaw, ...sessionRaw });
    return splitData(merged);
}

// ─── Public API (NOW ASYNC) ──────────────────────────────────────────────────

export async function saveConfig(data) {
    const sessionRaw = (await readStore('session', SESSION_FILE)) || {};
    const configRaw = (await readStore('config', CONFIG_FILE)) || {};

    // Fix: Ensure new values overwrite old legacy keys
    const update = { ...data };
    if (update.token) update.JWT_TOKEN = update.token;
    if (update.cookie) update.COOKIES = update.cookie;
    if (update.username) update.USERNAME = update.username;

    const { session, config } = splitData(normalizeMerged({ ...sessionRaw, ...configRaw, ...update }));
    await writeStore('session', SESSION_FILE, session);
    await writeStore('config', CONFIG_FILE, config);
}

export async function loadConfig() {
    const sessionRaw = (await readStore('session', SESSION_FILE)) || {};
    const configRaw = (await readStore('config', CONFIG_FILE)) || {};
    const { session, config } = migrateLegacy(sessionRaw, configRaw);

    // Write back only if changed or empty? For now just keep sync behavior
    if (Object.keys(session).length > 0) await writeStore('session', SESSION_FILE, session);
    if (Object.keys(config).length > 0) await writeStore('config', CONFIG_FILE, config);

    const merged = { ...config, ...session };

    // --- Merge Environment Variables (Highest Priority) ---
    if (process.env.SEHA_TOKEN) merged.token = process.env.SEHA_TOKEN;
    if (process.env.SEHA_USERNAME) merged.username = process.env.SEHA_USERNAME;
    if (process.env.SEHA_PASSWORD) merged.password = process.env.SEHA_PASSWORD;
    if (process.env.CAPSOLVER_KEY) merged.capsolver_key = process.env.CAPSOLVER_KEY;
    if (process.env.GMAIL_ADDRESS) merged.gmail_address = process.env.GMAIL_ADDRESS;
    if (process.env.GMAIL_APP_PASSWORD) merged.gmail_app_password = process.env.GMAIL_APP_PASSWORD;
    if (process.env.RECAPTCHA_KEY) merged.recaptcha_key = process.env.RECAPTCHA_KEY;
    // ---------------------------------------------------------

    if (Object.keys(merged).length === 0) return null;

    const out = normalizeMerged(merged);
    out.token = out.token ?? out.JWT_TOKEN;
    out.cookie = cookieObjectToString(out.cookie ?? out.COOKIES);
    out.username = out.username ?? out.USERNAME;
    return out;
}

export async function clearConfig() {
    const redis = await getRedis();
    if (redis) {
        try {
            await redis.del('session');
            await redis.del('config');
        } catch (e) {
            console.error('[Redis] Clear error:', e.message);
        }
    }
    if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
    if (fs.existsSync(CONFIG_FILE)) fs.unlinkSync(CONFIG_FILE);
}
