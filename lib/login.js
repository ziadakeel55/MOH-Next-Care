
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import fs from 'fs';
import { log, sleep } from './utils.js';
import { saveConfig, loadConfig } from './config.js';
import { solveCaptcha, checkBalance } from './captcha.js';
import { getClient, createSession } from './client.js';

// We'll import validateAndRefreshToken dynamically or just rewrite the quick check

const URLS = {
    LOGIN_V3: `/account/loginv3`,
    SEND_OTP: `/Account/SendOtp`,
    VERIFY_OTP: `/Account/VerifyCodeLoginv2`,
    ROLE_LOGIN: `/Account/DoLoginByRolev2`
};

const DEFAULT_RECAPTCHA_KEY = '6LdApK4ZAAAAADhvh3s9bNw7cfsb7hLEjVVeKZii';

// Debug Logger Imported above

// Quick token check
// Quick token check
// Quick token check using Inbox Count (No Captcha)
async function isTokenValid(config) {
    if (!config?.token) return false;
    try {
        const client = getClient(config.token, config.cookie);
        await client.post('https://weslah.seha.sa/api/referrals/facility/tabs', {
            pageNumber: 1, pageSize: 1, tab: 1
        });
        return true;
    } catch (e) { return false; }
}

// Captcha helper (Silent or minimal)
async function freshCaptcha(key, siteKey, label) {
    const token = await solveCaptcha(key, 'https://www.seha.sa/', siteKey, { verbose: false });
    return token;
}

// Find token in response
function extractToken(data) {
    if (!data) return null;
    if (data.token) return data.token;
    if (data.data?.token) return data.data.token;
    if (data.Token) return data.Token;
    if (data.data?.Token) return data.data.Token;
    if (data.accessToken) return data.accessToken;
    if (data.data?.accessToken) return data.data.accessToken;
    return null;
}

