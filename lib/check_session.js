import { startMonitor } from './monitor.js';
import { interactiveLogin } from './login.js';
import { getReferrals } from './api.js';
import { loadConfig, saveConfig, getAuthCookieString } from './config.js';
import { C } from './ui.js';
import { startDashboardServer } from './web_dashboard.js';

export async function checkSessionAndLogin(startMonitorAfter = false) {
    process.stdout.write(`${C.Yellow}[*] Checking session validity...${C.Reset}\n`);

    let config = await loadConfig();
    let token = config?.token;
    let cookie = getAuthCookieString(config?.cookie ?? config?.COOKIES);

    let isValid = false;

    if (token) {
        try {
            // Try to fetch Tab 1
            await getReferrals(token, cookie, 1);
            isValid = true;
        } catch (error) {
            const status = error.response?.status;
            if (status === 401 || error.message.includes('401')) {
                // Token is truly expired
                isValid = false;
            } else if (status === 500 || status === 502 || status === 503) {
                // Server is down — NOT a session issue. Don't force re-login.
                console.log(`${C.Yellow}⚠️  Server Error (${status}). Server may be down. Session assumed valid — will retry.${C.Reset}`);
                isValid = true; // Don't invalidate session for server errors
            } else {
                // Other network/connectivity errors — assume session is still valid
                console.log(`${C.Yellow}⚠️  Connection error: ${error.message}. Will retry.${C.Reset}`);
                isValid = true;
            }
        }
    }

    if (isValid) {
        console.log(`${C.Green}✔️  Session is VALID${C.Reset}`);
        if (startMonitorAfter) {
            await startDashboardServer();
            await startMonitor();
        }
        return true;
    }

    console.log(`${C.Red}❌ Session is EXPIRED/INVALID${C.Reset}`);
    console.log(`${C.Yellow}[*] Initiating Auto-Login...${C.Reset}`);

    try {
        const newToken = await interactiveLogin();
        if (newToken) {
            console.log(`${C.Green}✔️  Login Successful. Session Renewed.${C.Reset}`);
            if (startMonitorAfter) {
                await startDashboardServer();
                await startMonitor();
            }
            return true;
        }
    } catch (e) {
        console.log(`${C.Red}❌ Login Failed: ${e.message}${C.Reset}`);
    }

    return false;
}
