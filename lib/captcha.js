import axios from 'axios';
import { log, sleep } from './utils.js';

// ==========================================
// CAPSOLVER CONFIGURATION
// ==========================================

const CAPSOLVER_API = 'https://api.capsolver.com';

// ==========================================
// CAPTCHA SOLVER
// ==========================================

/**
 * Solve reCAPTCHA v2 Invisible using CapSolver
 * @param {string} apiKey - CapSolver API key
 * @param {string} websiteURL - The URL where captcha appears
 * @param {string} websiteKey - reCAPTCHA site key
 * @param {object} options - Optional config
 * @param {boolean} options.verbose - Whether to log progress (default: true)
 * @returns {string} g-recaptcha-response token
 */
export async function solveCaptcha(apiKey, websiteURL, websiteKey, options = {}) {
    const verbose = options.verbose !== false; // Default true

    if (verbose) log.step('🧩 Solving reCAPTCHA via CapSolver...');

    // Try different configurations if one fails
    const configs = [
        { type: 'ReCaptchaV2TaskProxyLess', isInvisible: true, label: 'V2 Invisible' },
        { type: 'ReCaptchaV2TaskProxyLess', isInvisible: false, label: 'V2 Checkbox' },
        { type: 'ReCaptchaV2EnterpriseTaskProxyLess', isInvisible: true, label: 'V2 Enterprise' },
    ];

    for (const cfg of configs) {
        if (verbose) log.info(`[i] Trying: ${cfg.label}...`);

        let taskId;
        try {
            const taskData = {
                type: cfg.type,
                websiteURL: websiteURL,
                websiteKey: websiteKey,
            };
            if (cfg.type.includes('V2')) {
                taskData.isInvisible = cfg.isInvisible;
            }

            const createRes = await axios.post(`${CAPSOLVER_API}/createTask`, {
                clientKey: apiKey,
                task: taskData
            }, { timeout: 15000 });

            if (createRes.data.errorId !== 0) {
                if (verbose) log.warn(`[!] ${cfg.label} failed: ${createRes.data.errorDescription}`);
                continue; // Try next config
            }

            taskId = createRes.data.taskId;
            if (verbose) log.info(`[i] Task Created: ${taskId}`);
        } catch (e) {
            const errMsg = e.response?.data?.errorDescription || e.message;
            if (verbose) log.warn(`[!] ${cfg.label} create failed: ${errMsg}`);
            continue; // Try next config
        }

        // Poll for result
        const MAX_WAIT = 120;
        const POLL_INTERVAL = 3000;
        const startTime = Date.now();

        while (true) {
            const elapsed = (Date.now() - startTime) / 1000;
            if (elapsed > MAX_WAIT) {
                if (verbose) log.warn(`[!] ${cfg.label} timed out after ${MAX_WAIT}s`);
                break; // Try next config
            }

            await sleep(POLL_INTERVAL);

            try {
                const resultRes = await axios.post(`${CAPSOLVER_API}/getTaskResult`, {
                    clientKey: apiKey,
                    taskId: taskId
                }, { timeout: 10000 });

                if (resultRes.data.errorId !== 0) {
                    if (verbose) log.warn(`[!] ${cfg.label} result error: ${resultRes.data.errorDescription}`);
                    break; // Try next config
                }

                if (resultRes.data.status === 'ready') {
                    const token = resultRes.data.solution.gRecaptchaResponse;
                    if (verbose) log.success(`[+] Captcha Solved with ${cfg.label}! (${elapsed.toFixed(1)}s)`);
                    return token;
                }

                if (verbose) log.info(`[...] Solving (${cfg.label})... ${elapsed.toFixed(0)}s`);

            } catch (e) {
                if (verbose) log.warn(`[!] Poll error: ${e.message}`);
                break;
            }
        }
    }

    throw new Error('All captcha solving methods failed');
}

/**
 * Check CapSolver balance
 * @param {string} apiKey 
 * @returns {number} balance
 */
export async function checkBalance(apiKey) {
    try {
        const res = await axios.post(`${CAPSOLVER_API}/getBalance`, {
            clientKey: apiKey
        }, { timeout: 10000 });

        if (res.data.errorId !== 0) {
            throw new Error(res.data.errorDescription || 'Unknown error');
        }

        return res.data.balance;
    } catch (e) {
        if (e.response) {
            throw new Error(`Balance check failed: ${e.response.status}`);
        }
        throw e;
    }
}
