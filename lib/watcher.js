import fetch from 'node-fetch';
import { loadConfig, saveConfig } from './config.js';
import { getReferrals } from './api.js';
import { USER_AGENT } from './utils.js';
import { getClient } from './client.js';
import chalk from 'chalk';

const log = {
    info: (msg) => console.log(chalk.blue(msg)),
    success: (msg) => console.log(chalk.green(msg)),
    warn: (msg) => console.log(chalk.yellow(msg)),
    error: (msg) => console.log(chalk.red(msg)),
    step: (msg) => console.log(chalk.cyan(chalk.bold(msg)))
};

/* 
 * WATCHER LOGIC
 * Ported from Chrome Extension 'Monitor/content.js'
 * Features:
 * - Local Persistence (watcher_state.json)
 * - IFTTT Notifications
 * - Tab 2 Monitoring (Status Changes)
 */

let localProcessedIds = [];
let localTab2State = {}; // Map: ID -> Status

// ... imports and setup ...

// Skipping unchanged parts...

// --- TAB 1 ANALYSIS (New Cases) ---

export async function analyzeTab1(rows, token, isSimulation = false) {
    await loadState(isSimulation);

    const uncachedItems = rows.filter(r => !localProcessedIds.includes(r.id?.toString()));

    if (uncachedItems.length > 0) {
        log.info(`🔎 Found ${uncachedItems.length} potential new items.`);

        let needsSave = false;

        for (let item of uncachedItems) {
            const id = item.id.toString();

            log.success(`🆕 TRULY NEW: ${id} - ${item.patientName}`);

            // Fetch details for attachments if needed
            if (!isSimulation) {
                try {
                    const client = getClient(token);
                    const detailRes = await client.get(`https://weslah.seha.sa/api/referrals/${id}`);
                    if (detailRes.data) item.attachments = detailRes.data.attachments;
                } catch (e) { }
            }

            await sendToIFTTT(item, null, isSimulation);

            localProcessedIds.push(id);
            needsSave = true;
        }

        if (needsSave) await saveState(isSimulation);
    }
}

// --- TAB 2 ANALYSIS (Status Changes) ---

export async function checkTab2(token, isSimulation = false) {
    if (isSimulation) {
        // Mock Tab 2 Random Event
        if (Math.random() > 0.7) {
            const mockRow = {
                id: "SIM-101",
                patientName: "Simulation Patient A",
                status: Math.random() > 0.5 ? 2 : 3,
                referralType: "Simulated Consult"
            };
            await analyzeTab2([mockRow], isSimulation);
        }
        return;
    }

    try {
        const config = await loadConfig(); // Helper to access cookie if needed, though getClient usually takes (token, cookie)
        const client = getClient(token, config?.cookie);

        const response = await client.post('https://weslah.seha.sa/api/referrals/facility/tabs', {
            pageNumber: 1, pageSize: 10, sortField: "createdDate", sortDirection: "DESC", tab: 2
        });

        if (response.data && response.data.data) {
            await analyzeTab2(response.data.data, isSimulation);
        }
    } catch (e) {
        log.warn("Tab 2 Check Failed: " + e.message);
    }
}

const STATE_FILE = 'session/watcher_state.json';
import fs from 'fs';

// --- HELPERS ---

async function loadState(isSimulation) {
    if (isSimulation) return; // Simulation uses memory only

    // 1. Load from Disk
    if (fs.existsSync(STATE_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            if (data.processedIds) localProcessedIds = data.processedIds;
            if (data.tab2State) localTab2State = data.tab2State;
        } catch (e) {
            log.warn("Failed to load local state: " + e.message);
        }
    }
}

