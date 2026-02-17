import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sleep, formatTime as formatTimeUtils } from './utils.js';
import { C, drawSelectionTable, drawTable, printCaseHeader, BOX, formatTime, centerAnsi, getTermWidth, stripAnsi } from './ui.js';
import { enrichMockData, reviewDiagnosisData } from './diagnosis.js';
import { sessionLogger, saveDebugLog } from './logger.js';
import { dashboardData, startDashboardServer, getPublicUrl } from './web_dashboard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
//  SEHA SIMULATOR — Mirrors Real Accept Flow
// ==========================================

export async function startSimulator() {
    console.clear();
    sessionLogger.clear();

    console.log(`${C.Bright}${C.Blue}========================================${C.Reset}`);
    console.log(`${C.Bright}${C.Blue}   MOH-Next-Care SIMULATION (V2.0)      ${C.Reset}`);
    console.log(`${C.Bright}${C.Blue}========================================${C.Reset}\n`);

    sessionLogger.section("SIMULATION STARTED");
    sessionLogger.info("Starting MOH-Next-Care Simulator (V2.0)");

    const { mode } = await inquirer.prompt([{
        type: 'rawlist',
        name: 'mode',
        message: 'Select Simulation Mode:',
        choices: [
            { name: '📊  Monitor (Live Dashboard)', value: 'monitor' },
            { name: '🚀  Auto-Accept (Burst Mode)', value: 'accept' },
            { name: '❌  Exit', value: 'exit' }
        ]
    }]);

    sessionLogger.input("Select Simulation Mode", mode);

    if (mode === 'exit') return;
    if (mode === 'monitor') return startSimMonitor();
    if (mode === 'accept') return startSimAcceptFlow();
}

