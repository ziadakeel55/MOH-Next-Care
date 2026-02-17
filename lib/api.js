import fs from 'fs';
import { log, sleep } from './utils.js';
import { getClient } from './client.js';

const CORE_API = 'https://weslah.seha.sa/api';

export async function uploadFile(token, cookie, filePath, mimeType = 'application/pdf') {
    log.step('Starting File Upload...');

    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileName = filePath.split(/[\\/]/).pop();

    // Manual Multipart for Axios without extra deps
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    let postData = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
        fileBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);

    const client = getClient(token, cookie);
    // Custom Headers for Upload
    const headers = {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
    };

    const maxRetries = 5;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await client.post(`${CORE_API}/attachments/upload`, postData, { headers });

            if (response.status === 200 || response.status === 201) {
                log.success(`File Uploaded! ID: ${response.data.id}`);
                return response.data.id;
            }
        } catch (e) {
            log.warn(`Upload attempt ${i + 1} failed: ${e.message}`);
        }
        await sleep(1000);
    }
    throw new Error('Failed to upload file after multiple attempts');
}

export async function acceptCaseBurst(token, cookie, caseId, fileId, concurrency = 5) {
    log.step(`Starting BURST ACCEPTANCE for Case ${caseId}...`);
    log.info(`Concurrency: ${concurrency} threads | Zero-Latency Mode`);

    const url = `${CORE_API}/referrals/${caseId}/accept-json`;

    // PERF: Pre-stringify body ONCE (V1.6 strategy) — avoids JSON.stringify per request
    const bodyStr = JSON.stringify({ accept: true, file: fileId });

    // PERF: Dedicated fast client with keep-alive & no timeout
    const { getAcceptClient } = await import('./client.js');
    const fastClient = getAcceptClient(token, cookie);

    let accepted = false;
    let attempts = 0;

    const worker = async (id) => {
        while (!accepted) {
            attempts++;
            try {
                // HOT PATH: No logs, no sleep, just fire
                const response = await fastClient.post(url, bodyStr);

                // Fast success check (same as V1.6: check message field)
                if (response.status === 200 && response.data && response.data.message && !accepted) {
                    accepted = true;
                    log.success(`CASE ACCEPTED! Thread ${id} hit the target. (${attempts} total attempts)`);
                    return response.data;
                }

                // Auth failure: refresh token inline, don't kill worker  
                if (response.status === 401 || response.status === 403) {
                    log.warn(`Thread ${id}: Token expired, refreshing...`);
                    try {
                        const { validateAndRefreshToken } = await import('./auth.js');
                        const { loadConfig, getAuthCookieString } = await import('./config.js');
                        const config = loadConfig();
                        const newToken = await validateAndRefreshToken(token, getAuthCookieString(config.cookie || config.COOKIES), config.username, false);
                        if (newToken) {
                            token = newToken;
                            fastClient.defaults.headers['Authorization'] = `Bearer ${newToken}`;
                        }
                    } catch (_) { /* continue anyway */ }
                    continue;
                }

                // All other errors: continue immediately (zero delay, like V1.6)
                continue;

            } catch (e) {
                // Network error: retry immediately, no sleep (V1.6 strategy)
                continue;
            }
        }
    };

    const pool = [];
    for (let i = 0; i < concurrency; i++) {
        pool.push(worker(i));
    }

    await Promise.race(pool);
    log.info(`Burst finished. Total attempts across all threads: ${attempts}`);
    return accepted;
}

export async function getCaseDetails(token, cookie, caseId) {
    try {
        const client = getClient(token, cookie);
        const response = await client.get(`${CORE_API}/referrals/${caseId}`);
        return response.data;
    } catch (e) {
        throw e;
    }
}

export async function getReferrals(token, cookie, tab = 1, page = 1) {
    try {
        const client = getClient(token, cookie);

        const response = await client.post(`${CORE_API}/referrals/facility/tabs`, {
            pageNumber: page,
            pageSize: 10,
            sortField: "createdDate",
            sortDirection: "DESC",
            tab: tab
        });

        const raw = response.data;
        let items =
            (raw && Array.isArray(raw.items) && raw.items) ||
            (raw && Array.isArray(raw.data?.items) && raw.data.items) ||
            (raw && Array.isArray(raw.data?.data) && raw.data.data) ||
            (raw && Array.isArray(raw.data) && raw.data) ||
            (raw && Array.isArray(raw.result?.items) && raw.result.items) ||
            (raw && Array.isArray(raw.result?.data) && raw.result.data) ||
            (Array.isArray(raw) ? raw : []);

        // Compute openTime from broadcastedAt (like V1.6: broadcastedAt + 15 minutes)
        const WAIT_TIME_MS = 15 * 60 * 1000; // 15 minutes
        items = items.map(item => {
            if (item.broadcastedAt) {
                // FORCE KSA TIMEZONE (UTC+3)
                // The API returns strings like "2026-02-15 22:47:24" which are KSA time.
                // If we do new Date("..."), it assumes Local Time.
                // On a UTC server, this is interpreted as UTC, making the time 3 hours earlier than KSA.
                // Solution: Parse string and force offset +03:00.
                
                let timeStr = item.broadcastedAt.replace(' ', 'T'); // "2026-02-15T22:47:24"
                if (!timeStr.includes('+')) {
                    timeStr += '+03:00'; // Force KSA Offset
                }

                const broadcast = new Date(timeStr);
                item.openTime = new Date(broadcast.getTime() + WAIT_TIME_MS);
            }
            return item;
        });

        return { ...raw, items };
    } catch (e) {
        throw e;
    }
}

export async function getAllReferrals(token, cookie, tab = 2) {
    let allItems = [];
    let page = 1;
    let hasMore = true;
    let totalCount = 0;
    const MAX_PAGES = 50; // Safety limit

    while (hasMore && page <= MAX_PAGES) {
        try {
            const data = await getReferrals(token, cookie, tab, page);

            // Capture total count from first page response
            if (page === 1) {
                totalCount = data.totalCount || data.count || data.total || 0;
                // If nested structure found in probe script (not run, but safe assumption based on common patterns)
                if (!totalCount && data.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
                    totalCount = data.data.totalCount || 0;
                }
            }

            const items = data.items || [];
            if (items.length === 0) {
                hasMore = false;
            } else {
                allItems = allItems.concat(items);
                // Simple heuristic: if fewer items than pageSize (10), we are done.
                if (items.length < 10) {
                    hasMore = false;
                } else {
                    page++;
                }
            }
        } catch (e) {
            // Stop on error
            hasMore = false;
        }
    }

    return { items: allItems, totalCount: Math.max(totalCount, allItems.length) };
}
