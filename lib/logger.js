import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log as utilsLog } from './utils.js';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- SESSION LOGGING WRAPPER ---
export const sessionLogs = [];
let currentLogPath = null;

const getHighResTime = () => {
    const d = new Date();
    return `${d.toLocaleTimeString('en-US', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

const getTimestamp = () => {
    return new Date().toISOString();
};

const appendToLog = (entry) => {
    sessionLogs.push(entry);
    if (currentLogPath) {
        try {
            fs.appendFileSync(currentLogPath, entry + '\n', 'utf8');
        } catch (e) {
            console.error('Failed to append to log:', e.message);
        }
    }
};

export const sessionLogger = {
    // Standard logs
    info: (msg) => { utilsLog.info(msg); appendToLog(`[${getHighResTime()}] [INFO]    ${msg}`); },
    success: (msg) => { utilsLog.success(msg); appendToLog(`[${getHighResTime()}] [SUCCESS] ${msg}`); },
    warn: (msg) => { utilsLog.warn(msg); appendToLog(`[${getHighResTime()}] [WARN]    ${msg}`); },
    error: (msg) => { utilsLog.error(msg); appendToLog(`[${getHighResTime()}] [ERROR]   ${msg}`); },
    step: (msg) => { utilsLog.step(msg); appendToLog(`[${getHighResTime()}] [STEP]    ${msg}`); },
    data: (k, v) => { utilsLog.data(k, v); appendToLog(`[${getHighResTime()}] [DATA]    ${k}: ${v}`); },

    // Silent variants (file only)
    logInfo: (msg) => { appendToLog(`[${getHighResTime()}] [INFO]    ${msg}`); },
    logData: (k, v) => { appendToLog(`[${getHighResTime()}] [DATA]    ${k}: ${v}`); },
    logVerbose: (msg) => { appendToLog(`[${getHighResTime()}] [DEBUG]   ${msg}`); },

    // Structured Logging
    section: (title) => {
        const line = "=".repeat(60);
        appendToLog(`\n${line}`);
        appendToLog(`[${getHighResTime()}] >>> SECTION: ${title.toUpperCase()}`);
        appendToLog(`${line}`);
    },

    input: (prompt, value) => {
        appendToLog(`[${getHighResTime()}] [USER INPUT]`);
        appendToLog(`    Prompt: ${prompt}`);
        appendToLog(`    Value:  ${value}`);
        appendToLog(`    Time:   ${getTimestamp()}`);
    },

    apiResponse: (endpoint, status, dataSummary) => {
        appendToLog(`[${getHighResTime()}] [SYSTEM RESPONSE]`);
        appendToLog(`    Endpoint: ${endpoint}`);
        appendToLog(`    Status:   ${status}`);
        appendToLog(`    Data:     ${typeof dataSummary === 'object' ? JSON.stringify(dataSummary) : dataSummary}`);
    },

    clear: () => {
        sessionLogs.length = 0;
        currentLogPath = null;
    }
};

export function initLiveLog(patientName) {
    // Sanitize filename: Allow Arabic, remove only Windows reserved chars (< > : " / \ | ? *)
    const safeName = (patientName || "session").replace(/[<>:"/\\|?*]+/g, '_');

    // Ensure session/logs directory exists
    const sessionDir = path.join(process.cwd(), 'session');
    const logsDir = path.join(sessionDir, 'logs');

    if (!fs.existsSync(sessionDir)) { try { fs.mkdirSync(sessionDir); } catch (e) { } }
    if (!fs.existsSync(logsDir)) { try { fs.mkdirSync(logsDir); } catch (e) { } }

    const filename = path.join(logsDir, `${safeName}_full_debug_log.txt`);
    currentLogPath = filename;

    // Build Header
    const timestamp = new Date().toISOString();
    const header = [
        "============================================================",
        "              SEHA AUTOMATION - SESSION LOG                 ",
        "============================================================",
        `Session ID:   ${timestamp}-${Math.floor(Math.random() * 1000)}`,
        `Patient:      ${patientName}`,
        `Start Time:   ${getHighResTime()}`,
        "============================================================",
        ""
    ];

    // Write header and existing buffered logs
    const content = header.join('\n') + '\n' + sessionLogs.join('\n') + '\n';

    try {
        fs.writeFileSync(filename, content, 'utf8');
        console.log(chalk.gray(`\n📝 Live logging active: session/logs/${path.basename(filename)}`));
    } catch (e) {
        console.error("Failed to init live log:", e.message);
        currentLogPath = null; // Fallback to memory only
    }
}

export function saveDebugLog(sessionName, mode = "UNKNOWN") {
    // If live logging was active, just append footer
    if (currentLogPath) {
        const footer = [
            "",
            "============================================================",
            "                  END OF SESSION LOG                        ",
            "============================================================"
        ].join('\n');
        try {
            fs.appendFileSync(currentLogPath, footer + '\n', 'utf8');
            console.log(chalk.gray(`\n📝 Session log finalized: session/logs/${path.basename(currentLogPath)}`));
        } catch (e) { }
        return;
    }

    // Fallback for non-live sessions (e.g. errors before case selection)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeName = (sessionName || "session").replace(/[<>:"/\\|?*]+/g, '_');

    const sessionDir = path.join(process.cwd(), 'session');
    const logsDir = path.join(sessionDir, 'logs');
    if (!fs.existsSync(sessionDir)) { try { fs.mkdirSync(sessionDir); } catch (e) { } }
    if (!fs.existsSync(logsDir)) { try { fs.mkdirSync(logsDir); } catch (e) { } }

    const filename = path.join(logsDir, `SESSION_${timestamp}_${safeName}.log`);
    const content = sessionLogs.join('\n');

    try {
        fs.writeFileSync(filename, content, 'utf8');
        console.log(chalk.gray(`\n📝 Detailed session log saved to: session/logs/${path.basename(filename)}`));
    } catch (e) {
        console.error("Failed to save debug log:", e.message);
    }
}

// Backward compatibility
export function debugLog(msg, data = null) { }

export function fullLog(tag, msg, data = null) {
    sessionLogger.info(`[${tag}] ${msg}`);
}

export function mirrorConsoleToFullLog() { }
