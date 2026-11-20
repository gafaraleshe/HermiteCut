// HermiteCut — desktop shell services for the main process.
//
// What a desktop app is expected to do, kept out of main.js:
//   - logs that rotate instead of growing for ever;
//   - crash protection: uncaught errors are logged, a crashed page reloads;
//   - remembering the window's size and place (and staying on screen);
//   - the macOS menu bar (without an Edit menu, Cmd+C / Cmd+V do nothing in
//     text fields on macOS);
//   - checking for updates against cut.hermitelabs.com;
//   - a diagnostics report for support.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const UPDATE_FEED = 'https://cut.hermitelabs.com/api/hermitecut/latest';
const LOG_MAX = 2 * 1024 * 1024;

// ---- logs
function rotateLog(file) {
    try {
        if (fs.existsSync(file) && fs.statSync(file).size > LOG_MAX) {
            fs.rmSync(file + '.old', { force: true });
            fs.renameSync(file, file + '.old');
        }
    } catch (e) { /* ignore */ }
}

function tailLog(file, lines) {
    try {
        const text = fs.readFileSync(file, 'utf8');
        return text.split(/\r?\n/).filter(Boolean).slice(-lines).join('\n');
    } catch (e) {
        return '(no log yet)';
    }
}

// ---- crash protection
function guardProcess(log) {
    process.on('uncaughtException', (e) => log('UNCAUGHT ' + (e && e.stack ? e.stack : e)));
    process.on('unhandledRejection', (e) => log('UNHANDLED REJECTION ' + (e && e.stack ? e.stack : e)));
}

function guardWindow(win, log) {
    let crashes = 0;
    win.webContents.on('render-process-gone', (_e, details) => {
        log('Page stopped (' + details.reason + ', code ' + details.exitCode + ')');
        // Reload, but not in a loop if it keeps crashing.
        if (details.reason !== 'clean-exit' && ++crashes <= 3 && !win.isDestroyed()) setTimeout(() => win.reload(), 500);
    });
    win.on('unresponsive', () => log('Window not responding'));
    win.on('responsive', () => log('Window responding again'));
    // The page never navigates away from the app.
    win.webContents.on('will-navigate', (e, url) => {
        if (!url.startsWith('file://')) { e.preventDefault(); log('Blocked navigation to ' + url); }
    });
    win.webContents.on('will-attach-webview', (e) => e.preventDefault());
    // No camera, microphone, location or notifications prompts from the page.
    win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
}

// ---- window size and place
function windowState(app, screen, defaults) {
    const file = path.join(app.getPath('userData'), 'window-state.json');
    let state = {};
    try { state = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { /* first run */ }

    // Use the saved place only if it is still on one of the screens.
    const b = state.bounds;
    const visible = b && screen.getAllDisplays().some(d => {
        const a = d.workArea;
        return b.x + 80 > a.x && b.y + 40 > a.y && b.x < a.x + a.width - 80 && b.y < a.y + a.height - 40;
    });
    const bounds = visible
        ? { x: b.x, y: b.y, width: Math.max(b.width, defaults.minWidth), height: Math.max(b.height, defaults.minHeight) }
        : { width: defaults.width, height: defaults.height };

    function track(win) {
        let timer = null;
        const save = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (win.isDestroyed()) return;
                const s = { bounds: win.isMaximized() || win.isMinimized() ? (state.bounds || win.getBounds()) : win.getBounds(), maximized: win.isMaximized() };
                state = s;
                try { fs.writeFileSync(file, JSON.stringify(s)); } catch (e) { /* ignore */ }
            }, 400);
        };
        ['resize', 'move', 'maximize', 'unmaximize'].forEach(ev => win.on(ev, save));
        if (state.maximized) win.once('ready-to-show', () => win.maximize());
    }
    return { bounds, track };
}

