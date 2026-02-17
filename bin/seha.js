#!/usr/bin/env node
import { mirrorConsoleToFullLog, fullLog } from '../lib/logger.js';
mirrorConsoleToFullLog();
fullLog('APP', 'SEHA CLI started', { argv: process.argv.slice(2) });

import { Command } from 'commander';
import { log, sleep } from '../lib/utils.js';
import { getValidToken } from '../lib/auth.js';
import { loadConfig, saveConfig, getAuthCookieString } from '../lib/config.js';
import { uploadFile, acceptCaseBurst, getReferrals } from '../lib/api.js';

const program = new Command();

program
    .name('seha')
    .description('SEHA Automated Acceptance CLI')
    .version('1.0.1');

program.command('login')
    .description('Login to SEHA via CapSolver + Password + OTP')
    .option('-k, --capsolver-key <key>', 'CapSolver API key')
    .option('-u, --username <id>', 'ID/Iqama number')
    .option('-p, --password <pass>', 'Password')
    .option('--recaptcha-key <key>', 'Override reCAPTCHA site key')
    .action(async (options) => {
        try {
            const { interactiveLogin } = await import('../lib/login.js');
            // Save config if provided via CLI
            if (options.capsolverKey) saveConfig({ capsolver_key: options.capsolverKey });
            if (options.username) saveConfig({ username: options.username });
            if (options.password) saveConfig({ password: options.password });
            if (options.recaptchaKey) saveConfig({ recaptcha_key: options.recaptchaKey });

            await interactiveLogin({
                capsolverKey: options.capsolverKey,
                username: options.username,
                password: options.password
            });
        } catch (e) {
            log.error(`Login Failed: ${e.message}`);
            process.exit(1);
        }
    });

program.command('status')
    .description('Check saved configuration and connectivity')
    .action(async () => {
        const token = await getValidToken(false);
        if (!token) {
            log.warn('Not logged in. Run "seha login"');
            return;
        }

        // Removed detailed check to match auth.js return type (string)
        log.success('Token configured.');
        // log.data('Token', token.substring(0, 20) + '...'); // Removed for security/debug cleanup

        log.info('Checking connectivity to referrals...');

        log.info('Checking connectivity to referrals...');
        try {
            const config = loadConfig();
            const authCookie = getAuthCookieString(config?.cookie ?? config?.COOKIES);
            const data = await getReferrals(token, authCookie);
            log.success(`Connected! Found ${(data.items || []).length} referrals.`);
        } catch (e) {
            const status = e.response?.status;
            if (status === 401) {
                log.error('Weslah API: 401 Unauthorized — Cannot fetch referrals.');
            } else {
                log.error(`Connectivity failed: ${status || e.message}`);
            }
        }
    });

// NEW: Test Session Command (Matches New Folder logic)
program.command('test-session')
    .description('Check session validty. If expired, login interactive.')
    .action(async () => {
        try {
            const { checkSessionAndLogin } = await import('../lib/check_session.js');
            await checkSessionAndLogin(false);
        } catch (e) {
            log.error(`Error: ${e.message}`);
        }
    });

program.command('monitor')
    .description('Interactive / Passive Monitor (UI Dashboard)')
    // Options removed as we are matching New Folder exact behavior which handles it internally or simply
    .action(async () => {
        try {
            // Logic: Check Session -> (auto login if needed) -> Start Monitor
            const { checkSessionAndLogin } = await import('../lib/check_session.js');
            // checkSessionAndLogin(true) will start monitor if valid/login success
            await checkSessionAndLogin(true);
        } catch (e) {
            log.error(`Monitor Error: ${e.message}`);
        }
    });