// ==========================================
// MAIN LOGIN (CLEAN UI VERSION)
// options.temp = true → don't save token
// ==========================================
export async function interactiveLogin(options = {}) {
    console.clear();
    const spinner = ora('Initializing Login...').start();



    const config = (await loadConfig()) || {};

    // ====== CHECK IF ALREADY LOGGED IN ======
    if (config.token) {
        spinner.text = 'Checking saved token...';
        const valid = await isTokenValid(config);
        if (valid) {
            spinner.succeed('Already logged in!');
            return config.token;
        }
        spinner.text = 'Session expired. Starting fresh login...';
    }

    // ====== CapSolver Key ======
    const capKey = options.capsolverKey || config.capsolver_key;
    if (!capKey) {
        spinner.fail('CapSolver key missing');
        throw new Error('CapSolver key missing. Run: seha login --capsolver-key YOUR_KEY');
    }

    const { http, getCookies } = createSession();

    // Check balance (silently)
    try {
        await checkBalance(capKey);
    } catch (e) { }

    // ====== Credentials ======
    let username = options.username || config.username;
    let password = options.password || config.password;

    if (!username || !password) {
        spinner.stop();
        const a = await inquirer.prompt([
            ...(!username ? [{ type: 'input', name: 'username', message: 'ID Number:', validate: v => v.length >= 5 || 'Too short' }] : []),
            ...(!password ? [{ type: 'password', name: 'password', message: 'Password:', mask: '*', validate: v => v.length >= 4 || 'Too short' }] : [])
        ]);
        username = username || a.username;
        password = password || a.password;
        spinner.start('Resuming...');
    }

    const siteKey = config.recaptcha_key || DEFAULT_RECAPTCHA_KEY;

    // ====== STEP 1: Login ======
    console.clear();
    log.step('Login [1/4]');
    spinner.text = 'Solving Captcha...';

    const cap1 = await freshCaptcha(capKey, siteKey, 'Login');

    spinner.text = 'Authenticating...';

    let loginData = null;
    try {
        const res = await http.post(URLS.LOGIN_V3, {
            Username: username, Password: password
        }, { headers: { 'x-token': cap1 } });

        if (res.data?.data) {
            loginData = res.data.data;
            spinner.succeed(`Authenticated as ${loginData.nameEn || loginData.nameAr}`);
        } else {
            throw new Error(res.data?.errorMessage || 'Login failed - no data');
        }
    } catch (e) {
        spinner.fail('Login Failed');
        if (e.response?.status === 401) throw new Error('Wrong username or password');
        throw new Error(`Login failed: ${e.response?.data?.errorMessage || e.message}`);
    }

    if (!loginData.sendVerificationCode) {
        return null;
    }

    // ====== SMART GMAIL MONITOR START (Before sending OTP) ==================
    let gmailCtrl = null;
    if (config.gmail_address && config.gmail_app_password) {
        spinner.start('Preparing Gmail Monitor...');
        try {
            const { monitorInbox } = await import('./gmail.js');
            gmailCtrl = monitorInbox(config.gmail_address, config.gmail_app_password, 60000);
            await gmailCtrl.ready;
            spinner.succeed('Gmail Monitor Ready');
        } catch (e) {
            spinner.warn('Gmail Monitor Failed (Will use manual entry)');
        }
    }
    // ========================================================================

    // ====== STEP 2: Send OTP ======
    console.clear();
    log.step('Login [2/4]');
    spinner.start('Solving Captcha (OTP)...');

    const cap2 = await freshCaptcha(capKey, siteKey, 'SendOtp');

    spinner.text = 'Sending OTP...';

    try {
        await http.post(URLS.SEND_OTP, {
            SendingType: 2, UserName: username
        }, { headers: { 'x-token': cap2 } });
        spinner.succeed('OTP Sent');

    } catch (e) {
        spinner.warn('OTP Send warning (might still work)');

    }

    // ====== STEP 3: Verify OTP ======
    console.clear();
    log.step('Login [3/4]');
    spinner.start('Waiting for OTP...');

    let otpCode = null;

    // Check Gmail Monitor
    if (gmailCtrl) {
        spinner.text = 'Waiting for OTP email (Live)...';
        try {
            const livePromise = gmailCtrl.otpPromise;

            const fallbackCheck = async () => {
                await sleep(8000); // 8s
                if (otpCode) return;
                try {
                    const { getLatestOTP } = await import('./gmail.js');
                    spinner.text = 'Checking recent emails...';
                    const code = await getLatestOTP(config.gmail_address, config.gmail_app_password);
                    if (code) return code;
                } catch (e) { }
                await sleep(5000);
                return null;
            };

            const p1 = livePromise.catch(() => null);
            const p2 = fallbackCheck();

            otpCode = await Promise.race([p1, p2]);

            if (!otpCode) {
                const { getLatestOTP } = await import('./gmail.js');
                spinner.text = 'Final check for OTP...';
                otpCode = await getLatestOTP(config.gmail_address, config.gmail_app_password);
            }

            if (otpCode) {
                spinner.text = `OTP Received (${otpCode})`;

                await sleep(500);
            }
        } catch (e) { }
        if (gmailCtrl.stop) gmailCtrl.stop();
    }

    if (!otpCode) {
        spinner.stop();
        const answer = await inquirer.prompt([{
            type: 'input', name: 'otpCode',
            message: 'Enter OTP Code:',
            validate: v => v.length >= 4 || 'Too short'
        }]);
        otpCode = answer.otpCode;
        spinner.start('Verifying...');
    } else {
        spinner.text = 'Verifying OTP...';
    }

    // Solve Verify Captcha
    spinner.text = 'Solving Captcha (Verify)...';
    let cap3 = await freshCaptcha(capKey, siteKey, 'Verify');

    let roles = null;
    let verifySuccess = false;

    // Verify Loop
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            spinner.text = `Verifying Code (${attempt})...`;
            const verifyRes = await http.post(URLS.VERIFY_OTP, {
                VerificationCode: otpCode,
                IdIqamaNumber: username,
                SendingType: 2
            }, { headers: { 'x-token': cap3 } });

            const errCode = verifyRes.data?.errorCode ?? verifyRes.data?.ErrorCode;


            if (errCode === 0) {
                // Success!
                roles = verifyRes.data?.data;
                verifySuccess = true;
                break; // BREAK OTP LOOP
            }

            // OTP Expired
            if (errCode === 9033) {
                spinner.fail('OTP Expired');
                throw new Error('OTP Expired');
            } else {
                throw new Error(`Verify Error ${errCode}`);
            }

        } catch (e) {

            if (attempt === 3) {
                spinner.fail('Login Failed (Verify Error)');
                throw e; // Stop here if OTP failed 3 times
            }
            spinner.text = `Verify Failed. Retrying...`;
            cap3 = await freshCaptcha(capKey, siteKey, 'Verify');
        }
    }

    if (!verifySuccess) throw new Error('OTP Verification Failed');

    // ====== STEP 4: Get Token (Decoupled Loop with Captcha) ======
    console.clear();
    log.step('Login [4/4]');
    spinner.text = 'Preparing Role Login...';

    let roleId = 808;
    let orgId = 8930;
    if (Array.isArray(roles) && roles.length > 0) {
        roleId = roles[0].roleId || 808;
        orgId = roles[0].organizationId || 8930;
    } else {
    }

    // Strict Retry for Token ONLY (Do not go back to OTP)
    for (let tAttempt = 1; tAttempt <= 3; tAttempt++) {
        try {
            spinner.text = `Finalizing Token (Attempt ${tAttempt})...`;

            // New Captcha for Token Step
            spinner.text = `Solving Captcha (Token ${tAttempt})...`;
            const cap4 = await freshCaptcha(capKey, siteKey, 'Login');

            spinner.text = 'Fetching Token...';


            const roleRes = await http.post(URLS.ROLE_LOGIN, {
                RoleId: roleId, OrganizationId: orgId, UserName: username
            }, { headers: { 'x-token': cap4 } });


            // Extract token: Try to get the Weslah HS256 token first, fall back to RS256 portal token
            const HS256_PREFIX = 'eyJhbGciOiJIUzI1Ni';
            let finalToken = null;

            // 1. SSO Flow: external-login → portal ServiceLogin → completelogin → HS256 token
            //    Weslah uses OAuth2 SSO via portal. Session cookie jar has AuthToken + JWTUserToken.
            try {


                // Step 1: GET external-login → 301 to portal login?client_id=74
                const ssoRes = await http.get('https://weslah.seha.sa/api/account/external-login', {
                    maxRedirects: 0, validateStatus: s => s >= 200 && s < 400
                });
                let nextUrl = ssoRes.headers.location;

                // CRITICAL: Save nonce & state cookies from weslah.seha.sa before they get
                // overwritten by www.seha.sa (ServiceLogin clears them with empty values)
                const weslahCookies = getCookies();
                const savedNonce = weslahCookies.nonce;
                const savedState = weslahCookies.state;

                if (nextUrl) {
                    // Step 2: Follow redirect to portal (www.seha.sa/account/login?client_id=74...)
                    if (!nextUrl.startsWith('http')) nextUrl = 'https://www.seha.sa' + nextUrl;
                    const portalRes = await http.get(nextUrl, {
                        maxRedirects: 0, validateStatus: s => s >= 200 && s < 400
                    });
                    let serviceUrl = portalRes.headers.location;

                    if (serviceUrl) {
                        // Step 3: ServiceLogin — portal validates session, generates auth code, redirects
                        if (!serviceUrl.startsWith('http')) serviceUrl = 'https://www.seha.sa' + serviceUrl;
                        const serviceRes = await http.get(serviceUrl, {
                            maxRedirects: 0, validateStatus: s => s >= 200 && s < 400
                        });
                        let completeUrl = serviceRes.headers.location;

                        // ServiceLogin clears nonce/state cookies — restore weslah's values
                        const currentCookies = getCookies();
                        currentCookies.nonce = savedNonce;
                        currentCookies.state = savedState;

                        if (completeUrl) {
                            // Step 4: completelogin on Weslah — exchanges code for HS256 token
                            const completeRes = await http.get(completeUrl, {
                                maxRedirects: 0, validateStatus: s => s >= 200 && s < 400
                            });
                            let tokenUrl = completeRes.headers.location;

                            // Extract token from redirect URL (?token=eyJ...)
                            if (tokenUrl) {
                                const tokenMatch = tokenUrl.match(/[?&]token=([^&]+)/);
                                if (tokenMatch) {
                                    finalToken = decodeURIComponent(tokenMatch[1]);
                                    console.log(`[SSO] ✅ Got HS256 token from SSO flow!`);
                                }
                            }

                            // Also check response body
                            if (!finalToken && completeRes.data) {
                                const extracted = extractToken(completeRes.data);
                                if (extracted && extracted.startsWith(HS256_PREFIX)) {
                                    finalToken = extracted;

                                }
                            }
                        }
                    }
                }
            } catch (ssoErr) {
            }

            // 2. Fallback: Use the portal RS256 token from cookies
            if (!finalToken) {
                finalToken = extractToken(roleRes.data);
            }
            if (!finalToken) {
                const jars = getCookies();
                if (jars['JWTUserToken']) {
                    finalToken = jars['JWTUserToken'];

                }
            }
            if (!finalToken) {
                const jars = getCookies();
                for (const [name, val] of Object.entries(jars)) {
                    if (val && val.startsWith('eyJ')) {
                        finalToken = val;

                        break;
                    }
                }
            }


            if (finalToken && finalToken.startsWith(HS256_PREFIX)) {
                console.log(chalk.green('✅ Got Weslah HS256 Token!'));
            } else if (finalToken) {
                console.log(chalk.yellow('⚠ Got portal RS256 token (HS256 not available).'));
            }



            if (finalToken) {
                // SUCCESS
                if (!options.temp) {
                    // Save cookies needed for Weslah API auth: __cf_bm (Cloudflare) + AuthToken (session)
                    const allCookies = getCookies();
                    const allowedCookies = ['__cf_bm', 'AuthToken'];
                    const cookieStr = Object.entries(allCookies)
                        .filter(([k]) => allowedCookies.includes(k))
                        .map(([k, v]) => `${k}=${v}`)
                        .join('; ');

                    await saveConfig({
                        token: finalToken, username, password,
                        cookie: cookieStr || config.cookie,
                        capsolver_key: capKey,
                        userId: loginData.userId,
                        nameAr: loginData.nameAr,
                        nameEn: loginData.nameEn,
                        login_time: new Date().toISOString()
                    });
                }
                spinner.succeed('Login Successful');

                await sleep(1000);
                console.clear();
                return finalToken;
            } else {
                throw new Error('No token in response');
            }

        } catch (e) {


            if (tAttempt === 3) {
                spinner.fail('Login Failed (Token Fetch Error)');
                throw e; // Give up, do NOT retry OTP
            }
            spinner.warn(`Token Fetch Failed (${e.message}). Retrying...`);
            await sleep(1000);
        }
    }

    return null;
}
