import inquirer from 'inquirer';
import ora from 'ora';
import { startSimulator } from './simulator.js';
import { checkSessionAndLogin } from './check_session.js';
import { startMonitor } from './monitor.js';
import { getReferrals, uploadFile, acceptCaseBurst } from './api.js';
import { loadConfig, getAuthCookieString, saveConfig } from './config.js';
import { generateReport } from './pdf.js';
import { C, printCaseHeader, drawSelectionTable, getTermWidth, BOX, centerAnsi } from './ui.js';
import { sleep, formatTime } from './utils.js';
import { validateAndRefreshToken } from './auth.js';
import { sessionLogger, saveDebugLog, initLiveLog } from './logger.js';
import chalk from 'chalk';
import { startDashboardServer } from './web_dashboard.js';

export async function startWizard() {
    console.clear();
    console.log(`${C.Bright}${C.Blue}========================================${C.Reset}`);
    console.log(`${C.Bright}${C.Blue}      MOH-Next-Care WIZARD (V2.0)       ${C.Reset}`);
    console.log(`${C.Bright}${C.Blue}========================================${C.Reset}\n`);

    sessionLogger.section("WIZARD STARTED");
    sessionLogger.info("Starting MOH-Next-Care Wizard (V2.0)");

    // 1. Check Session & Auto Login
    const isValid = await checkSessionAndLogin(false);
    if (!isValid) {
        console.log(`${C.Red}❌ Critical: Unable to establish a valid session.${C.Reset}`);
        sessionLogger.error("Critical: Unable to establish a valid session.");
        process.exit(1);
    }

    console.log("");

    // 2. Main Menu
    const answer = await inquirer.prompt([
        {
            type: 'rawlist',
            name: 'action',
            message: 'What would you like to do?',
            choices: [
                { name: '📊  Start Monitor (Live Dashboard)', value: 'monitor' },
                { name: '✅  Accept a Case (From Tab 1)', value: 'accept' },
                { name: '❌  Exit', value: 'exit' }
            ]
        }
    ]);

    sessionLogger.input("Main Menu Selection", answer.action);

    if (answer.action === 'monitor') {
        const url = await startDashboardServer();
        // Optional: print url here or let monitor do it
        await startMonitor();
    } else if (answer.action === 'accept') {
        await startAcceptFlow();
    } else {
        process.exit(0);
    }
}

