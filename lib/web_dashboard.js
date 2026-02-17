import express from 'express';
import { loadConfig } from './config.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
//  SHARED DATA STORE (updated by monitor/simulator)
// ==========================================
export const dashboardData = {
    tab1: [],
    tab2: [],
    tab2Total: 0,
    events: [],
    lastUpdate: null,
    mode: 'real',
    uptime: 0,
    startTime: Date.now(),
    counter: 0,
    nextUpdateIn: 0
};

const PORT = process.env.PORT || 3000;
let serverInstance = null;
let tunnelInstance = null;
let publicUrl = null;
let tunnelPasswordValue = null;

// ==========================================
//  HTML DASHBOARD TEMPLATE
// ==========================================
function getStatusInfo(statusId) {
    switch (String(statusId)) {
        case '1': return { text: 'Approved', color: '#10b981', bg: 'rgba(16,185,129,0.15)', icon: '✔️' };
        case '2': return { text: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', icon: '❌' };
        case '3': return { text: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', icon: '⏳' };
        case '4': return { text: 'Closed', color: '#64748b', bg: 'rgba(100,116,139,0.15)', icon: '🔒' };
        case '6': return { text: 'Completed', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', icon: '🏁' };
        default: return { text: 'Status ' + statusId, color: '#6b7280', bg: 'rgba(107,114,128,0.15)', icon: '❓' };
    }
}

function generateHTML() {
    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>MOH-Next-Care | Dashboard</title>
    <meta name="description" content="MOH-Next-Care Live Dashboard">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Cairo:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --bg-glass: rgba(30, 41, 59, 0.7);
            --bg-card: rgba(30, 41, 59, 0.85);
            --border: rgba(255, 255, 255, 0.08);
            --border-hover: rgba(255, 255, 255, 0.15);
            --text-primary: #f8fafc;
            --text-secondary: #94a3b8;
            --text-muted: #64748b;
            --accent-blue: #3b82f6;
            --accent-green: #10b981;
            --accent-yellow: #f59e0b;
            --accent-red: #ef4444;
            --accent-purple: #8b5cf6;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Inter', 'Cairo', sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            min-height: 100vh;
            overflow-x: hidden;
            background-image: 
                radial-gradient(circle at 15% 50%, rgba(59, 130, 246, 0.08), transparent 25%),
                radial-gradient(circle at 85% 30%, rgba(139, 92, 246, 0.08), transparent 25%);
        }

        .container {
            max-width: 1600px;
            margin: 0 auto;
            padding: 10px; /* Mobile padding default */
        }

        /* ===== HEADER & METRICS ===== */
        .top-section {
            background: var(--bg-glass);
            backdrop-filter: blur(12px);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 14px;
            margin-bottom: 14px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            display: grid;
            grid-template-columns: 1fr; /* Mobile default: Stacked */
            gap: 16px;
        }

        .brand {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .brand-logo {
            width: 36px; height: 36px;
            background: linear-gradient(135deg, #3b82f6, #8b5cf6);
            border-radius: 8px;
            display: flex; align-items: center; justify-content: center;
            font-size: 18px;
            box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
            flex-shrink: 0;
        }

        .brand-info h1 { font-size: 1rem; font-weight: 800; color: #fff; line-height: 1.2; }
        .brand-info p { font-size: 0.7rem; color: var(--text-muted); }
        .mode-badge {
            display: inline-block; margin-top: 4px; padding: 2px 6px;
            background: var(--accent-blue); border-radius: 4px;
            font-size: 0.6rem; font-weight: bold; color: #fff;
        }

        /* Mobile Metrics: 2 columns */
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr); 
            gap: 8px;
        }
        
        .metric-card:last-child {
            grid-column: span 2;
        }

        .metric-card {
            background: rgba(255,255,255,0.03);
            border: 1px solid var(--border);
            border-radius: 10px;
            padding: 10px;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }

        .metric-label { font-size: 0.6rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.3px; }
        .metric-value { font-size: 1rem; font-weight: 700; color: var(--text-primary); }
        .metric-icon { font-size: 0.9rem; margin-bottom: 4px; }

        /* ===== NAVIGATION TABS ===== */
        .tabs-nav {
            display: flex;
            gap: 2px;
            margin-bottom: 0;
        }

        .tab-btn {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            border-bottom: none;
            padding: 10px 8px;
            border-radius: 10px 10px 0 0;
            color: var(--text-secondary);
            font-family: inherit;
            font-weight: 600;
            font-size: 0.8rem;
            cursor: pointer;
            transition: all 0.2s;
            display: flex; align-items: center; justify-content: center; gap: 6px;
            opacity: 0.7;
            flex: 1;
        }

        .tab-btn:hover { opacity: 1; background: rgba(255,255,255,0.05); }
        
        .tab-btn.active {
            background: var(--bg-glass);
            color: var(--accent-blue);
            opacity: 1;
            border-top: 3px solid var(--accent-blue);
            padding-top: 7px;
        }
        
        /* Mobile: Hide Tab Text by default */
        .tab-label-text { display: none; }
        
        .tab-badge {
            background: rgba(255,255,255,0.1);
            padding: 2px 5px;
            border-radius: 6px;
            font-size: 0.65rem;
        }
        
        .tab-btn.active .tab-badge { background: rgba(59, 130, 246, 0.2); color: var(--accent-blue); }

        /* ===== CONTENT AREA ===== */
        .content-panel {
            background: var(--bg-glass);
            backdrop-filter: blur(12px);
            border: 1px solid var(--border);
            border-radius: 0 0 12px 12px;
            padding: 0;
            overflow: hidden;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            min-height: 300px;
            display: flex;
            flex-direction: column;
        }
        
        /* ===== DEFAULT: CARD LAYOUT (Mobile First) ===== */
        .table-container { display: none; } /* Hide Table by default */
        .cards-container { display: block; padding: 12px; } /* Show Cards by default */

        .case-card {
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 14px;
            margin-bottom: 10px;
        }

        .card-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 10px;
            gap: 8px;
        }

        .card-patient {
            font-weight: 700;
            color: var(--text-primary);
            font-size: 0.95rem;
            line-height: 1.3;
        }

        .card-id {
            font-family: monospace;
            color: var(--accent-blue);
            font-size: 0.75rem;
            font-weight: 600;
            background: rgba(59,130,246,0.1);
            padding: 2px 8px;
            border-radius: 6px;
            flex-shrink: 0;
        }

        .card-fields {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
        }

        .card-field {
            display: flex;
            flex-direction: column;
            gap: 1px;
        }

        .card-field-label {
            font-size: 0.65rem;
            color: var(--text-muted);
            text-transform: uppercase;
            letter-spacing: 0.3px;
        }

        .card-field-value {
            font-size: 0.8rem;
            color: var(--text-secondary);
            font-weight: 500;
        }

        .card-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid var(--border);
            flex-wrap: wrap;
            gap: 8px;
        }

        .card-times {
            display: flex;
            gap: 16px;
        }

        .card-time {
            display: flex;
            flex-direction: column;
            gap: 1px;
        }

        .card-time-label {
            font-size: 0.6rem;
            color: var(--text-muted);
            text-transform: uppercase;
        }

        .card-time-value {
            font-size: 0.78rem;
            color: var(--accent-yellow);
            font-weight: 600;
        }

        /* Badge Styles */
        .table-badge {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 6px 14px; border-radius: 8px;
            font-size: 0.8rem; font-weight: 700;
            letter-spacing: 0.2px;
            white-space: nowrap;
        }

        /* ===== PAGINATION ===== */
        .pagination-controls {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 10px;
            padding: 14px;
            border-top: 1px solid var(--border);
            background: rgba(15, 23, 42, 0.5);
            flex-wrap: wrap;
        }

        .page-btn {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            color: var(--text-secondary);
            padding: 10px 16px; 
            border-radius: 10px;
            cursor: pointer;
            transition: all 0.2s;
            font-weight: 600;
            font-family: inherit;
            font-size: 0.8rem;
            min-width: 44px; /* Touch target */
            min-height: 44px; /* Touch target */
        }

        .page-btn:hover:not(:disabled) {
            background: var(--bg-glass);
            color: var(--text-primary);
            border-color: var(--accent-blue);
        }

        .page-btn.active {
            background: var(--accent-blue);
            color: #fff;
            border-color: var(--accent-blue);
        }

        .page-btn:disabled { opacity: 0.4; cursor: not-allowed; }

        .page-info {
            color: var(--text-muted);
            font-size: 0.8rem;
            font-weight: 500;
            text-align: center;
            width: 100%; /* Break to new line on very small screens */
            margin-bottom: 4px;
        }

        /* ===== EVENTS LOG ===== */
        .events-list { padding: 12px; }
        .event-row { 
            padding: 10px; 
            border-bottom: 1px solid var(--border); 
            color: var(--text-secondary);
            font-family: monospace;
            font-size: 0.8rem;
            display: flex; gap: 8px; flex-wrap: wrap;
        }
        .event-row:last-child { border-bottom: none; }
        .event-time { color: var(--accent-purple); min-width: 70px; }

        /* ===== EMPTY STATE ===== */
        .empty-view {
            padding: 60px 20px;
            text-align: center;
            color: var(--text-muted);
        }
        .empty-view .emoji { font-size: 2.5rem; margin-bottom: 12px; opacity: 0.5; }

        /* ===== FOOTER ===== */
        .footer { 
            text-align: center; 
            padding: 14px; 
            color: var(--text-muted); 
            font-size: 0.7rem; 
        }

        /* ========================================= */
        /* DESKTOP OVERRIDES (min-width: 1024px)     */
        /* ========================================= */
        @media (min-width: 1024px) {
            .container { padding: 24px; }
            
            .top-section {
                grid-template-columns: 280px 1fr;
                gap: 24px;
                padding: 24px;
                border-radius: 20px;
            }

            .brand-logo { width: 44px; height: 44px; font-size: 22px; }
            .brand-info h1 { font-size: 1.3rem; }
            .mode-badge { padding: 3px 8px; font-size: 0.65rem; }

            /* Metrics 5 columns now */
            .metrics-grid {
                grid-template-columns: repeat(5, 1fr);
                gap: 14px;
            }
            .metric-card { padding: 16px; }
            .metric-card:last-child { grid-column: auto; }
            .metric-label { font-size: 0.72rem; }
            .metric-value { font-size: 1.2rem; }

            /* Tabs with Labels */
            .tab-btn { flex: unset; padding: 12px 24px; font-size: 0.9rem; }
            .tab-label-text { display: inline; }
            .tab-badge { font-size: 0.7rem; padding: 2px 8px; }

            /* Content Area */
            .content-panel { min-height: 500px; border-radius: 0 0 20px 20px; }

            /* Switch to Table Layout */
            .table-container { 
                display: block; 
                width: 100%;
                overflow-x: auto;
                flex-grow: 1;
            }
            .cards-container { display: none; }

            /* Pagination Desktop */
            .pagination-controls { gap: 16px; }
            .page-info { width: auto; font-size: 0.9rem; margin-bottom: 0; }
            .page-btn { padding: 10px 20px; font-size: 0.85rem; min-width: auto; min-height: auto; }

            /* Table Styles */
            table {
                width: 100%;
                border-collapse: collapse;
                white-space: nowrap;
            }
            th {
                background: rgba(15, 23, 42, 0.95);
                padding: 16px 20px;
                text-align: right;
                font-size: 0.82rem;
                text-transform: uppercase;
                color: var(--text-muted);
                letter-spacing: 0.3px;
                border-bottom: 1px solid var(--border);
                position: sticky;
                top: 0;
                z-index: 10;
            }
            td {
                padding: 16px 20px;
                border-bottom: 1px solid var(--border);
                font-size: 0.92rem;
                color: var(--text-secondary);
                vertical-align: middle;
            }
            tbody tr:hover { background: rgba(255,255,255,0.03); }
            tbody tr:hover td { color: var(--text-primary); }
            
            .col-id { font-family: monospace; color: var(--accent-blue); font-weight: 700; font-size: 0.9rem; }
            .col-name { font-weight: 700; color: var(--text-primary); font-size: 1rem; }
            .col-status { text-align: center; }
            .table-badge { padding: 8px 18px; font-size: 0.85rem; }
            
            .footer { padding: 20px; font-size: 0.75rem; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Top Section: Branding & Metrics -->
        <div class="top-section">
            <div class="brand">
                <div class="brand-logo">🏥</div>
                <div class="brand-info">
                    <h1>MOH-Next-Care</h1>
                    <p>Live Statistics & Monitor</p>
                    <div id="modeBadge" class="mode-badge">Loading...</div>
                </div>
            </div>
            
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-icon">📤</div>
                    <div class="metric-label">Sent Cases</div>
                    <div class="metric-value" id="countTab1">0</div>
                </div>
                <div class="metric-card">
                    <div class="metric-icon">📥</div>
                    <div class="metric-label">Inbox Total</div>
                    <div class="metric-value" id="countTab2">0</div>
                </div>
                <div class="metric-card">
                    <div class="metric-icon">🔄</div>
                    <div class="metric-label">Updates</div>
                    <div class="metric-value" id="countUpdates">#0</div>
                </div>
                <div class="metric-card">
                    <div class="metric-icon">⏳</div>
                    <div class="metric-label">Next Refresh</div>
                    <div class="metric-value" id="nextRefreshVal">--</div>
                </div>
                <div class="metric-card">
                    <div class="metric-icon">⏱️</div>
                    <div class="metric-label">Uptime</div>
                    <div class="metric-value" id="uptimeVal">00:00:00</div>
                </div>
            </div>
        </div>

        <!-- Navigation Tabs -->
        <div class="tabs-nav">
            <button class="tab-btn active" onclick="switchTab('tab1')" id="tab1Btn">
                <span>📤</span>
                <span class="tab-label-text">Sent</span>
                <span class="tab-badge" id="badgeTab1">0</span>
            </button>
            <button class="tab-btn" onclick="switchTab('tab2')" id="tab2Btn">
                <span>📥</span>
                <span class="tab-label-text">Inbox</span>
                <span class="tab-badge" id="badgeTab2">0</span>
            </button>
            <button class="tab-btn" onclick="switchTab('events')" id="eventsBtn">
                <span>📜</span>
                <span class="tab-label-text">Events</span>
                <span class="tab-badge" id="badgeEvents">0</span>
            </button>
        </div>

        <!-- Main Content Panel -->
        <div class="content-panel">
            <!-- Desktop Table (Hidden on Mobile) -->
            <div id="tableContainer" class="table-container"></div>
            
            <!-- Mobile Cards (Shown on Mobile) -->
            <div id="cardsContainer" class="cards-container"></div>

            <!-- Pagination -->
            <div id="paginationContainer" class="pagination-controls" style="display:none;"></div>

            <!-- Events -->
            <div id="eventsContainer" class="events-list" style="display:none;"></div>
        </div>

        <div class="footer">
            MOH-Next-Care v2.0 &bull; Auto-refresh (5s) &bull; <span id="lastSyncTime">--:--</span>
        </div>
    </div>

    <script>
        let currentTab = 'tab1';
        let currentPage = 1;
        const itemsPerPage = 10;
        let currentState = { tab1: [], tab2: [], events: [], mode: 'real', counter: 0, startTime: Date.now(), nextUpdateIn: 0 };

        function getStatusBadge(statusId) {
            const styles = {
                '1': { text: 'Approved', color: '#10b981', bg: 'rgba(16,185,129,0.15)', icon: '✔️' },
                '2': { text: 'Rejected', color: '#ef4444', bg: 'rgba(239,68,68,0.15)', icon: '❌' },
                '3': { text: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', icon: '⏳' },
                '4': { text: 'Closed', color: '#64748b', bg: 'rgba(100,116,139,0.15)', icon: '🔒' },
                '6': { text: 'Completed', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', icon: '🏁' }
            };
            const def = { text: 'Status '+statusId, color: '#64748b', bg: 'rgba(100,116,139,0.15)', icon: '❓' };
            const s = styles[String(statusId)] || def;
            return '<span class="table-badge" style="color:'+s.color+'; background:'+s.bg+'">'+s.icon+' '+s.text+'</span>';
        }

        function renderPagination(totalItems) {
            var container = document.getElementById('paginationContainer');
            if (totalItems <= itemsPerPage) {
                container.style.display = 'none';
                return;
            }
            container.style.display = 'flex';
            
            var totalPages = Math.ceil(totalItems / itemsPerPage);
            var btns = '';

            function createBtn(text, page, disabled, active) {
                return '<button class="page-btn ' + (active ? 'active' : '') + '" ' 
                       + 'onclick="goToPage(' + page + ')" ' 
                       + (disabled ? 'disabled' : '') + '>' + text + '</button>';
            }

            // First & Prev
            btns += createBtn('|&lt;', 1, currentPage === 1, false);
            btns += createBtn('&lt;', currentPage - 1, currentPage === 1, false);

            // Page Numbers
            var startPage = Math.max(1, currentPage - 2);
            var endPage = Math.min(totalPages, startPage + 4);
            if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);

            for (var i = startPage; i <= endPage; i++) {
                btns += createBtn(i, i, false, i === currentPage);
            }

            // Next & Last
            btns += createBtn('&gt;', currentPage + 1, currentPage === totalPages, false);
            btns += createBtn('&gt;|', totalPages, currentPage === totalPages, false);
            
            var startIdx = (currentPage - 1) * itemsPerPage + 1;
            var endIdx = Math.min(startIdx + itemsPerPage - 1, totalItems);
            
            container.innerHTML = '<div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:center;">'
                + btns
                + '</div>'
                + '<div class="page-info" style="width:100%; margin-top:8px;">'
                + 'Showing ' + startIdx + '-' + endIdx + ' of ' + totalItems
                + '</div>';
        }

        function goToPage(page) {
            var data = currentTab === 'tab1' ? currentState.tab1 : currentState.tab2;
            var totalPages = Math.ceil((data || []).length / itemsPerPage);
            
            if (page < 1) page = 1;
            if (page > totalPages) page = totalPages;
            
            currentPage = page;
            renderTable(data);
            renderCards(data);
            renderPagination((data || []).length);
        }

        function changePage(delta) {
            goToPage(currentPage + delta);
        }

        function renderTable(cases) {
            const container = document.getElementById('tableContainer');
            if (getComputedStyle(container).display === 'none') return; // Don't render if hidden

            if (!cases || cases.length === 0) {
                container.innerHTML = '<div class="empty-view"><div class="emoji">📭</div><p>No cases to display</p></div>';
                return;
            }

            const totalPages = Math.ceil(cases.length / itemsPerPage);
            if (currentPage > totalPages) currentPage = totalPages || 1;
            
            const start = (currentPage - 1) * itemsPerPage;
            const sliced = cases.slice(start, start + itemsPerPage);

            let rows = sliced.map(function(item) {
                // Calculate Opens At = Broadcast + 15m
                const bcDate = item.broadcastedAt ? new Date(item.broadcastedAt) : null;
                const bcTime = bcDate ? bcDate.toLocaleTimeString() : '--';
                
                let openTime = 'NOW';
                if (bcDate) {
                    const openDate = new Date(bcDate.getTime() + 15 * 60000); // +15 mins
                    openTime = openDate.toLocaleTimeString();
                }
                
                return '<tr>'
                    + '<td class="col-id">#'+(item.id || item.referralId || '--')+'</td>'
                    + '<td><div class="col-name">'+(item.patientName || 'Unknown')+'</div></td>'
                    + '<td>'+(item.patientNationalId || '--')+'</td>'
                    + '<td>'+(item.patientNationality || '--')+'</td>'
                    + '<td>'+(item.mainSpecialty || '--')+'</td>'
                    + '<td>'+(item.providerName || '--')+'</td>'
                    + '<td>'+bcTime+'</td>'
                    + '<td style="color:var(--accent-yellow); font-weight:600;">'+openTime+'</td>'
                    + '<td class="col-status">'+getStatusBadge(item.status)+'</td>'
                    + '</tr>';
            }).join('');

            container.innerHTML = '<table>'
                + '<thead><tr>'
                + '<th>ID</th><th>Patient Name</th><th>National ID</th><th>Nationality</th>'
                + '<th>Specialty</th><th>Hospital</th><th>Broadcast</th><th>Opens At</th>'
                + '<th class="col-status">Status</th>'
                + '</tr></thead>'
                + '<tbody>'+rows+'</tbody>'
                + '</table>';
        }

        function renderCards(cases) {
            const container = document.getElementById('cardsContainer');
            if (getComputedStyle(container).display === 'none') return; // Don't render if hidden

            if (!cases || cases.length === 0) {
                container.innerHTML = '<div class="empty-view"><div class="emoji">📭</div><p>No cases to display</p></div>';
                return;
            }

            const totalPages = Math.ceil(cases.length / itemsPerPage);
            if (currentPage > totalPages) currentPage = totalPages || 1;
            
            const start = (currentPage - 1) * itemsPerPage;
            const sliced = cases.slice(start, start + itemsPerPage);

            container.innerHTML = sliced.map(function(item) {
                // Calculate Opens At = Broadcast + 15m
                const bcDate = item.broadcastedAt ? new Date(item.broadcastedAt) : null;
                const bcTime = bcDate ? bcDate.toLocaleTimeString() : '--';

                let openTime = 'NOW';
                if (bcDate) {
                    const openDate = new Date(bcDate.getTime() + 15 * 60000); // +15 mins
                    openTime = openDate.toLocaleTimeString();
                }

                return '<div class="case-card">'
                    + '<div class="card-header">'
                    + '<div class="card-patient">'+(item.patientName || 'Unknown')+'</div>'
                    + '<div class="card-id">#'+(item.id || item.referralId || '--')+'</div>'
                    + '</div>'
                    + '<div class="card-fields">'
                    + '<div class="card-field"><div class="card-field-label">National ID</div><div class="card-field-value">'+(item.patientNationalId || '--')+'</div></div>'
                    + '<div class="card-field"><div class="card-field-label">Nationality</div><div class="card-field-value">'+(item.patientNationality || '--')+'</div></div>'
                    + '<div class="card-field"><div class="card-field-label">Specialty</div><div class="card-field-value">'+(item.mainSpecialty || '--')+'</div></div>'
                    + '<div class="card-field"><div class="card-field-label">Hospital</div><div class="card-field-value">'+(item.providerName || '--')+'</div></div>'
                    + '</div>'
                    + '<div class="card-footer">'
                    + '<div class="card-times">'
                    + '<div class="card-time"><div class="card-time-label">Broadcast</div><div class="card-time-value">'+bcTime+'</div></div>'
                    + '<div class="card-time"><div class="card-time-label">Opens At</div><div class="card-time-value">'+openTime+'</div></div>'
                    + '</div>'
                    + getStatusBadge(item.status)
                    + '</div>'
                    + '</div>';
            }).join('');
        }

        function renderEvents(events) {
            const container = document.getElementById('eventsContainer');
            if (!events || events.length === 0) {
                container.innerHTML = '<div class="empty-view"><div class="emoji">🔇</div><p>No events log</p></div>';
                return;
            }
            container.innerHTML = events.slice().reverse().map(function(e) {
                const match = e.match(/^\\[(.*?)\\]/);
                const time = match ? match[1] : '';
                const text = time ? e.replace(/^\\[.*?\\]\\s*/, '') : e;
                return '<div class="event-row"><div class="event-time">'+time+'</div><div>'+text+'</div></div>';
            }).join('');
        }

        function switchTab(tab) {
            if (currentTab !== tab) currentPage = 1;
            currentTab = tab;
            
            ['tab1', 'tab2', 'events'].forEach(function(t) {
                var btn = document.getElementById(t+'Btn');
                if (t === tab) btn.classList.add('active');
                else btn.classList.remove('active');
            });

            var tableCon = document.getElementById('tableContainer');
            var cardsCon = document.getElementById('cardsContainer');
            var eventCon = document.getElementById('eventsContainer');
            var pageCon = document.getElementById('paginationContainer');

            if (tab === 'events') {
                tableCon.style.display = 'none';
                cardsCon.style.display = 'none';
                pageCon.style.display = 'none';
                eventCon.style.display = 'block';
                renderEvents(currentState.events);
            } else {
                eventCon.style.display = 'none';
                // Show CSS-controlled containers, only hide explicitly if not needed?
                // Actually they are controlled by CSS display (none/block). 
                // JS just needs to keep them "in the DOM" with no inline style override, OR clear inline styles.
                // My CSS uses display:none/block. 
                // So I should remove any inline display styles.
                tableCon.style.removeProperty('display');
                cardsCon.style.removeProperty('display');
                
                pageCon.style.display = 'flex'; // Enable pagination container

                var data = tab === 'tab1' ? currentState.tab1 : currentState.tab2;
                renderTable(data);
                renderCards(data);
                renderPagination((data || []).length);
            }
        }

        function updateValues() {
            var t1Len = (currentState.tab1 || []).length;
            var t2Len = currentState.tab2Total || (currentState.tab2 || []).length;
            var evLen = (currentState.events || []).length;

            document.getElementById('countTab1').textContent = t1Len;
            document.getElementById('countTab2').textContent = t2Len;
            document.getElementById('countUpdates').textContent = '#' + currentState.counter;

            document.getElementById('badgeTab1').textContent = t1Len;
            document.getElementById('badgeTab2').textContent = t2Len;
            document.getElementById('badgeEvents').textContent = evLen;

            // Next Refresh
            var nextIn = currentState.nextUpdateIn || 0;
            var nextEl = document.getElementById('nextRefreshVal');
            if (nextIn > 0) {
                 nextEl.textContent = nextIn + 's';
                 nextEl.style.color = 'var(--accent-yellow)';
            } else {
                 nextEl.textContent = 'Updating...';
                 nextEl.style.color = 'var(--accent-green)';
            }

            // Uptime
            var diff = Date.now() - (currentState.startTime || Date.now());
            var hrs = String(Math.floor(diff / 3600000)).padStart(2,'0');
            var mins = String(Math.floor((diff % 3600000) / 60000)).padStart(2,'0');
            var secs = String(Math.floor((diff % 60000) / 1000)).padStart(2,'0');
            document.getElementById('uptimeVal').textContent = hrs+':'+mins+':'+secs;

            // Mode badge
            var mb = document.getElementById('modeBadge');
            mb.textContent = currentState.mode === 'simulation' ? '🧪 SIMULATION' : '🔴 LIVE';
            mb.style.background = currentState.mode === 'simulation' ? 'var(--accent-purple)' : 'var(--accent-red)';

            if (currentState.lastUpdate) {
                document.getElementById('lastSyncTime').textContent = new Date(currentState.lastUpdate).toLocaleTimeString();
            }

            // Re-render current view
            var data = currentTab === 'tab1' ? currentState.tab1 : currentState.tab2;
            if (currentTab !== 'events') {
                renderTable(data);
                renderCards(data);
                renderPagination((data || []).length);
            } else {
                renderEvents(currentState.events);
            }
        }

        function fetchLoop() {
            fetch('/api/cases').then(function(res) {
                if (res.ok) return res.json();
                return null;
            }).then(function(data) {
                if (data) {
                    currentState = data;
                    updateValues();
                }
            }).catch(function(e) { console.error(e); });
        }

        fetchLoop();
        setInterval(fetchLoop, 5000);
        setInterval(function() {
            // Update Uptime
            if (currentState.startTime) {
                var diff = Date.now() - currentState.startTime;
                var hrs = String(Math.floor(diff / 3600000)).padStart(2,'0');
                var mins = String(Math.floor((diff % 3600000) / 60000)).padStart(2,'0');
                var secs = String(Math.floor((diff % 60000) / 1000)).padStart(2,'0');
                var el = document.getElementById('uptimeVal');
                if(el) el.textContent = hrs+':'+mins+':'+secs;
            }

            // Update Next Refresh Count
            if (currentState.nextUpdateIn > 0) {
                currentState.nextUpdateIn--;
                var nextEl = document.getElementById('nextRefreshVal');
                if (nextEl) {
                    nextEl.textContent = currentState.nextUpdateIn + 's';
                    nextEl.style.color = 'var(--accent-yellow)';
                }
            } else if (currentState.nextUpdateIn <= 0) {
                 var nextEl = document.getElementById('nextRefreshVal');
                 if (nextEl) {
                    nextEl.textContent = 'Updating...';
                    nextEl.style.color = 'var(--accent-green)';
                 }
            }
        }, 1000);
    </script>
</body>
</html>`;
}

// ==========================================
//  EXPRESS SERVER
// ==========================================
// import localtunnel from 'localtunnel'; // Removed static import

export async function startDashboardServer() {
    if (serverInstance) {
        console.log('[Dashboard] Server already running.');
        return publicUrl;
    }

    const app = express();

    // Serve dashboard HTML
    app.get('/', (req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(generateHTML());
    });

    // API endpoint for case data
    app.get('/api/cases', (req, res) => {
        res.json({
            ...dashboardData,
            lastUpdate: dashboardData.lastUpdate || new Date().toISOString()
        });
    });

    // Health check
    app.get('/api/health', (req, res) => {
        res.json({ status: 'ok', uptime: Date.now() - dashboardData.startTime });
    });

    return new Promise((resolve) => {
        // Replit/Container specific: Listen on 0.0.0.0 to be accessible
        serverInstance = app.listen(PORT, '0.0.0.0', async () => {
            console.log(`\n\x1b[34m[Dashboard]\x1b[0m Local server running at: \x1b[36mhttp://localhost:${PORT}\x1b[0m`);

            if (process.env.DISABLE_TUNNEL === 'true') {
                const localUrl = `http://localhost:${PORT}`;
                publicUrl = localUrl;
                console.log(`\x1b[34m[Dashboard]\x1b[0m Tunnel Disabled. Running locally at \x1b[36m${localUrl}\x1b[0m`);
                resolve(localUrl);
                return;
            }

            // 1. REPLIT NATIVE URL DETECTION
            const slug = process.env.REPL_SLUG;
            const owner = process.env.REPL_OWNER;

            if (slug && owner && slug !== 'workspace' && slug !== 'runner') {
                // Try newer replit.dev domain first, then fallback to repl.co
                publicUrl = `https://${slug}.${owner}.replit.app`;
                console.log(`\x1b[32m[Dashboard]\x1b[0m 🌐 Replit Global URL: \x1b[1m\x1b[33m${publicUrl}\x1b[0m`);
                resolve(publicUrl);
                return;
            }

            // 2. TRY CLOUDFLARED (Windows/Pre-installed)
            try {
                // Only try cloudflared.exe on Windows to avoid spawn errors on Linux
                const isWindows = process.platform === 'win32';
                if (isWindows) {
                    const cfPath = path.join(__dirname, '..', 'bin', 'cloudflared.exe');
                    const cfProcess = spawn(cfPath, ['tunnel', '--url', `http://localhost:${PORT}`], {
                        stdio: ['ignore', 'pipe', 'pipe'],
                        windowsHide: true
                    });

                    tunnelInstance = cfProcess;

                    // Cloudflare outputs the URL to stderr
                    let urlFound = false;
                    cfProcess.stderr.on('data', (data) => {
                        const output = data.toString();
                        const urlMatch = output.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
                        if (urlMatch && !urlFound) {
                            urlFound = true;
                            publicUrl = urlMatch[0];
                            console.log(`\x1b[32m[Dashboard]\x1b[0m 🌐 Public URL (Cloudflare): \x1b[1m\x1b[33m${publicUrl}\x1b[0m`);
                        }
                    });

                    cfProcess.on('error', (err) => {
                        // Fallback to localtunnel if cloudflared fails to spawn
                        startLocaltunnel(PORT).then(url => {
                            publicUrl = url;
                            resolve(publicUrl);
                        });
                    });

                    // Wait 5s for Cloudflare, then check
                    setTimeout(() => {
                        if (publicUrl) resolve(publicUrl);
                        else {
                            // If cloudflare didn't give a URL in 5s, try localtunnel?
                            // Or just resolve null. Let's stick with what we have.
                            resolve(publicUrl || `http://localhost:${PORT}`);
                        }
                    }, 5000);
                    return;
                }
            } catch (err) {
                // Ignore
            }

            // 3. FALLBACK: LOCALTUNNEL (For Replit non-native, Linux, Termux, etc)
            console.log(`\x1b[34m[Dashboard]\x1b[0m Starting LocalTunnel fallback...`);

            // Function to start and maintain tunnel
            const maintainTunnel = async () => {
                try {
                    // Fetch Tunnel Password (Public IP)
                    let tunnelPassword = 'Unknown';
                    try {
                        const res = await fetch('https://loca.lt/mytunnelpassword');
                        tunnelPassword = await res.text();
                    } catch (err) { /* ignore */ }

                    // Dynamic import to avoid crash if not installed
                    const localtunnel = (await import('localtunnel')).default;

                    // Try to generate a consistent subdomain
                    const sub = 'moh-next-care-' + (process.env.USERNAME || process.env.USER || 'app').toLowerCase().replace(/[^a-z0-9]/g, '');

                    console.log(`\x1b[34m[Dashboard]\x1b[0m Requesting tunnel (subdomain: ${sub})...`);

                    const tunnel = await localtunnel({ port: PORT, subdomain: sub });
                    publicUrl = tunnel.url;
                    tunnelInstance = tunnel;
                    tunnelPasswordValue = tunnelPassword.trim();

                    console.log(`\x1b[32m[Dashboard]\x1b[0m 🌐 Public URL (LocalTunnel): \x1b[1m\x1b[33m${publicUrl}\x1b[0m`);

                    if (tunnelPasswordValue && tunnelPasswordValue !== 'Unknown') {
                        console.log(`\x1b[36m[Dashboard]\x1b[0m 🔑 Tunnel Password: \x1b[1m\x1b[37m${tunnelPasswordValue}\x1b[0m`);
                    } else {
                        console.log(`\x1b[31m[Dashboard]\x1b[0m ⚠️ Could not fetch Tunnel Password. Visit https://loca.lt/mytunnelpassword manually.`);
                    }

                    // Handle tunnel close
                    tunnel.on('close', () => {
                        console.log('\x1b[31m[Dashboard]\x1b[0m ⚠️ Tunnel disconnected! Attempting to reconnect in 5s...');
                        tunnelInstance = null;
                        setTimeout(maintainTunnel, 5000);
                    });

                    // Resolve the initial promise if it's the first run
                    // Note: We can't re-resolve the original promise, but that's fine for the initial await.
                    return publicUrl;
                } catch (ltErr) {
                    console.log(`\x1b[33m[Dashboard]\x1b[0m LocalTunnel failed: ${ltErr.message}. Retrying in 10s...`);
                    setTimeout(maintainTunnel, 10000);
                    return `http://localhost:${PORT}`; // Fallback for initial resolve
                }
            };

            const initialUrl = await maintainTunnel();
            resolve(initialUrl);

        });
    });
}

// Helper for CF fallback
async function startLocaltunnel(port) {
    console.log(`\x1b[34m[Dashboard]\x1b[0m Switching to LocalTunnel...`);

    const maintainTunnel = async () => {
        try {
            // Fetch Tunnel Password (Public IP)
            let tunnelPassword = 'Unknown';
            try {
                const res = await fetch('https://loca.lt/mytunnelpassword');
                tunnelPassword = await res.text();
            } catch (err) {
                // Fallback if fetch fails
            }

            const localtunnel = (await import('localtunnel')).default;

            // Try to generate a consistent subdomain based on username/project
            // e.g. "moh-next-care-dizaar"
            const sub = 'moh-next-care-' + (process.env.USERNAME || process.env.USER || 'app').toLowerCase().replace(/[^a-z0-9]/g, '');

            console.log(`\x1b[34m[Dashboard]\x1b[0m Requesting tunnel (subdomain: ${sub})...`);

            const tunnel = await localtunnel({ port, subdomain: sub });

            // Update global variables
            publicUrl = tunnel.url;
            tunnelInstance = tunnel;
            tunnelPasswordValue = tunnelPassword.trim();

            console.log(`\x1b[32m[Dashboard]\x1b[0m 🌐 Public URL (LocalTunnel): \x1b[1m\x1b[33m${tunnel.url}\x1b[0m`);

            if (tunnelPasswordValue && tunnelPasswordValue !== 'Unknown') {
                console.log(`\x1b[36m[Dashboard]\x1b[0m 🔑 Tunnel Password: \x1b[1m\x1b[37m${tunnelPasswordValue}\x1b[0m`);
                console.log(`\x1b[90m(Copy this password to access the site)\x1b[0m`);
            } else {
                console.log(`\x1b[31m[Dashboard]\x1b[0m ⚠️ Could not fetch Tunnel Password. Visit https://loca.lt/mytunnelpassword manually.`);
            }

            tunnelInstance = tunnel;

            // Reconnect on close
            tunnel.on('close', () => {
                console.log('\x1b[31m[Dashboard]\x1b[0m ⚠️ Tunnel disconnected! Attempting to reconnect in 5s...');
                tunnelInstance = null;
                setTimeout(maintainTunnel, 5000);
            });

            return tunnel.url;
        } catch (e) {
            console.error('LocalTunnel Error:', e);
            console.log(`\x1b[33m[Dashboard]\x1b[0m Retrying in 10s...`);
            setTimeout(maintainTunnel, 10000);
            return null;
        }
    };

    return maintainTunnel();
}

export function getPublicUrl() {
    return publicUrl;
}

export function getTunnelPassword() {
    return tunnelPasswordValue;
}
