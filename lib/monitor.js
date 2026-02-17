import { getReferrals, getAllReferrals } from './api.js';
import { loadConfig, saveConfig, getAuthCookieString } from './config.js';
import { validateAndRefreshToken } from './auth.js';
import { interactiveLogin } from './login.js';
import { C, drawTable, formatTime, centerAnsi, BOX, getTermWidth } from './ui.js';
import chalk from 'chalk';
import { dashboardData, getPublicUrl, getTunnelPassword } from './web_dashboard.js';

// Global State
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

function renderDashboard() {
    console.clear();
    const uptime = formatTime(Date.now() - state.startTime);
    const termWidth = getTermWidth();
    const width = Math.max(40, Math.min(termWidth, 100));

    // Top Border
    console.log(C.Blue + BOX.D.topLeft + BOX.D.horizontal.repeat(width - 2) + BOX.D.topRight + C.Reset);

    // Title
    const title = "  MOH-Next-Care AUTO-REFRESHER  ";
    console.log(C.Blue + BOX.D.vertical + C.BgBlue + C.Bright + centerAnsi(title, width - 2) + C.Reset + C.Blue + BOX.D.vertical + C.Reset);

    // Subtitle / Status
    const subtitle = "  ●  Live Dashboard Monitor  ";
    console.log(C.Blue + BOX.D.vertical + C.Green + centerAnsi(subtitle, width - 2) + C.Reset + C.Blue + BOX.D.vertical + C.Reset);

    // Separator
    console.log(C.Blue + BOX.D.leftT + BOX.D.horizontal.repeat(width - 2) + BOX.D.rightT + C.Reset);

    // Metrics Row
    const m1 = `${C.Yellow}Upd#${state.counter}${C.Reset}`;
    const m2 = `${C.Cyan}Time:${C.Bright}${uptime}${C.Reset}`;
    const m3 = `${C.White}Next:${C.Green}${state.nextUpdateIn}s${C.Reset}`;

    if (width < 60) {
        // Stacked or flexible spacing
        const spacer = " ";
        const metricsStr = `${m1}${spacer}|${spacer}${m2}${spacer}|${spacer}${m3}`;
        console.log(C.Blue + BOX.D.vertical + centerAnsi(metricsStr, width - 2) + C.Blue + BOX.D.vertical + C.Reset);
    } else {
        const pad = "       ";
        const metricsStr = `${m1}${pad}|${pad}${m2}${pad}|${pad}${m3}`;
        console.log(C.Blue + BOX.D.vertical + centerAnsi(metricsStr, width - 2) + C.Blue + BOX.D.vertical + C.Reset);
    }

    // Bottom of Header
    console.log(C.Blue + BOX.D.bottomLeft + BOX.D.horizontal.repeat(width - 2) + BOX.D.bottomRight + C.Reset);

    // Content Tables
    drawTable(state.tab1Data, "📤 Tab 1 (Sent)");
    const tab2Title = `📥 Tab 2 (Inbox) - Total: ${state.tab2Total}`;
    drawTable(state.tab2Data, tab2Title);

    // Event Log
    if (state.events.length > 0) {
        console.log(C.Blue + BOX.D.leftT + BOX.D.horizontal.repeat(width - 2) + BOX.D.rightT + C.Reset);
        console.log(C.Blue + BOX.D.vertical + centerAnsi(" 📜 Event Log ", width - 2) + C.Blue + BOX.D.vertical + C.Reset);
        console.log(C.Blue + BOX.D.leftT + BOX.D.horizontal.repeat(width - 2) + BOX.D.rightT + C.Reset);

        // Show last 5 events
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
        console.log(` ${C.Yellow}${C.Blink}[!] Fetching newest data from server...${C.Reset}`);
    } else {
        console.log(` ${C.Dim}Waiting for next refresh cycle...${C.Reset}`);
    }

    // Show public URL persistently
    const url = getPublicUrl();
    const tPass = getTunnelPassword();
    if (url) {
        console.log(`\n ${C.Green}🌐 Dashboard URL: ${C.Bright}${C.Yellow}${url}${C.Reset}`);
        if (tPass) {
            console.log(` ${C.Cyan}🔑 Tunnel Password: ${C.Bright}${C.White}${tPass}${C.Reset} ${C.Dim}(Required for access)${C.Reset}`);
        }
    } else {
        console.log(`\n ${C.Dim}🌐 Local Dashboard: ${C.Cyan}http://localhost:3333${C.Reset}`);
    }
}

