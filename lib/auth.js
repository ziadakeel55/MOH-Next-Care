import { log, sleep } from './utils.js';
import { saveConfig, loadConfig } from './config.js';
import { getClient } from './client.js';

// ==========================================
// CONFIGURATION (DEFAULTS / PATTERNS)
// ==========================================

const URLS = {
    ROLE_LOGIN: "https://www.seha.sa/api/Account/DoLoginByRolev2"
};

// ==========================================
// AUTH LOGIC
// ==========================================

// Replaces validateAndRefreshToken with a simpler validate
export async function validateAndRefreshToken(token, cookie, username, strict = false) {
    log.info("[*] Verifying Token Validity...");
    const client = getClient(token, cookie);
    const config = await loadConfig();

    // 1. Try Role-Based Login Refresh (Like legacy login.js)
    if (config && config.username) {
        try {
            log.info("[*] Attempting Session Refresh via Role Login (www.seha.sa)...");

            const roleLoginUrl = "https://www.seha.sa/api/Account/DoLoginByRolev2";
            const roleId = config.roleId || 808;
            const orgId = config.organizationId || 8930;

            const response = await client.post(roleLoginUrl, {
                RoleId: roleId,
                OrganizationId: orgId,
                UserName: config.username
            });

            log.success("[+] Session Refreshed via Role Login!");

            // Extract any token from the response
            let candidateToken = null;
            if (response.data?.token) candidateToken = response.data.token;
            else if (response.data?.Token) candidateToken = response.data.Token;
            else if (response.data?.accessToken) candidateToken = response.data.accessToken;

            // Check cookies too
            if (!candidateToken) {
                const setCookie = response.headers['set-cookie'];
                if (setCookie) {
                    const jwtCookie = setCookie.find(c => c.startsWith('JWTUserToken='));
                    if (jwtCookie) {
                        candidateToken = jwtCookie.split(';')[0].split('=')[1];
                    }
                }
            }

            if (candidateToken) {
                log.info("[+] Got valid token from refresh.");
                return candidateToken;
            }

            // No new token — current one might still be fine
            return token;

        } catch (error) {
            log.warn(`[-] Role Login Refresh Failed: ${error.message}`);
            log.warn("    Continuing to check if token works for data...");
        }
    }

    // 2. Fallback: Lightweight Data Check (Weslah)
    try {
        await client.post('https://weslah.seha.sa/api/referrals/facility/tabs', {
            pageNumber: 1, pageSize: 1, tab: 1
        });

        log.success("[+] Token Valid (Data Access Confirmed)!");
        return token;
    } catch (error) {
        if (error.response && error.response.status === 401) {
            log.warn("[-] Token Invalid/Expired (401).");
            return null;
        }
        log.warn(`[-] Token Validation Warning: ${error.message}`);
        if (strict) return null;
        return token;
    }
}

// REMOVED: loginInteractive (Headless Mode)

export async function getValidToken(autoLogin = false) {
    const config = await loadConfig();
    if (config && config.token) {
        // Try to refresh it before returning
        const freshToken = await validateAndRefreshToken(config.token, config.cookie, config.username, false);
        if (freshToken) { // Only if valid
            if (freshToken !== config.token) {
                await saveConfig({ token: freshToken }); // Update if changed
            }
            return freshToken;
        }
    }

    // Token is missing or dead — offer auto-login
    log.warn("[-] No valid token found in session.json.");

    if (autoLogin && config?.capsolver_key) {
        log.info("[i] Attempting auto-login via CapSolver...");
        try {
            const { interactiveLogin } = await import('./login.js');
            const newToken = await interactiveLogin({
                capsolverKey: config.capsolver_key,
                username: config.username
            });
            return newToken;
        } catch (e) {
            log.error(`[-] Auto-login failed: ${e.message}`);
            return null;
        }
    }

    log.info("[i] Run 'seha login' to get a fresh token.");
    return null;
}