async function startAcceptFlow() {
    console.clear();
    sessionLogger.clear(); // Reset logs for new session
    console.log(`${C.Bright}${C.Green}=== ACCEPT CASE WIZARD (BURST MODE) ===${C.Reset}\n`);

    sessionLogger.section("ACCEPT FLOW (REAL/WIZARD)");
    sessionLogger.info("Starting Accept Case Wizard (Burst Mode)");

    const spinner = ora('Fetching cases from Tab 1...').start();

    // Load credentials
    let config = await loadConfig();
    let token = config.token;
    let cookie = getAuthCookieString(config.cookie || config.COOKIES);

    // Timeline tracker for final summary
    const timeline = {
        broadcastedAt: null,
        openTime: null,
        uploadStart: null,
        uploadEnd: null,
        tokenStart: null,
        tokenEnd: null,
        burstStart: null,
        acceptedAt: null,
        totalAttempts: 0
    };

    try {
        const data = await getReferrals(token, cookie, 1); // Tab 1
        spinner.stop();

        sessionLogger.apiResponse("GetReferrals (Tab 1)", "200 OK", { count: data.items ? data.items.length : 0 });

        const items = data.items || [];

        if (items.length === 0) {
            console.log(`${C.Yellow}⚠️  No cases found in Tab 1.${C.Reset}`);
            sessionLogger.warn("No cases found in Tab 1.");
            return pauseAndRestart();
        }

        // --- PHASE 1: CASE SELECTION (Simulator-Style Table) ---
        drawSelectionTable(items, "📤 Available Referrals (Tab 1)");

        const { choiceNum } = await inquirer.prompt([{
            type: 'input',
            name: 'choiceNum',
            message: 'Select Case Index (or 0 to cancel):',
            validate: (val) => {
                const num = parseInt(val);
                if (val === '0' || val.toLowerCase() === 'cancel') return true;
                if (!isNaN(num) && num > 0 && num <= items.length) return true;
                return `Enter 1-${items.length} or 0 to cancel.`;
            }
        }]);

        sessionLogger.input("Select Case Index", choiceNum);

        if (choiceNum === '0' || choiceNum.toLowerCase() === 'cancel') {
            return startWizard();
        }

        const targetCase = items[parseInt(choiceNum) - 1];
        // Initialize live logging with patient name
        initLiveLog(targetCase.patientName);

        sessionLogger.info(`Selected Case: ${targetCase.patientName} (ID: ${targetCase.id})`);

        // Record broadcast/open times
        timeline.broadcastedAt = targetCase.broadcastedAt ? new Date(targetCase.broadcastedAt) : null;
        timeline.openTime = targetCase.openTime ? new Date(targetCase.openTime) : null;

        sessionLogger.data("Case ID", targetCase.id);
        sessionLogger.data("Patient Name", targetCase.patientName);
        sessionLogger.data("Broadcasted At", timeline.broadcastedAt ? timeline.broadcastedAt.toLocaleTimeString() : 'Unknown');
        sessionLogger.data("Opens At", timeline.openTime ? timeline.openTime.toLocaleTimeString() : 'NOW');

        // --- PHASE 2: DIAGNOSIS & PDF ---
        sessionLogger.section("DIAGNOSIS & PDF GENERATION");
        const { reviewDiagnosisData } = await import('./diagnosis.js');
        const reviewedData = await reviewDiagnosisData(targetCase);
        Object.assign(targetCase, reviewedData);
        sessionLogger.data("Reviewed Data Fields", Object.keys(reviewedData).length);

        let pdfFilename;
        const steps = { pdf: 'running', upload: 'pending', token: 'pending', accept: 'pending' };
        printCaseHeader(targetCase, "Generating Report...", steps);

        try {
            pdfFilename = await generateReport(null, reviewedData);
            steps.pdf = 'done';
            const displayPath = pdfFilename.split(/[\\/]/).pop();
            sessionLogger.success(`PDF Generated: ${displayPath}`);
            sessionLogger.apiResponse("System/GeneratePDF", "SUCCESS", { filename: displayPath });
        } catch (e) {
            console.log(`${C.Red}Report Generation Failed: ${e.message}${C.Reset}`);
            sessionLogger.error(`PDF Error: ${e.message}`);
            saveDebugLog(targetCase.patientName || 'error', "REAL_ERROR");
            return pauseAndRestart();
        }

        // --- PHASE 3: AUTO ACCEPT PROMPT ---
        printCaseHeader(targetCase, "Report Ready. Choose action:", steps);

        const { action } = await inquirer.prompt([{
            type: 'rawlist',
            name: 'action',
            message: timeline.openTime
                ? `Auto Accept at ${timeline.openTime.toLocaleTimeString()}?`
                : 'Start Auto Accept NOW?',
            choices: [
                { name: '✅  Auto Accept (Wait & Execute)', value: 'accept' },
                { name: '❌  Cancel', value: 'cancel' }
            ]
        }]);

        sessionLogger.input("Auto Accept Action", action);

        if (action === 'cancel') {
            sessionLogger.info("User cancelled.");
            saveDebugLog(targetCase.patientName || 'cancelled', "REAL_CANCELLED");
            return startWizard();
        }

        // --- PHASE 4: PRECISION COUNTDOWN ---
        sessionLogger.section("COUNTDOWN & EXECUTION");
        // Timeline: T-15s → Upload | T-10s → Token Refresh | T-0ms → BURST
        let targetTime;
        if (timeline.openTime && timeline.openTime > new Date()) {
            targetTime = timeline.openTime;
        } else {
            targetTime = new Date(); // Already open — execute immediately
        }

        sessionLogger.step(`Target burst time: ${targetTime.toLocaleTimeString()}`);
        sessionLogger.data("Time until burst", `${Math.ceil((targetTime - new Date()) / 1000)}s`);
        sessionLogger.logVerbose(`[DEBUG] Countdown Loop Init. Target: ${targetTime.toISOString()} | Current: ${new Date().toISOString()}`);

        let fileId = null;
        let tokenRefreshed = false;
        let uploaded = false;
        let lastPulse = Date.now();
        let lastKeepAlive = Date.now(); // Track last keep-alive
        let pulseBlink = false;

        const preCheckMs = targetTime - new Date();

        if (preCheckMs <= 0) {
            // Already passed — do everything NOW
            console.log(chalk.yellow("\n[!] Target time passed. Executing immediately..."));
            sessionLogger.warn("Target time already passed — immediate execution");

            // Upload
            timeline.uploadStart = new Date();
            sessionLogger.step("Emergency Upload...");
            try {
                fileId = await uploadFile(token, cookie, pdfFilename);
                uploaded = true;
                steps.upload = 'done';
                timeline.uploadEnd = new Date();
                sessionLogger.success(`Upload done in ${timeline.uploadEnd - timeline.uploadStart}ms`);
                sessionLogger.apiResponse("UploadFile", "SUCCESS", { fileId });
            } catch (e) {
                sessionLogger.error(`Upload Failed: ${e.message}`);
                sessionLogger.apiResponse("UploadFile", "FAILED", { error: e.message });
            }

            // Token refresh
            timeline.tokenStart = new Date();
            sessionLogger.step("Emergency Token Refresh...");
            try {
                const newToken = await validateAndRefreshToken(token, cookie, config.username, false);
                if (newToken) {
                    token = newToken;
                    if (token !== config.token) await saveConfig({ token });
                }
                tokenRefreshed = true;
                steps.token = 'done';
                timeline.tokenEnd = new Date();
                sessionLogger.success(`Token refreshed in ${timeline.tokenEnd - timeline.tokenStart}ms`);
            } catch (e) {
                sessionLogger.error(`Token Refresh Failed: ${e.message}`);
            }

        } else {
            // Normal countdown loop with precise triggers
            sessionLogger.logVerbose(`[DEBUG] Entering main wait loop. Pre-check: ${preCheckMs}ms`);

            while (true) {
                const current = new Date();
                const remainingMs = targetTime - current;
                const remainingSec = Math.ceil(remainingMs / 1000);

                // --- WARM-UP TRIGGER (T-2s) ---
                // Pre-open the connection so the burst doesn't pay the HANDSHAKE cost
                if (remainingMs <= 2000 && remainingMs > 1000 && !global.warmUpDone) {
                    global.warmUpDone = true;
                    // Run fully async in background
                    (async () => {
                        try {
                            const { getAcceptClient } = await import('./client.js');
                            const warmUpClient = getAcceptClient(token, cookie);
                            // Simple GET to establish TCP/TLS connection
                            await warmUpClient.get('https://weslah.seha.sa/api/referrals/facility/tabs');
                            sessionLogger.logVerbose(`[DEBUG] Connection Warm-up Complete at ${new Date().toLocaleTimeString()}`);
                        } catch (e) {
                            sessionLogger.logVerbose(`[DEBUG] Connection Warm-up Ignored: ${e.message}`);
                        }
                    })();
                }

                // Verbose log every 5 seconds or if critical
                if (remainingSec % 5 === 0 && remainingMs > 5000) {
                    sessionLogger.logVerbose(`[DEBUG] Loop Tick. Remaining: ${remainingMs}ms`);
                }

                // UI Status
                const uploadStatus = uploaded
                    ? chalk.green('✔ DONE')
                    : (remainingSec <= 15 ? chalk.cyan('⚡ NOW') : chalk.yellow(`⏳ -${formatTime(remainingSec - 15)}`));

                if (uploaded) steps.upload = 'done';
                else if (remainingSec <= 15) steps.upload = 'running';

                const tokenStatus = tokenRefreshed
                    ? chalk.green('✔ FRESH')
                    : (remainingSec <= 10 ? chalk.cyan('⚡ REFRESH') : chalk.gray(`⏳ -${formatTime(remainingSec - 10)}`));

                if (tokenRefreshed) steps.token = 'done';
                else if (remainingSec <= 10) steps.token = 'running';

                const burstStatus = remainingSec > 0 ? chalk.white(`🚀 -${formatTime(remainingSec)}`) : chalk.bgRed(' 🔥 BURST ');

                pulseBlink = !pulseBlink;
                const pulseIcon = ((Date.now() - lastPulse) < 5000)
                    ? (pulseBlink ? chalk.bold.green('⚡ ACTIVE') : chalk.green('• ACTIVE'))
                    : chalk.gray('• STANDBY');

                // Only redraw if significant time passed or event happened to reduce I/O jitter
                if (remainingMs > 50) {
                    printCaseHeader(targetCase, "", steps);
                    console.log(`\n ${chalk.bold.white('[' + formatTime(Math.max(0, remainingSec)) + ']')} ${burstStatus} | 📂 Up: ${uploadStatus} | 🔄 Tok: ${tokenStatus} | 📡 Net: ${pulseIcon}`);
                }

                // --- TRIGGERS ---

                if (remainingSec <= 15 && !uploaded) {
                    console.log(chalk.yellow("\n[!] T-15s: Auto-Uploading Report..."));
                    sessionLogger.step("T-15s: Starting upload...");
                    sessionLogger.logVerbose(`[DEBUG] T-15s Trigger fired at ${new Date().toLocaleTimeString()}. Remaining: ${remainingMs}ms`);
                    lastPulse = Date.now();
                    timeline.uploadStart = new Date();
                    try {
                        fileId = await uploadFile(token, cookie, pdfFilename);
                        uploaded = true;
                        timeline.uploadEnd = new Date();
                        sessionLogger.success(`Upload done in ${timeline.uploadEnd - timeline.uploadStart}ms (fileId: ${fileId})`);
                        sessionLogger.logVerbose(`[DEBUG] Upload finished. Duration: ${timeline.uploadEnd - timeline.uploadStart}ms. ID: ${fileId}`);
                        sessionLogger.apiResponse("UploadFile", "SUCCESS", { fileId });
                    } catch (e) {
                        sessionLogger.error(`Upload Failed: ${e.message}. Will retry at burst.`);
                        sessionLogger.logVerbose(`[DEBUG] Upload EXCEPTION: ${e.message}`);
                        sessionLogger.apiResponse("UploadFile", "FAILED", { error: e.message });
                    }
                }

                // --- KEEP ALIVE (Every 60s) ---
                if (remainingSec > 60 && (Date.now() - lastKeepAlive > 60000)) {
                    lastKeepAlive = Date.now();
                    (async () => {
                        try {
                            await getReferrals(token, cookie, 1);
                            sessionLogger.logVerbose(`[KEEP-ALIVE] Ping success at ${new Date().toLocaleTimeString()}`);
                        } catch (e) {
                            sessionLogger.warn(`[KEEP-ALIVE] Ping failed: ${e.message}`);
                        }
                    })();
                }

                if (remainingSec <= 10 && !tokenRefreshed) {
                    console.log(chalk.yellow("\n[!] T-10s: Auto-Refreshing Token..."));
                    sessionLogger.step("T-10s: Refreshing token...");
                    sessionLogger.logVerbose(`[DEBUG] T-10s Trigger fired at ${new Date().toLocaleTimeString()}. Remaining: ${remainingMs}ms`);
                    lastPulse = Date.now();
                    timeline.tokenStart = new Date();
                    const newToken = await validateAndRefreshToken(token, cookie, config.username, false);
                    if (newToken) {
                        token = newToken;
                        if (token !== config.token) await saveConfig({ token });
                        console.log(chalk.green("[+] Token Refreshed!"));
                    }
                    tokenRefreshed = true;
                    timeline.tokenEnd = new Date();
                    sessionLogger.success(`Token refreshed in ${timeline.tokenEnd - timeline.tokenStart}ms`);
                }

                // --- PRECISION BUSY-WAIT (FINAL 50ms) ---
                if (remainingMs <= 50) {
                    // BLOCKING LOOP to ensure we fire exactly at 0ms
                    while (Date.now() < targetTime) {
                        // Busy wait...
                    }
                    console.log(chalk.bgRed.white("\n[!!!] T-0ms: ENGAGING BURST SEQUENCE [!!!]"));
                    sessionLogger.step("T-0ms: BURST ENGAGED!");
                    sessionLogger.logVerbose(`[DEBUG] T-0 Trigger fired. Timer HIT target at ${new Date().toLocaleTimeString()}`);
                    break;
                }

                // --- EXTREME OPTIMIZATION: SPAWN WORKERS (T-5s) ---
                if (remainingMs <= 5000 && !global.workersSpawned) {
                    global.workersSpawned = true;
                    console.log(chalk.magenta("\n[!] T-5s: Spawning Parallel Workers..."));
                    sessionLogger.step("T-5s: Spawning workers...");

                    const { Worker } = await import('worker_threads');
                    const workerCount = 4; // 4 Workers + 1 Main Thread = 5 Threads Total
                    global.workers = [];

                    for (let i = 0; i < workerCount; i++) {
                        // STRICT PRECISION: All workers fire exactly at target time (0ms offset)
                        const offsetMs = 0;

                        const w = new Worker('./lib/burst_worker.js', {
                            workerData: {
                                token,
                                cookie,
                                caseId: targetCase.id,
                                fileId,
                                targetTimeMs: targetTime.getTime(),
                                offsetMs: offsetMs
                            }
                        });

                        w.on('message', (msg) => {
                            if (msg === 'ready') {
                                // Worker is ready and waiting
                            } else if (msg.success) {
                                if (!global.caseAccepted) {
                                    global.caseAccepted = true;
                                    sessionLogger.success(`Worker ${i} (Offset -${offsetMs}ms) WON THE RACE!`);
                                    steps.accept = 'done';
                                }
                            }
                        });

                        w.on('error', (err) => {
                            sessionLogger.logVerbose(`[WORKER ERROR] ${err.message}`);
                        });

                        global.workers.push(w);
                    }
                }

                if (remainingMs <= 0) {
                    break;
                }

                // High-frequency polling for precision
                if (remainingMs <= 1000) {
                    await sleep(10);
                } else if (remainingMs <= 5000) {
                    await sleep(100);
                } else {
                    if (remainingSec % 10 === 0) lastPulse = Date.now();
                    await sleep(1000);
                }
            }
        }

        // --- PHASE 5: BURST EXECUTION (MAIN THREAD) ---
        steps.accept = 'running';
        printCaseHeader(targetCase, "🔥 BURSTING...", steps);

        if (!fileId) {
            // ... existing code ...
        }

        // FIRE! (Main Thread also fires to be safe)
        timeline.burstStart = new Date();
        sessionLogger.step(`BURST FIRE at ${timeline.burstStart.toLocaleTimeString()}.${timeline.burstStart.getMilliseconds()}ms`);
        sessionLogger.logVerbose(`[DEBUG] Calling acceptCaseBurst...`);

        // If a worker already won, we might skip this or do it anyway to be safe
        if (!global.caseAccepted) {
            const result = await acceptCaseBurst(token, cookie, targetCase.id, fileId, 1); // Main thread is just 1 thread now
            sessionLogger.logVerbose(`[DEBUG] acceptCaseBurst returned. Result: ${result}`);
            if (result) global.caseAccepted = true;
        }

        // Wait a bit to let workers finish reporting
        await sleep(500);

        // Terminate workers
        if (global.workers) {
            global.workers.forEach(w => w.terminate());
        }

        timeline.acceptedAt = new Date(); // Approximate if worker won, but good enough
        sessionLogger.success(`BURST COMPLETE at ${timeline.acceptedAt.toLocaleTimeString()}.${timeline.acceptedAt.getMilliseconds()}ms`);

        steps.accept = 'done';
        printCaseHeader(targetCase, "✅ Sequence Complete.", steps);

        // --- FINAL TIMING SUMMARY ---
        sessionLogger.section("TIMING SUMMARY");
        const reactionMs = timeline.openTime && timeline.acceptedAt
            ? timeline.acceptedAt - timeline.openTime
            : null;
        const burstDurationMs = timeline.acceptedAt - timeline.burstStart;
        const uploadDurationMs = timeline.uploadEnd && timeline.uploadStart
            ? timeline.uploadEnd - timeline.uploadStart
            : null;
        const tokenDurationMs = timeline.tokenEnd && timeline.tokenStart
            ? timeline.tokenEnd - timeline.tokenStart
            : null;

        const ts = (d) => {
            if (!d) return 'N/A';
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            const ss = String(d.getSeconds()).padStart(2, '0');
            const ms = String(d.getMilliseconds()).padStart(3, '0');
            return `${hh}:${mm}:${ss}:${ms}`;
        };

        // Responsive Timing Summary
        const termWidth = getTermWidth();

        if (termWidth < 65) {
            // MOBILE COMPACT SUMMARY
            console.log(`\n${C.Bright}${C.Cyan}📊 TIMING SUMMARY${C.Reset}`);
            const logLine = (icon, label, val) => console.log(`${icon} ${label.padEnd(10)} ${val}`);

            logLine("📥", "Dropped:", `${C.White}${ts(timeline.broadcastedAt)}${C.Reset}`);
            logLine("🔓", "Opens:", `${C.Green}${ts(timeline.openTime)}${C.Reset}`);
            logLine("🔥", "Burst:", `${C.Yellow}${ts(timeline.burstStart)}${C.Reset}`);
            logLine("✅", "Accept:", `${C.Bright}${C.Green}${ts(timeline.acceptedAt)}${C.Reset}`);
            logLine("⚡", "Reaction:", `${reactionMs}ms`);
            console.log(`${C.Dim}------------------------------${C.Reset}`);
        } else {
            // DESKTOP BOX SUMMARY
            const sumWidth = Math.max(45, Math.min(termWidth, 80));

            console.log(`\n${C.Bright}${C.Cyan}${BOX.D.topLeft}${BOX.D.horizontal.repeat(sumWidth - 2)}${BOX.D.topRight}${C.Reset}`);
            const sumTitle = " 📊 ACCEPTANCE TIMING SUMMARY ";
            console.log(`${C.Bright}${C.Cyan}${BOX.D.vertical}${centerAnsi(sumTitle, sumWidth - 2)}${BOX.D.vertical}${C.Reset}`);
            console.log(`${C.Bright}${C.Cyan}${BOX.D.leftT}${BOX.D.horizontal.repeat(sumWidth - 2)}${BOX.D.rightT}${C.Reset}`);

            const row = (label, val, extra = "") => {
                const labelWidth = 18;
                const contentWidth = sumWidth - 4 - labelWidth;
                const v = `${val} ${extra}`;
                const pad = sumWidth - 3 - labelWidth - stripAnsi(v).length;
                const spacing = pad > 0 ? " ".repeat(pad) : " ";
                console.log(`${C.Cyan}║${C.Reset} ${label.padEnd(16)} ${spacing}${v}${C.Cyan}║${C.Reset}`);
            };

            row("📥 Case Dropped:", `${C.White}${ts(timeline.broadcastedAt)}${C.Reset}`);
            row("🔓 Case Opens:", `${C.Green}${ts(timeline.openTime)}${C.Reset}`);
            row("📂 Upload Start:", `${C.White}${ts(timeline.uploadStart)}${C.Reset}`);
            row("📂 Upload Done:", `${C.White}${ts(timeline.uploadEnd)}${C.Reset}`, uploadDurationMs ? `(${uploadDurationMs}ms)` : '');
            row("🔄 Token Fresh:", `${C.White}${ts(timeline.tokenEnd)}${C.Reset}`, tokenDurationMs ? `(${tokenDurationMs}ms)` : '');
            row("🔥 Burst Start:", `${C.Yellow}${ts(timeline.burstStart)}${C.Reset}`);
            row("✅ Accepted At:", `${C.Bright}${C.Green}${ts(timeline.acceptedAt)}${C.Reset}`);
            row("⚡ Reaction:", `${C.Bright}${reactionMs !== null ? (reactionMs <= 0 ? `${C.Green}${reactionMs}ms` : `${C.Yellow}${reactionMs}ms`) : 'N/A'}${C.Reset}`);
            row("⏱️  Burst Dur:", `${C.White}${burstDurationMs}ms${C.Reset}`);

            console.log(`${C.Bright}${C.Cyan}${BOX.D.bottomLeft}${BOX.D.horizontal.repeat(sumWidth - 2)}${BOX.D.bottomRight}${C.Reset}`);
        }

        // Log summary to debug file (silent — no console, already displayed in box above)
        sessionLogger.logInfo("=== TIMING SUMMARY ===");
        sessionLogger.logData("Case Dropped", ts(timeline.broadcastedAt));
        sessionLogger.logData("Case Opens", ts(timeline.openTime));
        sessionLogger.logData("Upload Started", ts(timeline.uploadStart));
        sessionLogger.logData("Upload Done", `${ts(timeline.uploadEnd)} (${uploadDurationMs}ms)`);
        sessionLogger.logData("Token Refreshed", `${ts(timeline.tokenEnd)} (${tokenDurationMs}ms)`);
        sessionLogger.logData("Burst Started", ts(timeline.burstStart));
        sessionLogger.logData("Accepted At", ts(timeline.acceptedAt));
        sessionLogger.logData("Reaction Time", `${reactionMs}ms`);
        sessionLogger.logData("Burst Duration", `${burstDurationMs}ms`);

        saveDebugLog(targetCase.patientName || targetCase.id, "REAL_WIZARD");
        await pauseAndRestart();

    } catch (e) {
        spinner.stop();
        console.log(`${C.Red}Error: ${e.message}${C.Reset}`);
        sessionLogger.error(`Wizard Error: ${e.message}`);
        saveDebugLog('error_log', "REAL_ERROR");
        await pauseAndRestart();
    }
}

async function pauseAndRestart() {
    await inquirer.prompt([{ type: 'input', name: 'dummy', message: 'Press Enter to continue...' }]);
    return startWizard();
}

function stripAnsi(str) {
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}