async function saveState(isSimulation) {
    if (isSimulation) return;
    try {
        const data = {
            processedIds: [...new Set(localProcessedIds)],
            tab2State: localTab2State
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        log.warn("Failed to save local state: " + e.message);
    }
}

// ... fetchCloudData/updateCloudData/sendToIFTTT remain mostly same but ensure they use config ...
// We need to make sure analyzeTab2 checks this data.

export async function analyzeTab2(rows, isSimulation = false) {
    await loadState(isSimulation);
    let stateChanged = false;
    let events = [];

    // Check for changes
    for (let item of rows) {
        const id = item.id.toString();

        if (!localTab2State.hasOwnProperty(id)) {
            // It's NOT in local memory/disk.
            if (localProcessedIds.includes(id)) {
                // Known case, just tracking status now
                localTab2State[id] = item.status;
                stateChanged = true;
            } else {
                // TRULY NEW to the system
                const msg = `🆕 Tab 2 New: ${id} - ${item.patientName}`;
                log.info(msg);
                events.push(msg);
                await sendToIFTTT(item, `🔔 Tab 2 New: ${item.patientName}`, isSimulation);

                localTab2State[id] = item.status;
                localProcessedIds.push(id);
                stateChanged = true;
            }
        } else {
            // Existing in Local
            const oldStatus = localTab2State[id];
            const newStatus = item.status;
            if (oldStatus !== newStatus) {
                const oldTxt = getStatusText(oldStatus);
                const newTxt = getStatusText(newStatus);
                const msg = `🔄 Tab 2 Change: ${id} (${oldTxt} -> ${newTxt})`;
                log.warn(msg);
                events.push(msg);
                await sendToIFTTT(item, `⚠️ Status Changed: ${oldTxt} ➔ ${newTxt}`, isSimulation);
                localTab2State[id] = newStatus;
                stateChanged = true;
            }
        }
    }

    if (stateChanged) await saveState(isSimulation);
    return events;
}

async function sendToIFTTT(item, message, isSimulation) {
    const config = await loadConfig();

    // Support both direct URL and key/event style
    let url = config.ifttt?.webhook_url;
    if (!url && config.ifttt_key) {
        const event = config.ifttt_event || 'seha_alert';
        url = `https://maker.ifttt.com/trigger/${event}/with/key/${config.ifttt_key}`;
    }

    if (!url) return;

    // --- HTML Email Construction (Ported from Monitor V1) ---
    const subject = message || `📢 New Referral: ${item.referralType} - ${item.patientName}`;

    // Helper for safe values
    const val = (v) => v || 'N/A';
    const reason = Array.isArray(item.referralReason) ? item.referralReason.join(', ') : item.referralReason;
    const statusText = getStatusText(item.status);

    // Attachments
    let attachmentsHtml = '';
    if (item.attachments && item.attachments.length > 0) {
        attachmentsHtml += `<tr><th colspan="2" style="background-color: #e67e22; color: white; padding: 10px;">📎 Attachments</th></tr>`;
        item.attachments.forEach(att => {
            // Ensure full URL if relative
            let fileUrl = att.fileUrl;
            if (fileUrl && !fileUrl.startsWith('http')) {
                fileUrl = `https://weslah.seha.sa${fileUrl}`;
            }
            attachmentsHtml += `<tr><td style="padding: 10px; border: 1px solid #ddd;" colspan="2"><a href="${fileUrl}" target="_blank" style="color:#2980b9; text-decoration:none;">📄 ${att.fileName}</a></td></tr>`;
        });
    }

    const styleTable = 'width:100%; border-collapse: collapse; font-family: Arial, sans-serif;';
    const styleTh = 'padding: 10px; border: 1px solid #ddd; background-color: #f2f2f2; text-align: left; width: 30%;';
    const styleTd = 'padding: 10px; border: 1px solid #ddd;';

    let bodyHtml = `
        <div style="font-family: Arial, sans-serif; color: #333;">
            <h2 style="color: #2c3e50;">New Referral Details</h2>
            <table style="${styleTable}">
                <!-- Patient Info -->
                <tr><th colspan="2" style="background-color: #3498db; color: white; padding: 10px;">👤 Patient Information</th></tr>
                <tr><td style="${styleTh}">Name</td><td style="${styleTd}">${val(item.patientName)}</td></tr>
                <tr><td style="${styleTh}">National ID</td><td style="${styleTd}">${val(item.patientNationalId)}</td></tr>
                <tr><td style="${styleTh}">Nationality</td><td style="${styleTd}">${val(item.patientNationality)}</td></tr>
                <tr><td style="${styleTh}">DOB</td><td style="${styleTd}">${val(item.patientDOB)}</td></tr>
                <tr><td style="${styleTh}">Mobile</td><td style="${styleTd}">${val(item.patientMobile)}</td></tr>

                <!-- Referral Info -->
                <tr><th colspan="2" style="background-color: #27ae60; color: white; padding: 10px;">📋 Referral Information</th></tr>
                <tr><td style="${styleTh}">Type</td><td style="${styleTd}"><strong>${val(item.referralType)}</strong></td></tr>
                <tr><td style="${styleTh}">Referral ID</td><td style="${styleTd}">${val(item.referralId)}</td></tr>
                <tr><td style="${styleTh}">Reference ID</td><td style="${styleTd}">${val(item.referralReferenceId)}</td></tr>
                <tr><td style="${styleTh}">Source</td><td style="${styleTd}">${val(item.source)}</td></tr>
                <tr><td style="${styleTh}">Status</td><td style="${styleTd}"><strong>${statusText}</strong></td></tr>
                <tr><td style="${styleTh}">Created At</td><td style="${styleTd}">${val(item.createdAt)}</td></tr>
                <tr><td style="${styleTh}">Reason</td><td style="${styleTd}" style="color: #e74c3c;">${val(reason)}</td></tr>

                <!-- Medical & Provider -->
                <tr><th colspan="2" style="background-color: #8e44ad; color: white; padding: 10px;">🏥 Medical & Provider</th></tr>
                <tr><td style="${styleTh}">Provider Name</td><td style="${styleTd}">${val(item.providerName)}</td></tr>
                <tr><td style="${styleTh}">Region</td><td style="${styleTd}">${val(item.providerRegion)}</td></tr>
                <tr><td style="${styleTh}">Specialty</td><td style="${styleTd}">${val(item.mainSpecialty)} - ${val(item.subSpecialty)}</td></tr>
                <tr><td style="${styleTh}">Bed Type</td><td style="${styleTd}">${val(item.requestedBedType)}</td></tr>

                <!-- Attachments -->
                ${attachmentsHtml}
            </table>
            <br>
            <br>
            <p style="font-size: 12px; color: #777;">Sent by MOH-Next-Care V2.0</p>
        </div>
        </div>
    `;

    // -----------------------------------------------------

    const val1 = subject;
    const val2 = bodyHtml; // Now sending HTML body instead of ID!
    const val3 = item.id || "No ID";

    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value1: val1, value2: val2, value3: val3 })
        });
        log.info("🔔 IFTTT Sent (HTML Format)");
    } catch (e) {
        log.warn("IFTTT Failed: " + e.message);
    }
}

function getStatusText(status) {
    switch (String(status)) {
        case '1': return 'Pending';
        case '2': return 'Under Process';
        case '3': return 'Accepted';
        case '4': return 'Rejected';
        case '6': return 'Completed';
        default: return `Status(${status})`;
    }
}