export async function startMonitor() {
    console.log(`${C.Green}[+] Session is valid. Starting Monitor...${C.Reset}`);

    let config = await loadConfig();
    let token = config?.token;
    let cookie = getAuthCookieString(config?.cookie ?? config?.COOKIES);

    state.isUpdating = true;

    // Infinite Loop
    while (true) {
        state.counter++;
        state.isUpdating = true;
        renderDashboard();

        config = await loadConfig();
        // Always ensure we have latest token/cookie from config/memory
        if (config.token) token = config.token;
        if (config.cookie || config.COOKIES) cookie = getAuthCookieString(config.cookie ?? config.COOKIES);


        try {
            // 1. Fetch Data
            // Tab 1
            const t1 = await getReferrals(token, cookie, 1);
            state.tab1Data = (t1 && Array.isArray(t1.items)) ? t1.items : [];

            // Tab 2
            // Tab 2 (ALL PAGES for Watcher, First Page for UI)
            const t2Full = await getAllReferrals(token, cookie, 2);
            const allT2Items = t2Full.items || [];
            state.tab2Total = t2Full.totalCount || allT2Items.length;

            // UI shows only page 1 (first 10, or fewer on mobile)
            const termWidth = getTermWidth();
            const limit = termWidth < 70 ? 4 : 10;
            state.tab2Data = allT2Items.slice(0, limit);

            // --- WATCHER INTEGRATION ---
            const { analyzeTab1, analyzeTab2 } = await import('./watcher.js');
            await analyzeTab1(state.tab1Data, token, false);

            // Analyze ALL items for status changes
            const newEvents = await analyzeTab2(allT2Items, false);
            if (newEvents && newEvents.length > 0) {
                state.events.push(...newEvents);
                // Optional: Trim events list if it gets too long
                if (state.events.length > 50) state.events = state.events.slice(-50);
            }
            // ---------------------------

            // --- DASHBOARD INTEGRATION ---
            dashboardData.tab1 = state.tab1Data;
            dashboardData.tab2 = allT2Items;
            dashboardData.tab2Total = state.tab2Total;
            dashboardData.events = [...state.events];
            dashboardData.counter = state.counter;
            dashboardData.lastUpdate = new Date().toISOString();
            dashboardData.mode = 'real';
            dashboardData.startTime = state.startTime;
            // -----------------------------
            // ---------------------------

            state.isUpdating = false;

        } catch (e) {
            const status = e.response?.status;

            if (status === 500 || status === 502 || status === 503) {
                // Server is DOWN — don't touch the session, just retry
                console.log(C.Yellow + `\n[!] Server Error (${status}): Server may be down. Retrying in 60s...` + C.Reset);
                state.isUpdating = false;

                // Add event to dashboard
                const now = new Date().toLocaleTimeString();
                state.events.push(`[${now}] ⚠️ Server Error ${status} — retrying in 60s`);
                if (state.events.length > 50) state.events = state.events.slice(-50);

                // Update dashboard data even during outage
                dashboardData.events = [...state.events];
                dashboardData.counter = state.counter;
                dashboardData.lastUpdate = new Date().toISOString();
                dashboardData.startTime = state.startTime;

                // Wait 60 seconds, showing countdown
                for (let i = 60; i > 0; i--) {
                    state.nextUpdateIn = i;
                    renderDashboard();
                    await new Promise(r => setTimeout(r, 1000));
                }
                continue; // Skip the normal delay, go straight to retry

            } else if (status === 401 || e.message?.includes('401')) {
                console.log(C.Yellow + "[!] Token Expired. Refreshing..." + C.Reset);

                // 1. Try Background Refresh
                let newToken = await validateAndRefreshToken(token, cookie, config.username, true);

                // 2. If valid, update and continue
                if (newToken) {
                    token = newToken; // Update local var
                    if (token !== config.token) await saveConfig({ token });
                    console.log(C.Green + "[+] Token Refreshed!" + C.Reset);
                } else {
                    // 3. Interactive Login fallback
                    console.log(chalk.red("\n[!] Background refresh failed. Initiating Auto-Login Sequence..."));
                    try {
                        // Force re-import toensure fresh state if needed, though module cache handles it
                        // const { interactiveLogin } = await import('./login.js'); 

                        // Attempt login - using existing config for capsolver/gmail
                        const loginToken = await interactiveLogin({
                            username: config.username,
                            // password: config.password, // interactiveLogin loads from config if not passed
                            capsolverKey: config.capsolver_key
                        });

                        if (loginToken) {
                            token = loginToken;
                            console.log(chalk.green("[+] Auto-Login Successful! Resuming Monitor..."));

                            // Small pause to let user see success
                            await new Promise(r => setTimeout(r, 2000));

                            // Reset counter or just continue? Continue is fine.
                            state.nextUpdateIn = 0; // Force immediate update
                            console.clear();
                            continue; // Restart loop immediately with new token
                        } else {
                            console.log(chalk.red("[x] Auto-Login Failed. Retrying in 30s..."));
                            // Allow loop to hit the wait delay below instead of exiting
                        }
                    } catch (loginErr) {
                        console.log(chalk.red(`[x] Login Error: ${loginErr.message}`));
                        // process.exit(1); // Don't exit, just wait and retry
                    }
                }
            } else {
                // Other error
                // log.error? or just ignore in UI?
            }
        }


        // 2. Wait Loop (Live Update)
        const minDelay = config.monitor_min_delay || 20;
        const maxDelay = config.monitor_max_delay || 40;
        const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);

        for (let i = delay; i > 0; i--) {
            state.nextUpdateIn = i;
            dashboardData.nextUpdateIn = i; // Sync to web dashboard
            renderDashboard();
            await new Promise(r => setTimeout(r, 1000));
        }
        dashboardData.nextUpdateIn = 0; // Reset when done
    }
}

function stripAnsi(str) {
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}
