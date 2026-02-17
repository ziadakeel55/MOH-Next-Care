// ==========================================
// COLOR & UI CONSTANTS
// ==========================================
export const C = {
    Reset: "\x1b[0m",
    Bright: "\x1b[1m",
    Dim: "\x1b[2m",
    Underscore: "\x1b[4m",
    Blink: "\x1b[5m",
    Reverse: "\x1b[7m",
    Hidden: "\x1b[8m",

    // Foreground
    Black: "\x1b[30m",
    Red: "\x1b[31m",
    Green: "\x1b[32m",
    Yellow: "\x1b[33m",
    Blue: "\x1b[34m",
    Magenta: "\x1b[35m",
    Cyan: "\x1b[36m",
    White: "\x1b[37m",
    Gray: "\x1b[90m",

    // Background
    BgBlack: "\x1b[40m",
    BgRed: "\x1b[41m",
    BgGreen: "\x1b[42m",
    BgYellow: "\x1b[43m",
    BgBlue: "\x1b[44m",
    BgMagenta: "\x1b[45m",
    BgCyan: "\x1b[46m",
    BgWhite: "\x1b[47m"
};

export const ICONS = {
    Approved: `${C.Green}✔️ `,
    Rejected: `${C.Red}❌ `,
    Pending: `${C.Yellow}⏳ `,
    Closed: `${C.Dim}🔒 `,
    Unknown: `❓ `
};

export const BOX = {
    // Single Line
    topLeft: '┌',
    topRight: '┐',
    bottomRight: '┘',
    bottomLeft: '└',
    vertical: '│',
    horizontal: '─',
    cross: '┼',
    topT: '┬',
    bottomT: '┴',
    leftT: '├',
    rightT: '┤',

    // Double Line
    D: {
        topLeft: '╔',
        topRight: '╗',
        bottomRight: '╝',
        bottomLeft: '╚',
        vertical: '║',
        horizontal: '═',
        cross: '╬',
        topT: '╦',
        bottomT: '╩',
        leftT: '╠',
        rightT: '╣'
    }
};

// ==========================================
// UTILS
// ==========================================

export function getStatusInfo(statusId) {
    switch (String(statusId)) {
        case '1': return { text: 'Approved', color: C.Green, icon: ICONS.Approved };
        case '2': return { text: 'Rejected', color: C.Red, icon: ICONS.Rejected };
        case '3': return { text: 'Pending', color: C.Yellow, icon: ICONS.Pending };
        case '4': return { text: 'Closed', color: C.Dim, icon: ICONS.Closed };
        default: return { text: `Status ${statusId}`, color: C.White, icon: ICONS.Unknown };
    }
}

export function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

