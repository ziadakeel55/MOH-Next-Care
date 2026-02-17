
import { parentPort, workerData } from 'worker_threads';
import { getAcceptClient } from './client.js';

// Optimizations:
// 1. Pre-load everything.
// 2. Keep socket open.
// 3. Busy-wait at the very end.

const { token, cookie, caseId, fileId, targetTimeMs, offsetMs = 0 } = workerData;
const client = getAcceptClient(token, cookie);
const url = `https://weslah.seha.sa/api/referrals/${caseId}/accept-json`;
const body = JSON.stringify({ accept: true, file: fileId });

// Calculate effective fire time (Target - Offset)
const fireTimeMs = targetTimeMs - offsetMs;
const logPrefix = `[Worker ${offsetMs}ms]`;

// WARM UP
(async () => {
    try {
        // Light ping to open socket
        await client.get('https://weslah.seha.sa/api/referrals/facility/tabs');
        parentPort.postMessage('ready');
    } catch (e) {
        // Even if it fails, we proceed
        parentPort.postMessage('ready');
    }

    // BUSY WAIT
    while (Date.now() < fireTimeMs) {
        // Spin
    }

    // FIRE
    try {
        const response = await client.post(url, body);
        parentPort.postMessage({ success: true, data: response.data, firedAt: Date.now(), offset: offsetMs });
    } catch (e) {
        parentPort.postMessage({ success: false, error: e.message, firedAt: Date.now(), offset: offsetMs });
    }
})();