// ---- the macOS menu bar
function macMenu(Menu, app, send) {
    const name = app.name || 'HermiteCut';
    const template = [
        {
            label: name,
            submenu: [
                { label: 'About ' + name, click: () => send('about') },
                { label: 'Check for Updates…', click: () => send('checkUpdate') },
                { type: 'separator' },
                { label: 'Settings…', accelerator: 'Cmd+,', click: () => send('settings') },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
                { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { label: 'Command Palette…', accelerator: 'Cmd+K', click: () => send('palette') },
                { label: 'Refresh Connection', accelerator: 'Cmd+R', click: () => send('refresh') },
                { type: 'separator' },
                { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        },
        { role: 'windowMenu' },
        {
            role: 'help',
            submenu: [
                { label: 'Keyboard Shortcuts', accelerator: 'Cmd+/', click: () => send('shortcuts') },
                { label: 'What’s New', click: () => send('whatsNew') },
                { label: 'HermiteCut Help', click: () => send('help') },
                { type: 'separator' },
                { label: 'Copy Diagnostics for Support', click: () => send('diagnostics') },
                { label: 'Open Log File', click: () => send('openLog') }
            ]
        }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- updates
function parseVersion(v) {
    const m = String(v || '').trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
}
function newer(a, b) {
    const x = parseVersion(a), y = parseVersion(b);
    if (!x || !y) return false;
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
    return false;
}

async function checkForUpdate(current, opts) {
    opts = opts || {};
    const http = opts.fetch || fetch;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs || 8000);
    try {
        const r = await http(opts.feed || UPDATE_FEED, {
            headers: { Accept: 'application/json', 'User-Agent': 'HermiteCut/' + current },
            signal: ctl.signal
        });
        if (!r.ok) throw new Error('The update server answered ' + r.status + '.');
        const j = await r.json();
        if (!parseVersion(j.version)) throw new Error('The update server sent no version.');
        return {
            current,
            latest: j.version,
            available: newer(j.version, current),
            released: j.released || '',
            summary: Array.isArray(j.summary) ? j.summary.slice(0, 5).map(String) : [],
            notesUrl: /^https:\/\//.test(j.notesUrl || '') ? j.notesUrl : 'https://cut.hermitelabs.com/changelog',
            downloadUrl: /^https:\/\//.test(j.downloadUrl || '') ? j.downloadUrl : 'https://cut.hermitelabs.com/'
        };
    } catch (e) {
        const msg = e && e.name === 'AbortError' ? 'The update server did not answer.' : (e && e.message) || String(e);
        throw new Error("Couldn't check for updates: " + msg);
    } finally {
        clearTimeout(timer);
    }
}

// ---- diagnostics
async function diagnostics(ctx) {
    // ctx: { app, mode, api, logFile, mcpInfo }
    const safe = async (fn) => { try { return await fn(); } catch (e) { return { error: e && e.message ? e.message : String(e) }; } };
    const [engine, licence, status, mcp] = await Promise.all([
        safe(() => ctx.api.engineInfo ? ctx.api.engineInfo() : null),
        safe(() => ctx.api.licenceStatus ? ctx.api.licenceStatus() : null),
        safe(() => ctx.api.status ? ctx.api.status() : null),
        safe(() => ctx.api.mcpInfo ? ctx.api.mcpInfo() : null)
    ]);
    const lines = [
        'HermiteCut ' + ctx.app.getVersion() + ' (' + ctx.mode + ')',
        'System: ' + os.type() + ' ' + os.release() + ' ' + process.arch + ', ' + Math.round(os.totalmem() / 1073741824) + ' GB RAM',
        'Electron ' + process.versions.electron + ', Chromium ' + process.versions.chrome + ', Node ' + process.versions.node,
        'Locale: ' + (ctx.app.getLocale ? ctx.app.getLocale() : ''),
        'Engine: ' + (engine && engine.engine ? engine.engine + (engine.version ? ' ' + engine.version : '') + (engine.reason ? ' (' + engine.reason + ')' : '') : JSON.stringify(engine)),
        // Never the key itself: only whether it is active and its masked form.
        'Licence: ' + (licence && 'required' in licence ? (!licence.required ? 'off in this build' : licence.valid ? 'active ' + (licence.displayKey || '') : 'not active') : JSON.stringify(licence)),
        'Resolve: ' + (status && !status.error ? 'connected' + (status.page ? ', ' + status.page + ' page' : '') + (status.fps ? ', ' + status.fps + ' fps' : '') : 'not connected' + (status && status.error ? ' (' + status.error + ')' : '')),
        'Claude (MCP): ' + (mcp && mcp.running ? 'running, ' + mcp.tools + ' tools on port ' + mcp.port : 'off' + (mcp && mcp.reason ? ' (' + mcp.reason + ')' : '')),
        '',
        '--- Recent log ---',
        tailLog(ctx.logFile, 150)
    ];
    // Keep personal paths out of what gets pasted into an email.
    const home = os.homedir();
    return lines.join('\n').split(home).join('~');
}

module.exports = { UPDATE_FEED, rotateLog, tailLog, guardProcess, guardWindow, windowState, macMenu, newer, parseVersion, checkForUpdate, diagnostics };