export function stripAnsi(str) {
    return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

/**
 * pads a string with ansi colors correctly
 */
export function padAnsi(str, len) {
    const visibleLen = stripAnsi(str).length;
    const diff = len - visibleLen;
    if (diff <= 0) return str;
    return str + ' '.repeat(diff);
}

export function centerAnsi(str, width) {
    const visibleLen = stripAnsi(str).length;
    if (visibleLen >= width) return str;
    const leftPad = Math.floor((width - visibleLen) / 2);
    const rightPad = width - visibleLen - leftPad;
    return ' '.repeat(leftPad) + str + ' '.repeat(rightPad);
}

export function drawLine(width, start, mid, end, style = 'single') {
    // Safety check
    if (width < 2) width = 2;
    const b = style === 'double' ? BOX.D : BOX;
    return start + b.horizontal.repeat(width - 2) + end;
}

export function getTermWidth() {
    return process.stdout.columns || 80;
}

// --- NEW: Card View for Mobile (Vertical Layout) ---
function drawCardList(rows, title) {
    const width = Math.min(getTermWidth(), 60); // Cap width for readability
    console.log(`\n${C.Bright}${C.Cyan}${BOX.D.topLeft}${BOX.D.horizontal.repeat(width - 2)}${BOX.D.topRight}`);
    console.log(`${BOX.D.vertical}${centerAnsi(` ${title} `, width - 2)}${BOX.D.vertical}`);
    console.log(`${BOX.D.bottomLeft}${BOX.D.horizontal.repeat(width - 2)}${BOX.D.bottomRight}${C.Reset} ${C.Dim}(${rows.length})${C.Reset}`);

    if (!rows || rows.length === 0) {
        console.log(`${C.Dim}   (No cases found)${C.Reset}`);
        return;
    }

    rows.forEach((row, i) => {
        const statusInfo = getStatusInfo(row.status);

        // Compact Card:
        // #1 Patient Name (ID: 101)
        //    Status: Approved

        console.log(`${C.Bright}#${i + 1} ${C.White}${row.patientName || 'Unknown'} ${C.Dim}(ID:${row.id || 'N/A'})${C.Reset}`);

        const stStr = `${statusInfo.icon} ${statusInfo.text}`;
        console.log(`   ${C.Dim}└──${C.Reset} ${stStr}`);
    });
    console.log("");
}

export function drawTable(rows, title) {
    const termWidth = getTermWidth();

    // SWITCH TO CARD VIEW ON MOBILE (< 70 chars)
    if (termWidth < 70) {
        return drawCardList(rows, title);
    }

    // Min width for table to look okay is around 40
    const totalWidth = Math.max(40, Math.min(termWidth, 100)); // Cap at 100 for readability on large screens

    // Title Box
    console.log(`\n${C.Bright}${C.Cyan}${BOX.D.topLeft}${BOX.D.horizontal.repeat(totalWidth - 2)}${BOX.D.topRight}`);
    const titleText = ` ${title} `;
    console.log(`${BOX.D.vertical}${centerAnsi(titleText, totalWidth - 2)}${BOX.D.vertical}`);
    const footerText = ` (Items: ${rows ? rows.length : 0}) `;
    console.log(`${BOX.D.bottomLeft}${BOX.D.horizontal.repeat(totalWidth - 2)}${BOX.D.bottomRight}${C.Reset}${C.Dim}${footerText}${C.Reset}`);

    if (!rows || rows.length === 0) {
        console.log(`${C.Dim}   (No cases found)${C.Reset}`);
        return;
    }

    // Dynamic Columns based on width (Desktop)
    let cols = [];
    if (totalWidth < 70) {
        // Should not happen due to Card View switch, but keeping as fallback
        cols = [
            { header: '#', width: 4, field: 'idx', align: 'center' },
            { header: 'ID', width: 10, field: 'id', align: 'left' },
            { header: 'Patient Name', width: totalWidth - 30, field: 'patientName', align: 'left' },
            { header: 'Status', width: 10, field: 'status', align: 'left' }
        ];
    } else {
        // Full Mode
        cols = [
            { header: '#', width: 5, field: 'idx', align: 'center' },
            { header: 'ID', width: 14, field: 'id', align: 'left' },
            { header: 'Patient Name', width: totalWidth - 45, field: 'patientName', align: 'left' },
            { header: 'Status', width: 20, field: 'status', align: 'left' }
        ];
    }

    // Draw Header Top
    // ┌──────┬──────────...
    let top = BOX.topLeft;
    let midLine = BOX.leftT;
    let bot = BOX.bottomLeft;

    cols.forEach((c, i) => {
        const isLast = i === cols.length - 1;
        top += BOX.horizontal.repeat(c.width) + (isLast ? BOX.topRight : BOX.topT);
        midLine += BOX.horizontal.repeat(c.width) + (isLast ? BOX.rightT : BOX.cross);
        bot += BOX.horizontal.repeat(c.width) + (isLast ? BOX.bottomRight : BOX.bottomT);
    });

    console.log(C.White + top);

    // Header Content
    let headerStr = BOX.vertical;
    cols.forEach(c => {
        headerStr += padAnsi(` ${C.Bright}${c.header}${C.Reset}`, c.width) + BOX.vertical;
    });
    console.log(headerStr);
    console.log(midLine);

    // Rows
    rows.forEach((row, i) => {
        const statusInfo = getStatusInfo(row.status);

        let rowStr = BOX.vertical;

        // Iterate through defined columns to ensure safety
        cols.forEach(col => {
            if (col.field === 'idx') {
                rowStr += padAnsi(` ${i + 1}`, col.width) + BOX.vertical;
            } else if (col.field === 'id') {
                rowStr += padAnsi(` ${C.Cyan}${row.id || ''}${C.Reset}`, col.width) + BOX.vertical;
            } else if (col.field === 'patientName') {
                let name = String(row.patientName || '');
                const maxLen = col.width - 2; // padding
                if (name.length > maxLen) name = name.substring(0, maxLen - 2) + '..';
                rowStr += padAnsi(` ${C.White}${name}${C.Reset}`, col.width) + BOX.vertical;
            } else if (col.field === 'status') {
                let status = `${statusInfo.icon} ${statusInfo.text}`;
                if (col.width < 10) {
                    status = statusInfo.icon.trim();
                }
                rowStr += padAnsi(` ${statusInfo.color}${status}${C.Reset}`, col.width) + BOX.vertical;
            } else {
                rowStr += padAnsi(` --`, col.width) + BOX.vertical;
            }
        });

        console.log(rowStr);
    });

    console.log(bot + C.Reset);
}

// --- NEW: Selection Card View for Mobile ---
function drawSelectionCardList(rows, title) {
    const width = Math.min(getTermWidth(), 65);
    console.log(`\n${C.Bright}${C.Cyan}${BOX.D.topLeft}${BOX.D.horizontal.repeat(width - 2)}${BOX.D.topRight}`);
    console.log(`${BOX.D.vertical}${centerAnsi(` ${title} `, width - 2)}${BOX.D.vertical}`);
    console.log(`${BOX.D.bottomLeft}${BOX.D.horizontal.repeat(width - 2)}${BOX.D.bottomRight}${C.Reset} ${C.Dim}(${rows.length})${C.Reset}`);

    if (rows.length === 0) {
        console.log(`${C.Dim}   (No cases found)${C.Reset}`);
        return;
    }

    rows.forEach((row, i) => {
        const statusInfo = getStatusInfo(row.status);

        // Header: #1 Patient Name (ID)
        console.log(`${C.Bright}#${i + 1} ${C.White}${row.patientName || 'Unknown'} ${C.Cyan}(${row.id || 'N/A'})${C.Reset}`);

        // Timings & Status merged
        const openTime = row.openTime ? new Date(row.openTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'NOW';
        const openColor = row.openTime && new Date(row.openTime) > new Date() ? C.Yellow : C.Green;

        console.log(`   ${C.Dim}└─${C.Reset} ${C.Dim}Open:${C.Reset}${openColor}${openTime}${C.Reset} ${statusInfo.icon}`);
    });
    console.log("");
}

// Selection Table with Dropped/Opens columns (like Simulator)
export function drawSelectionTable(rows, title) {
    const termWidth = getTermWidth();

    // SWITCH TO CARD VIEW ON MOBILE (< 75 chars)
    if (termWidth < 75) {
        return drawSelectionCardList(rows, title);
    }

    const totalWidth = Math.max(40, Math.min(termWidth, 100));

    console.log(`\n${C.Bright}${C.Cyan}${BOX.D.topLeft}${BOX.D.horizontal.repeat(totalWidth - 2)}${BOX.D.topRight}`);
    console.log(`${BOX.D.vertical}${centerAnsi(' ' + title + ' ', totalWidth - 2)}${BOX.D.vertical}`);
    console.log(`${BOX.D.bottomLeft}${BOX.D.horizontal.repeat(totalWidth - 2)}${BOX.D.bottomRight}${C.Reset}  ${C.Dim}(${rows.length} items)${C.Reset}`);

    if (rows.length === 0) {
        console.log(`${C.Dim}   (No cases found)${C.Reset}`);
        return;
    }

    let cols = [];


    // Responsive Column Logic
    if (totalWidth < 60) {
        // Mobile / Compressed
        // # (4), Name (Fluid), Open (8)
        cols = [
            { header: '#', width: 4 },
            { header: 'Patient', width: totalWidth - 16, },
            { header: 'Open', width: 8 }
        ];
    } else if (totalWidth < 85) {
        // Tablet / Small Laptop
        cols = [
            { header: '#', width: 4 },
            { header: 'ID', width: 10 },
            { header: 'Patient Name', width: totalWidth - 44 }, // Fluid
            { header: 'Opens', width: 10 },
            { header: 'Status', width: 14 }
        ];
    } else {
        // Full Desktop
        cols = [
            { header: '#', width: 4 },
            { header: 'ID', width: 10 },
            { header: 'Patient Name', width: totalWidth - 59 }, // Fluid
            { header: 'Broadcast', width: 12 },
            { header: 'Opens', width: 12 },
            { header: 'Status', width: 15 }
        ];
    }

    // Top border
    let top = BOX.topLeft;
    cols.forEach((c, i) => {
        top += BOX.horizontal.repeat(c.width) + (i === cols.length - 1 ? BOX.topRight : BOX.topT);
    });
    console.log(C.White + top);

    // Header
    let headerStr = BOX.vertical;
    cols.forEach(c => {
        headerStr += padAnsi(` ${C.Bright}${c.header}${C.Reset}`, c.width) + BOX.vertical;
    });
    console.log(headerStr);

    // Separator
    let sep = BOX.leftT;
    cols.forEach((c, i) => {
        sep += BOX.horizontal.repeat(c.width) + (i === cols.length - 1 ? BOX.rightT : BOX.cross);
    });
    console.log(sep);

    // Rows
    rows.forEach((row, i) => {
        const statusInfo = getStatusInfo(row.status);
        let r = BOX.vertical;

        // #
        if (cols.length > 0) r += padAnsi(` ${i + 1}`, cols[0].width) + BOX.vertical;

        // ID (Only if col exists)
        if (cols.some(c => c.header === 'ID')) {
            const col = cols.find(c => c.header === 'ID');
            r += padAnsi(` ${C.Cyan}${row.id || ''}${C.Reset}`, col.width) + BOX.vertical;
        }

        // Name (Patient or Patient Name)
        const nameCol = cols.find(c => c.header.includes('Patient'));
        if (nameCol) {
            let name = String(row.patientName || '');
            let max = nameCol.width - 2;
            if (name.length > max) name = name.substring(0, max - 2) + '..';
            r += padAnsi(` ${C.White}${name}${C.Reset}`, nameCol.width) + BOX.vertical;
        }

        // Broadcast (Only if exists)
        const dropCol = cols.find(c => c.header === 'Broadcast');
        if (dropCol) {
            const dropTime = row.broadcastedAt ? new Date(row.broadcastedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--:--';
            r += padAnsi(` ${C.Gray}${dropTime}${C.Reset}`, dropCol.width) + BOX.vertical;
        }

        // Opens/Open (Only if exists)
        const openCol = cols.find(c => c.header.startsWith('Open'));
        if (openCol) {
            const openTime = row.openTime ? new Date(row.openTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'NOW';
            const openColor = row.openTime && new Date(row.openTime) > new Date() ? C.Yellow : C.Green;
            // If very small col, trim time
            let showTime = openTime;
            if (openCol.width < 10) showTime = openTime.split(' ')[0]; // remove AM/PM if tight? Or just ensure width
            r += padAnsi(` ${openColor}${showTime}${C.Reset}`, openCol.width) + BOX.vertical;
        }

        // Status (Only if exists)
        const statCol = cols.find(c => c.header === 'Status');
        if (statCol) {
            const st = `${statusInfo.icon} ${statusInfo.text}`;
            r += padAnsi(` ${st}`, statCol.width) + BOX.vertical;
        }

        console.log(r);
    });

    // Bottom
    let bot = BOX.bottomLeft;
    cols.forEach((c, i) => {
        bot += BOX.horizontal.repeat(c.width) + (i === cols.length - 1 ? BOX.bottomRight : BOX.bottomT);
    });
    console.log(bot + C.Reset);
}

// --- NEW HELPER: Persistent Case Header ---
export function printCaseHeader(selectedCase, statusMessage = "", stepsStatus = {}) {
    console.clear();
    const termWidth = getTermWidth();

    // --- MOBILE CARD LAYOUT (Borderless, < 65 chars) ---
    if (termWidth < 65) {
        const width = Math.min(termWidth, 60);

        // Top Separator
        console.log(`${C.Bright}${C.Blue}${BOX.D.horizontal.repeat(width)}${C.Reset}`);

        // 1. Patient Info (Multi-line)
        const name = selectedCase.patientName || "Unknown";
        const id = selectedCase.id || selectedCase.referralReferenceId || "";
        console.log(`${C.Bright} 👤 ${name}`);
        if (id) console.log(`    ${C.Cyan}(${id})${C.Reset}`);

        // 2. Timings & Status
        const dropTime = selectedCase.broadcastedAt ? new Date(selectedCase.broadcastedAt).toLocaleTimeString() : 'Unknown';
        const openTime = selectedCase.openTime ? new Date(selectedCase.openTime).toLocaleTimeString() : 'Unknown';

        console.log(`    ${C.Dim}Broadcast:${C.Reset} ${dropTime}`);
        console.log(`    ${C.Dim}Open:     ${C.Reset} ${C.Yellow}${openTime}${C.Reset}`);

        console.log(C.Blue + BOX.horizontal.repeat(width) + C.Reset);

        // 3. Steps (Simple Icon List)
        const s = stepsStatus;
        const pdf = s.pdf === 'done' ? `${C.Green}✔PDF${C.Reset}` : (s.pdf === 'running' ? `${C.Yellow}↻PDF${C.Reset}` : `${C.Dim}PDF${C.Reset}`);
        const up = s.upload === 'done' ? `${C.Green}✔Up${C.Reset}` : (s.upload === 'running' ? `${C.Yellow}↻Up${C.Reset}` : `${C.Dim}Up${C.Reset}`);
        const tok = s.token === 'done' ? `${C.Green}✔Tok${C.Reset}` : (s.token === 'running' ? `${C.Yellow}↻Tok${C.Reset}` : `${C.Dim}Tok${C.Reset}`);
        const acc = s.accept === 'done' ? `${C.Green}✔Acc${C.Reset}` : (s.accept === 'running' ? `${C.Yellow}↻Acc${C.Reset}` : `${C.Dim}Acc${C.Reset}`);

        console.log(`    ${pdf}  ${up}  ${tok}  ${acc}`);

        console.log(C.Blue + BOX.horizontal.repeat(width) + C.Reset);

        // 4. Message
        if (statusMessage) {
            console.log(` ℹ ${statusMessage}`);
        }

        console.log(`${C.Bright}${C.Blue}${BOX.D.horizontal.repeat(width)}${C.Reset}`);
        return;
    }

    // --- DESKTOP LAYOUT (Boxed) ---
    const width = 80;

    console.log(C.Blue + BOX.D.topLeft + BOX.D.horizontal.repeat(width) + BOX.D.topRight + C.Reset);

    // Enriched Info
    const name = selectedCase.patientname || selectedCase.patientName || "Unknown";
    const id = selectedCase.referralnumber || selectedCase.id || "000";
    const dropTimeStr = (selectedCase.broadcastedAt || selectedCase.createdAt || selectedCase.createdDate) ? new Date(selectedCase.broadcastedAt || selectedCase.createdAt || selectedCase.createdDate).toLocaleTimeString() : 'N/A';
    const openTimeStr = selectedCase.openTime ? new Date(selectedCase.openTime).toLocaleTimeString() : 'NOW';

    // Formatted Line:  👤 Name (ID) | 🕒 Broadcast | ⏰ Open
    // Reverted to simple Desktop Line for safety
    const line1 = `👤 ${name} (${id})`;
    const line2 = `Broadcast: ${dropTimeStr} | Open: ${openTimeStr}`;

    console.log(`${C.Blue}║${C.Reset} ${centerAnsi(line1, width)} ${C.Blue}║${C.Reset}`);
    console.log(`${C.Blue}║${C.Reset} ${centerAnsi(line2, width)} ${C.Blue}║${C.Reset}`);

    // Separator
    console.log(C.Blue + BOX.D.leftT + BOX.D.horizontal.repeat(width) + BOX.D.rightT + C.Reset);

    // Steps Status
    const s = stepsStatus;
    const pdf = s.pdf === 'done' ? `${C.Green}✔ PDF${C.Reset}` : (s.pdf === 'running' ? `${C.Yellow}↻ PDF${C.Reset}` : `${C.Dim}PDF${C.Reset}`);
    const up = s.upload === 'done' ? `${C.Green}✔ Up${C.Reset}` : (s.upload === 'running' ? `${C.Yellow}↻ Up${C.Reset}` : `${C.Dim}Up${C.Reset}`);
    const tok = s.token === 'done' ? `${C.Green}✔ Tok${C.Reset}` : (s.token === 'running' ? `${C.Yellow}↻ Tok${C.Reset}` : `${C.Dim}Tok${C.Reset}`);
    const acc = s.accept === 'done' ? `${C.Green}✔ Acc${C.Reset}` : (s.accept === 'running' ? `${C.Yellow}↻ Acc${C.Reset}` : `${C.Dim}Acc${C.Reset}`);

    const stepsStr = `${pdf}   ${up}   ${tok}   ${acc}`;
    console.log(`${C.Blue}║${C.Reset} ${centerAnsi(stepsStr, width)} ${C.Blue}║${C.Reset}`);

    console.log(C.Blue + BOX.D.leftT + BOX.D.horizontal.repeat(width) + BOX.D.rightT + C.Reset);

    if (statusMessage) {
        console.log(`${C.Blue}║${C.Reset} ℹ ${statusMessage.padEnd(width - 3)} ${C.Blue}║${C.Reset}`);
        console.log(C.Blue + BOX.D.bottomLeft + BOX.D.horizontal.repeat(width) + BOX.D.bottomRight + C.Reset);
    } else {
        console.log(C.Blue + BOX.D.bottomLeft + BOX.D.horizontal.repeat(width) + BOX.D.bottomRight + C.Reset);
    }
    console.log("");
}
