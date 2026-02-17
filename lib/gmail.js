
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import chalk from 'chalk';
import { log } from './utils.js';

const IMAP_CONFIG = {
    user: '',
    password: '',
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
};

/**
 * Starts monitoring Gmail for the NEXT OTP email.
 * Returns an object with promises to coordinate the flow.
 * @param {string} email 
 * @param {string} appPassword 
 * @param {number} timeoutMs 
 */
export function monitorInbox(email, appPassword, timeoutMs = 60000) {
    let imap;
    let timeoutHandle;

    // Controller object to return
    const controller = {
        ready: null,      // Promise resolves when IMAP is connected and listening
        otpPromise: null, // Promise resolves when OTP is found
        stop: null        // Function to abort/cleanup
    };

    controller.otpPromise = new Promise((resolve, reject) => {
        if (!email || !appPassword) {
            return reject(new Error("Missing Gmail credentials"));
        }

        imap = new Imap({
            ...IMAP_CONFIG,
            user: email,
            password: appPassword
        });

        // Cleanup helper
        const cleanup = () => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            try { imap.end(); } catch (e) { }
        };
        controller.stop = cleanup;

        // Timeout safety
        timeoutHandle = setTimeout(() => {
            cleanup();
            reject(new Error("Gmail detection timed out"));
        }, timeoutMs);

        // Store resolve/reject for internal use
        const finish = (code) => {
            cleanup();
            resolve(code);
        };

        controller.ready = new Promise((resolveReady, rejectReady) => {
            imap.once('ready', () => {
                imap.openBox('INBOX', false, (err, box) => {
                    if (err) {
                        cleanup();
                        const e = new Error("Inbox Error: " + err.message);
                        reject(e);
                        rejectReady(e);
                        return;
                    }

                    // We are ready to listen!
                    resolveReady();

                    // METHOD 1: Listen for 'mail' event (Real-time new emails)
                    imap.on('mail', (numNew) => {
                        // Fetch the new message(s)
                        // 'box.messages.total' might be updated.
                        // We fetch from the last known count or total.
                        // Ideally fetching the last few is safest.
                        const fetch = imap.seq.fetch(box.messages.total + ':*', {
                            bodies: '',
                            struct: true
                        });

                        fetch.on('message', (msg) => {
                            msg.on('body', (stream) => {
                                simpleParser(stream, async (err, parsed) => {
                                    if (err) return;
                                    const code = extractOTP(parsed);
                                    if (code) finish(code);
                                });
                            });
                        });
                    });
                });
            });

            imap.once('error', (err) => {
                cleanup();
                const e = new Error("IMAP Connection Error: " + err.message);
                reject(e);
                rejectReady(e);
            });

            // Connect
            try {
                imap.connect();
            } catch (e) {
                rejectReady(e);
            }
        });
    });

    return controller;
}

function extractOTP(parsed) {
    const subject = (parsed.subject || '').toLowerCase();
    const text = (parsed.text || '').toLowerCase();
    const html = (parsed.html || '').toLowerCase();
    const fullBody = text + html;
    const fullContent = subject + fullBody;

    const isRelevant =
        fullContent.includes('seha') ||
        fullContent.includes('صحة') ||
        fullContent.includes('verification') ||
        fullContent.includes('التحقق');

    if (isRelevant) {
        // "رمز التحقق 1873" or "code is 1234"
        const codeMatch = fullBody.match(/\b\d{4,6}\b/);
        if (codeMatch) {
            return codeMatch[0];
        }
    }
    return null;
}

// Helper for simple fetch (backward compatible logic but using monitor with short timeout)
export function getLatestOTP(email, appPassword) {
    // Requires a slight hack: monitorInbox waits for NEW mail. 
    // To fetch EXISTING mail, we need a different approach or just use the old logic.
    // Given the user wants "monitor before sending", we primarily use monitorInbox.
    // But for "fetch existing" (e.g. if code already arrived), we might need the old logic.
    // Let's bring back the "Fetch Last 5" logic as a fallback function.

    return fetchRecentOTP(email, appPassword);
}

function fetchRecentOTP(email, appPassword) {
    return new Promise((resolve, reject) => {
        const imap = new Imap({
            ...IMAP_CONFIG,
            user: email,
            password: appPassword
        });

        const timeout = setTimeout(() => {
            imap.end();
            resolve(null);
        }, 15000);

        imap.once('ready', function () {
            imap.openBox('INBOX', true, function (err, box) {
                if (err) { imap.end(); return resolve(null); }

                const fetchRange = (box.messages.total - 4) + ':' + box.messages.total;
                const f = imap.seq.fetch(fetchRange, { bodies: '', struct: true });

                let candidates = [];
                let activeParsers = 0;

                f.on('message', function (msg) {
                    msg.on('body', function (stream) {
                        activeParsers++;
                        simpleParser(stream, async (err, parsed) => {
                            activeParsers--;
                            const code = extractOTP(parsed);
                            if (code) {
                                candidates.push({ code, date: new Date(parsed.date) });
                            }
                        });
                    });
                });

                f.once('end', function () {
                    const checkDone = setInterval(() => {
                        if (activeParsers === 0) {
                            clearInterval(checkDone);
                            imap.end();
                            clearTimeout(timeout);
                            if (candidates.length > 0) {
                                candidates.sort((a, b) => b.date - a.date);
                                resolve(candidates[0].code);
                            } else {
                                resolve(null);
                            }
                        }
                    }, 500);
                });
            });
        });

        imap.once('error', () => resolve(null));
        imap.connect();
    });
}