async function startSimAcceptFlow() {
    console.clear();
    // Keep logs from startSimulator (don't clear)

    console.log(`${C.Bright}${C.Green}=== SIMULATED ACCEPT CASE (BURST MODE) ===${C.Reset}\n`);
    sessionLogger.section("ACCEPT FLOW (SIMULATION)");
    sessionLogger.info("Starting Simulated Accept Case (Burst Mode)");

    // --- PHASE 1: MOCK CASE DATA (simulates getReferrals Tab 1) ---
    const now = Date.now();

    // Case A: opens in 2 minutes (for testing countdown quickly)
    const openTimeA = new Date(now + 2 * 60000);
    const broadcastA = new Date(openTimeA.getTime() - 15 * 60000);

    // Case B: already open (broadcastedAt > 15 min ago)
    const broadcastB = new Date(now - 20 * 60000);
    const openTimeB = new Date(broadcastB.getTime() + 15 * 60000); // Already passed

    const mockItems = [
        {
            id: "SIM-101",
            patientName: "Simulation Patient A",
            patientNationalId: "1234567890",
            patientNationality: "Saudi",
            referralReferenceId: "REF-2025-001",
            referralId: "MED-5001",
            mainSpecialty: "Internal Medicine",
            providerName: "King Fahad Hospital",
            createdAt: new Date().toISOString().split('T')[0].replace(/-/g, '-') + " 10:30:00",
            broadcastedAt: broadcastA.toISOString(),
            openTime: openTimeA,
            status: "3"
        },
        {
            id: "SIM-102",
            patientName: "Simulation Patient B",
            patientNationalId: "9876543210",
            patientNationality: "Egyptian",
            referralReferenceId: "REF-2025-002",
            referralId: "MED-5002",
            mainSpecialty: "ICU",
            providerName: "Al Noor Hospital",
            createdAt: new Date().toISOString().split('T')[0].replace(/-/g, '-') + " 08:15:00",
            broadcastedAt: broadcastB.toISOString(),
            openTime: openTimeB,
            status: "3"
        }
    ];

    sessionLogger.apiResponse("MockData/GetReferrals", "200 OK", { count: mockItems.length, items: mockItems.map(i => i.id) });

    // Timeline tracker (same as wizard.js)
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

    // --- Draw Selection Table (same UI as wizard.js) ---
    drawSelectionTable(mockItems, "📤 Available Referrals (Simulation)");

    const { choiceNum } = await inquirer.prompt([{
        type: 'input',
        name: 'choiceNum',
        message: 'Select Case Index (or 0 to cancel):',
        validate: (val) => {
            const num = parseInt(val);
            if (val === '0' || val.toLowerCase() === 'cancel') return true;
            if (!isNaN(num) && num > 0 && num <= mockItems.length) return true;
            return `Enter 1-${mockItems.length} or 0 to cancel.`;
        }
    }]);

    sessionLogger.input("Select Case Index", choiceNum);

    if (choiceNum === '0' || choiceNum.toLowerCase() === 'cancel') {
        sessionLogger.info("Simulation cancelled by user.");
        return;
    }

    const targetCase = mockItems[parseInt(choiceNum) - 1];
    sessionLogger.info(`Selected Case: ${targetCase.patientName} (ID: ${targetCase.id})`);

    // Record broadcast/open times (same as wizard.js)
    timeline.broadcastedAt = targetCase.broadcastedAt ? new Date(targetCase.broadcastedAt) : null;
    timeline.openTime = targetCase.openTime ? new Date(targetCase.openTime) : null;

    sessionLogger.data("Case ID", targetCase.id);
    sessionLogger.data("Patient Name", targetCase.patientName);
    sessionLogger.data("Broadcasted At", timeline.broadcastedAt ? timeline.broadcastedAt.toLocaleTimeString() : 'Unknown');
    sessionLogger.data("Opens At", timeline.openTime ? timeline.openTime.toLocaleTimeString() : 'NOW');

    // --- PHASE 2: DIAGNOSIS & PDF (real — same as wizard.js) ---
    sessionLogger.section("DIAGNOSIS & PDF GENERATION");
    // reviewDiagnosisData calls enrichMockData internally, so pass raw case data
    const reviewedData = await reviewDiagnosisData(targetCase);
    Object.assign(targetCase, reviewedData);
    sessionLogger.data("Reviewed Data Fields", Object.keys(reviewedData).length);

    let pdfFilename;
    const steps = { pdf: 'running', upload: 'pending', token: 'pending', accept: 'pending' };
    printCaseHeader(targetCase, "Generating Report...", steps);

    try {
        const { generateReport } = await import('./pdf.js');
        pdfFilename = await generateReport(null, reviewedData);
        steps.pdf = 'done';
        const displayPath = pdfFilename.split(/[\\/]/).pop();
        sessionLogger.success(`PDF Generated: ${displayPath}`);
        sessionLogger.apiResponse("System/GeneratePDF", "SUCCESS", { filename: displayPath });
        pdfFilename = displayPath;
    } catch (e) {
        console.log(`${C.Red}Report Generation Failed: ${e.message}${C.Reset}`);
        sessionLogger.error(`PDF Error: ${e.message}`);
        saveDebugLog(targetCase.patientName || 'error', "SIMULATION");
        await pauseAndRestart();
        return;
    }

    // --- PHASE 3: AUTO ACCEPT PROMPT (same as wizard.js) ---
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
        saveDebugLog(targetCase.patientName || 'cancelled', "SIMULATION");
        return;
    }

    // --- PHASE 4: PRECISION COUNTDOWN (mirrors wizard.js exactly) ---
    sessionLogger.section("COUNTDOWN & EXECUTION");
    let targetTime;
    if (timeline.openTime && timeline.openTime > new Date()) {
        targetTime = timeline.openTime;
    } else {
        targetTime = new Date(); // Already open — execute immediately
    }

    sessionLogger.step(`Target burst time: ${targetTime.toLocaleTimeString()}`);
    sessionLogger.data("Time until burst", `${Math.ceil((targetTime - new Date()) / 1000)}s`);

    let fileId = null;
    let tokenRefreshed = false;
    let uploaded = false;
    let lastPulse = Date.now();
    let lastKeepAlive = Date.now(); // Sim keep-alive
    let pulseBlink = false;

    const preCheckMs = targetTime - new Date();
    sessionLogger.logVerbose(`[DEBUG] Simulator Countdown Init. Target: ${targetTime.toISOString()} | Current: ${new Date().toISOString()}`);

    if (preCheckMs <= 0) {
        // Already passed — do everything NOW (same as wizard.js)
        console.log(chalk.yellow("\n[!] Target time passed. Executing immediately..."));
        sessionLogger.warn("Target time already passed — immediate execution");

        // Mock Upload
        timeline.uploadStart = new Date();
        sessionLogger.step("Emergency Upload (SIMULATED)...");
        await sleep(1500);
        fileId = "SIM-FILE-" + Date.now();
        uploaded = true;
        steps.upload = 'done';
        timeline.uploadEnd = new Date();
        sessionLogger.success(`Upload done in ${timeline.uploadEnd - timeline.uploadStart}ms (fileId: ${fileId})`);

        // Mock Token refresh
        timeline.tokenStart = new Date();
        sessionLogger.step("Emergency Token Refresh (SIMULATED)...");
        await sleep(800);
        tokenRefreshed = true;
        steps.token = 'done';
        timeline.tokenEnd = new Date();
        sessionLogger.success(`Token refreshed in ${timeline.tokenEnd - timeline.tokenStart}ms`);

    } else {
        // Normal countdown loop (mirrors wizard.js lines 218-299)
        sessionLogger.logVerbose(`[DEBUG] Entering Simulator wait loop. Pre-check: ${preCheckMs}ms`);
        while (true) {
            const current = new Date();
            const remainingMs = targetTime - current;
            const remainingSec = Math.ceil(remainingMs / 1000);

            // Verbose log every 5 seconds or if critical
            if (remainingSec % 5 === 0 && remainingMs > 5000) {
                sessionLogger.logVerbose(`[DEBUG] Loop Tick. Remaining: ${remainingMs}ms`);
            }

            // UI Status (same as wizard.js)
            const uploadStatus = uploaded
                ? chalk.green('✔ DONE')
                : (remainingSec <= 15 ? chalk.cyan('⚡ NOW') : chalk.yellow(`⏳ -${formatTimeUtils(remainingSec - 15)}`));

            if (uploaded) steps.upload = 'done';
            else if (remainingSec <= 15) steps.upload = 'running';

            const tokenStatus = tokenRefreshed
                ? chalk.green('✔ FRESH')
                : (remainingSec <= 10 ? chalk.cyan('⚡ REFRESH') : chalk.gray(`⏳ -${formatTimeUtils(remainingSec - 10)}`));

            if (tokenRefreshed) steps.token = 'done';
            else if (remainingSec <= 10) steps.token = 'running';

            const burstStatus = remainingSec > 0 ? chalk.white(`🚀 -${formatTimeUtils(remainingSec)}`) : chalk.bgRed(' 🔥 BURST ');

            pulseBlink = !pulseBlink;
            const pulseIcon = ((Date.now() - lastPulse) < 5000)
                ? (pulseBlink ? chalk.bold.green('⚡ ACTIVE') : chalk.green('• ACTIVE'))
                : chalk.gray('• STANDBY');

            printCaseHeader(targetCase, "", steps);
            console.log(`\n ${chalk.bold.white('[' + formatTimeUtils(Math.max(0, remainingSec)) + ']')} ${burstStatus} | 📂 Up: ${uploadStatus} | 🔄 Tok: ${tokenStatus} | 📡 Net: ${pulseIcon}`);

            // --- TRIGGERS (same as wizard.js) ---

            // T-15s: Upload (SIMULATED)
            if (remainingSec <= 15 && !uploaded) {
                console.log(chalk.yellow("\n[!] T-15s: Auto-Uploading Report (SIMULATED)..."));
                sessionLogger.step("T-15s: Starting simulated upload...");
                sessionLogger.logVerbose(`[DEBUG] T-15s Trigger fired at ${new Date().toLocaleTimeString()}. Remaining: ${remainingMs}ms`);
                lastPulse = Date.now();
                lastPulse = Date.now();
                timeline.uploadStart = new Date();
                await sleep(1500); // Simulate upload time
                fileId = "SIM-FILE-" + Date.now();
                uploaded = true;
                timeline.uploadEnd = new Date();
                sessionLogger.success(`Upload done in ${timeline.uploadEnd - timeline.uploadStart}ms (fileId: ${fileId})`);
                uploaded = true;
                timeline.uploadEnd = new Date();
                sessionLogger.success(`Upload done in ${timeline.uploadEnd - timeline.uploadStart}ms (fileId: ${fileId})`);
            }

            // --- KEEP ALIVE (SIMULATION) ---
            if (remainingSec > 60 && (Date.now() - lastKeepAlive > 60000)) {
                lastKeepAlive = Date.now();
                // console.log(chalk.gray(`\n   💓 Application Heartbeat (Keep-Alive) - ${new Date().toLocaleTimeString()}`));
                sessionLogger.logVerbose(`[KEEP-ALIVE] Simulated Ping success at ${new Date().toLocaleTimeString()}`);
            }

            // T-10s: Token Refresh (SIMULATED)
            if (remainingSec <= 10 && !tokenRefreshed) {
                console.log(chalk.yellow("\n[!] T-10s: Auto-Refreshing Token (SIMULATED)..."));
                sessionLogger.step("T-10s: Refreshing token (simulated)...");
                sessionLogger.logVerbose(`[DEBUG] T-10s Trigger fired at ${new Date().toLocaleTimeString()}. Remaining: ${remainingMs}ms`);
                lastPulse = Date.now();
                lastPulse = Date.now();
                timeline.tokenStart = new Date();
                await sleep(800); // Simulate token refresh
                tokenRefreshed = true;
                timeline.tokenEnd = new Date();
                console.log(chalk.green("[+] Token Refreshed! (SIMULATED)"));
                sessionLogger.success(`Token refreshed in ${timeline.tokenEnd - timeline.tokenStart}ms`);
            }

            // T-0ms: BURST
            if (remainingMs <= 0) {
                console.log(chalk.bgRed.white("\n[!!!] T-0ms: ENGAGING BURST SEQUENCE [!!!]"));
                sessionLogger.step("T-0ms: BURST ENGAGED!");
                sessionLogger.logVerbose(`[DEBUG] T-0 Trigger fired. Timer HIT target at ${new Date().toLocaleTimeString()}`);
                break;
            }

            // High-frequency polling (same as wizard.js)
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

    // --- PHASE 5: BURST EXECUTION (SIMULATED) ---
    steps.accept = 'running';
    printCaseHeader(targetCase, "🔥 BURSTING (SIMULATED)...", steps);

    if (!fileId) {
        console.log(chalk.red("CRITICAL: File ID missing. Emergency upload (SIMULATED)..."));
        sessionLogger.warn("Emergency upload — fileId was null");
        timeline.uploadStart = new Date();
        await sleep(1500);
        fileId = "SIM-EMERGENCY-" + Date.now();
        timeline.uploadEnd = new Date();
        sessionLogger.success(`Emergency upload done in ${timeline.uploadEnd - timeline.uploadStart}ms`);
    }

    // FIRE! (SIMULATED)
    timeline.burstStart = new Date();
    sessionLogger.step(`BURST FIRE at ${timeline.burstStart.toLocaleTimeString()}.${timeline.burstStart.getMilliseconds()}ms`);
    sessionLogger.logVerbose(`[DEBUG] Simulated Burst Fire triggered...`);

    // Simulate burst acceptance (5 threads, like api.js acceptCaseBurst)
    console.log(chalk.cyan(`\n➤ Starting BURST ACCEPTANCE for Case ${targetCase.id} (SIMULATED)...`));
    console.log(chalk.blue(`ℹ Concurrency: 5 threads | Zero-Latency Mode`));

    const simAttempts = Math.floor(Math.random() * 8) + 3; // Random 3-10 attempts
    const winningThread = Math.floor(Math.random() * 5);

    for (let i = 0; i < Math.min(simAttempts, 5); i++) {
        await sleep(50);
    }

    timeline.totalAttempts = simAttempts;
    await sleep(200); // Slight delay for realism

    console.log(chalk.green(`✔ CASE ACCEPTED! Thread ${winningThread} hit the target. (${simAttempts} total attempts)`));
    console.log(chalk.blue(`ℹ Burst finished. Total attempts across all threads: ${simAttempts}`));

    timeline.acceptedAt = new Date();
    sessionLogger.success(`BURST COMPLETE at ${timeline.acceptedAt.toLocaleTimeString()}.${timeline.acceptedAt.getMilliseconds()}ms`);

    // Log Burst Result
    sessionLogger.apiResponse("MockAcceptCaseBurst", "SUCCESS", {
        attempts: simAttempts,
        winningThread: winningThread,
        acceptedAt: timeline.acceptedAt.toISOString()
    });

    steps.accept = 'done';
    printCaseHeader(targetCase, "✅ Sequence Complete.", steps);

    // --- FINAL TIMING SUMMARY (identical to wizard.js) ---
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

    const ts = (d) => d ? `${d.toLocaleTimeString()}.${String(d.getMilliseconds()).padStart(3, '0')}` : 'N/A';

    // Responsive Timing Summary (mirrors wizard.js)
    const termWidth = getTermWidth();

    if (termWidth < 65) {
        // MOBILE COMPACT SUMMARY
        console.log(`\n${C.Bright}${C.Cyan}📊 TIMING SUMMARY${C.Reset}`);
        const logLine = (icon, label, val) => console.log(`${icon} ${label.padEnd(10)} ${val}`);

        logLine("📥", "Broadcast:", `${C.White}${ts(timeline.broadcastedAt)}${C.Reset}`);
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

        row("📥 Broadcasted At:", `${C.White}${ts(timeline.broadcastedAt)}${C.Reset}`);
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
    sessionLogger.logData("Broadcasted At", ts(timeline.broadcastedAt));
    sessionLogger.logData("Case Opens", ts(timeline.openTime));
    sessionLogger.logData("Upload Started", ts(timeline.uploadStart));
    sessionLogger.logData("Upload Done", `${ts(timeline.uploadEnd)} (${uploadDurationMs}ms)`);
    sessionLogger.logData("Token Refreshed", `${ts(timeline.tokenEnd)} (${tokenDurationMs}ms)`);
    sessionLogger.logData("Burst Started", ts(timeline.burstStart));
    sessionLogger.logData("Accepted At", ts(timeline.acceptedAt));
    sessionLogger.logData("Reaction Time", `${reactionMs}ms`);
    sessionLogger.logData("Burst Duration", `${burstDurationMs}ms`);

    saveDebugLog(targetCase.patientName || targetCase.id, "SIMULATION");

    await pauseAndRestart();
}

// ==========================================
//  SIMULATED MONITOR MODE
// ==========================================

async function startSimMonitor() {
    console.clear();
    sessionLogger.section("MONITOR MODE (SIMULATION)");
    sessionLogger.info("Starting Simulated Monitor Mode");

    // Start web dashboard
    await startDashboardServer();
    dashboardData.mode = 'simulation';

    // Mock State (mirrors monitor.js state)
    const state = {
        startTime: Date.now(),
        tab1Data: [],
        tab2Data: [],
        counter: 0,
        nextUpdateIn: 0,
        isUpdating: false,
        tab2Total: 0,
        events: []
    };

    // Generate mock referral data
    function generateMockReferrals(count) {
        const names = ["Ahmed Ali", "Sara Mohammed", "Khalid Ibrahim", "Fatima Hassan", "Omar Yousef",
            "Nora Abdullah", "Mansour Salem", "Huda Nasser", "Faisal Turki", "Layla Othman"];
        const statuses = ["1", "2", "3", "4"];
        const items = [];
        for (let i = 0; i < count; i++) {
            const isSaudi = Math.random() > 0.3;
            items.push({
                id: `SIM-${200 + i}`,
                patientName: names[i % names.length],
                status: statuses[Math.floor(Math.random() * statuses.length)],
                broadcastedAt: new Date(Date.now() - Math.random() * 3600000).toISOString(),
                patientNationalId: Math.floor(1000000000 + Math.random() * 9000000000).toString(),
                patientNationality: isSaudi ? 'Saudi' : 'Non-Saudi',
                mainSpecialty: ['Internal Medicine', 'General Surgery', 'Pediatrics', 'Cardiology'][Math.floor(Math.random() * 4)],
                providerName: ['King Fahad Hospital', 'Al Noor Specialist', 'MOH Central', 'Private Medical City'][Math.floor(Math.random() * 4)],
                openTime: Math.random() > 0.5 ? new Date(Date.now() + Math.random() * 1800000).toISOString() : null,
                referralReferenceId: `REF-${Math.floor(10000 + Math.random() * 90000)}`
            });
        }
        return items;
    }

    // Render dashboard (mirrors monitor.js renderDashboard)
    function renderDashboard() {
        console.clear();
        const uptime = formatTime(Date.now() - state.startTime);
        const termWidth = getTermWidth();
        const width = Math.max(40, Math.min(termWidth, 100));

        console.log(C.Blue + BOX.D.topLeft + BOX.D.horizontal.repeat(width - 2) + BOX.D.topRight + C.Reset);
        const title = "  MOH-Next-Care AUTO-REFRESHER (SIMULATION)  ";
        console.log(C.Blue + BOX.D.vertical + C.BgBlue + C.Bright + centerAnsi(title, width - 2) + C.Reset + C.Blue + BOX.D.vertical + C.Reset);
        const subtitle = "  ●  Simulated Dashboard Monitor  ";
        console.log(C.Blue + BOX.D.vertical + C.Green + centerAnsi(subtitle, width - 2) + C.Reset + C.Blue + BOX.D.vertical + C.Reset);
        console.log(C.Blue + BOX.D.leftT + BOX.D.horizontal.repeat(width - 2) + BOX.D.rightT + C.Reset);

        const m1 = `${C.Yellow}Upd#${state.counter}${C.Reset}`;
        const m2 = `${C.Cyan}Time:${C.Bright}${uptime}${C.Reset}`;
        const m3 = `${C.White}Next:${C.Green}${state.nextUpdateIn}s${C.Reset}`;

        if (width < 60) {
            const spacer = " ";
            const metricsStr = `${m1}${spacer}|${spacer}${m2}${spacer}|${spacer}${m3}`;
            console.log(C.Blue + BOX.D.vertical + centerAnsi(metricsStr, width - 2) + C.Blue + BOX.D.vertical + C.Reset);
        } else {
            const pad = "       ";
            const metricsStr = `${m1}${pad}|${pad}${m2}${pad}|${pad}${m3}`;
            console.log(C.Blue + BOX.D.vertical + centerAnsi(metricsStr, width - 2) + C.Blue + BOX.D.vertical + C.Reset);
        }

        console.log(C.Blue + BOX.D.bottomLeft + BOX.D.horizontal.repeat(width - 2) + BOX.D.bottomRight + C.Reset);

        drawTable(state.tab1Data, "📤 Tab 1 (Sent)");
        const tab2Title = `📥 Tab 2 (Inbox) - Total: ${state.tab2Total}`;
        drawTable(state.tab2Data, tab2Title);

        // Event Log
        if (state.events.length > 0) {
            console.log(C.Blue + BOX.D.leftT + BOX.D.horizontal.repeat(width - 2) + BOX.D.rightT + C.Reset);
            console.log(C.Blue + BOX.D.vertical + centerAnsi(" 📜 Event Log ", width - 2) + C.Blue + BOX.D.vertical + C.Reset);
            console.log(C.Blue + BOX.D.leftT + BOX.D.horizontal.repeat(width - 2) + BOX.D.rightT + C.Reset);
            const recentEvents = state.events.slice(-5);
            for (let evt of recentEvents) {
                // Truncate event string if needed to avoid breaking box
                const maxEvtLen = width - 4;
                let displayEvt = evt;
                if (stripAnsi(evt).length > maxEvtLen) {
                    displayEvt = evt.substring(0, maxEvtLen - 3) + "...";
                }
                console.log(C.Blue + BOX.D.vertical + " " + displayEvt.padEnd(maxEvtLen) + " " + C.Blue + BOX.D.vertical + C.Reset);
            }
            console.log(C.Blue + BOX.D.bottomLeft + BOX.D.horizontal.repeat(width - 2) + BOX.D.bottomRight + C.Reset);
        }

        console.log("");
        if (state.isUpdating) {
            console.log(` ${C.Yellow}${C.Blink}[!] Simulating data fetch...${C.Reset}`);
        } else {
            console.log(` ${C.Dim}Waiting for next refresh cycle... (Ctrl+C to exit)${C.Reset}`);
        }

        // Show public URL persistently
        const url = getPublicUrl();
        if (url) {
            console.log(`\n ${C.Green}🌐 Dashboard URL: ${C.Bright}${C.Yellow}${url}${C.Reset}`);
        } else {
            console.log(`\n ${C.Dim}🌐 Local Dashboard: ${C.Cyan}http://localhost:3333${C.Reset}`);
        }
    }

    // Simulate monitor loop (mirrors monitor.js while(true) loop)
    while (true) {
        state.counter++;
        state.isUpdating = true;
        renderDashboard();

        // Simulate API fetch delay
        await sleep(1000 + Math.random() * 1500);

        // Generate fresh mock data each cycle
        // Generate fresh mock data each cycle
        state.tab1Data = generateMockReferrals(Math.floor(Math.random() * 5) + 3);
        const t2Full = generateMockReferrals(Math.floor(Math.random() * 30) + 15);

        const termWidth = getTermWidth();
        const limit = termWidth < 70 ? 4 : 10;
        state.tab2Data = t2Full.slice(0, limit);
        state.tab2Total = t2Full.length + Math.floor(Math.random() * 20);

        // Random events (30% chance per cycle)
        if (Math.random() > 0.7) {
            const eventTypes = [
                `🆕 New Case: SIM-${300 + state.counter} detected`,
                `🔄 Status Change: SIM-${200 + (state.counter % 5)} (Pending → Accepted)`,
                `⚠️ Token Refresh triggered`,
                `📡 IFTTT Notification sent`
            ];
            const evt = eventTypes[Math.floor(Math.random() * eventTypes.length)];
            state.events.push(`[${new Date().toLocaleTimeString()}] ${evt}`);
            if (state.events.length > 50) state.events = state.events.slice(-50);
        }

        // --- DASHBOARD INTEGRATION ---
        dashboardData.tab1 = state.tab1Data;
        dashboardData.tab2 = t2Full;
        dashboardData.tab2Total = state.tab2Total;
        dashboardData.events = [...state.events];
        dashboardData.counter = state.counter;
        dashboardData.lastUpdate = new Date().toISOString();
        dashboardData.startTime = state.startTime;
        // -----------------------------

        state.isUpdating = false;

        // Wait loop with countdown (mirrors monitor.js delay loop)
        const delay = 3 + Math.floor(Math.random() * 5); // 3-7 seconds
        for (let i = delay; i > 0; i--) {
            state.nextUpdateIn = i;
            renderDashboard();
            await sleep(1000);
        }
    }
}

async function pauseAndRestart() {
    await inquirer.prompt([{ type: 'input', name: 'dummy', message: 'Press Enter to continue...' }]);
    return startSimulator();
}