program.command('start')
    .description('Start the acceptance process')
    .requiredOption('-c, --case <id>', 'Case ID to accept')
    .requiredOption('-f, --file <path>', 'Path to PDF file to upload')
    .option('-t, --time <HH:mm:ss>', 'Target time (e.g., 14:30:00)')
    .option('--threads <number>', 'Burst concurrency (default: 20)', '20')
    .action(async (options) => {
        const token = await getValidToken();
        if (!token) return log.error('Authentication required.');

        const config = loadConfig();
        const cookie = config?.cookie;

        log.step('Phase 1: Pre-Upload');
        let fileId;
        try {
            fileId = await uploadFile(token, cookie, options.file);
        } catch (e) {
            log.error('Upload Failed: ' + e.message);
            return;
        }

        // 2. Wait Phase (if time specified)
        if (options.time) {
            const now = new Date();
            const [h, m, s] = options.time.split(':').map(Number);
            const target = new Date();
            target.setHours(h, m, s, 0);
            if (target < now) {
                log.warn('Target time is in the past! Starting immediately...');
            } else {
                const waitMs = target - now;
                log.info(`Waiting for ${Math.round(waitMs / 1000)} seconds...`);
                await sleep(waitMs - 2000);
            }
        }

        // 3. Accept Phase
        log.step('Phase 2: Burst Acceptance');
        await acceptCaseBurst(token, cookie, options.case, fileId, parseInt(options.threads));
    });

program.command('generate')
    .description('Generate a PDF report from template')
    .option('-o, --output <filename>', 'Output filename', 'report.pdf')
    .option('--name <text>', 'Patient Name', 'Test Patient Name')
    .action(async (options) => {
        try {
            const { generateReport } = await import('../lib/pdf.js');
            await generateReport(options.output, { patientname: options.name });
        } catch (e) {
            log.error('Generation Failed: ' + e.message);
        }
    });

program.command('test')
    .description('Run a full test of PDF generation with sample data')
    .action(async () => {
        try {
            log.step('Running PDF Test...');
            const { generateReport } = await import('../lib/pdf.js');
            const sampleData = { patientname: "Test Patient" };
            await generateReport('test_result.pdf', sampleData);
            log.success('Test Complete. Check test_result.pdf');
        } catch (e) {
            log.error('Test Failed: ' + e.message);
        }
    });

program.command('simulate')
    .description('Run High-Fidelity Acceptance Simulation')
    .action(async () => {
        try {
            const { startSimulator } = await import('../lib/simulator.js');
            await startSimulator();
        } catch (e) {
            log.error(`Simulation Error: ${e.message}`);
        }
    });

program.command('dashboard')
    .description('Launch the Web Dashboard (public URL)')
    .action(async () => {
        try {
            const { startDashboardServer } = await import('../lib/web_dashboard.js');
            const url = await startDashboardServer();
            log.success(`Dashboard running at: ${url}`);
            log.info('Press Ctrl+C to stop.');
            // Keep the process alive
            await new Promise(() => { });
        } catch (e) {
            log.error(`Dashboard Error: ${e.message}`);
        }
    });

// Check for default execution (no args)
if (process.argv.length <= 2) {

    // --- NEW: Auto-Start for Railway / Production ---
    const isProduction = process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production' || process.env.PORT;

    if (isProduction) {
        (async () => {
            try {
                // log.info('Detected Production Environment. Starting Monitor/Dashboard...');
                const { checkSessionAndLogin } = await import('../lib/check_session.js');
                // checkSessionAndLogin(true) => Starts Monitor + Dashboard if session valid (or after login)
                // If login fails (and interactive is impossible), it will exit or fail. 
                // Since we updated config.js to read ENV vars, non-interactive login should work!
                await checkSessionAndLogin(true);

                // Keep alive
                await new Promise(() => { });
            } catch (e) {
                console.error('Auto-Start Error:', e);
                process.exit(1);
            }
        })();
    } else {
        // No args provided -> Launch Interactive Wizard
        (async () => {
            try {
                const { startWizard } = await import('../lib/wizard.js');
                await startWizard();
            } catch (e) {
                console.error('Wizard Error:', e);
            }
        })();
    }
} else {
    program.parse();
}
