// HermiteCut — main process (Electron).
//
// The same file runs in two ways:
//   - as the Resolve panel: Resolve Studio loads it as a Workflow Integration
//     plugin, with WorkflowIntegration.node beside it;
//   - as the standalone HermiteCut app (Windows / macOS), which reaches Resolve
//     through fuscript (hosts/resolve/bridge.lua).
// The UI (core/ui) and host-independent logic (core/lib) are shared; all
// Resolve-specific code lives in hosts/resolve, behind one adapter, so other
// hosts can be added later (docs/MULTI_HOST_PLAN.md).
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Layout: assembled builds keep core/ and hosts/ next to main.js; in the repo
// they sit one level up (app/main.js).
const ROOT = fs.existsSync(path.join(__dirname, 'core')) ? __dirname : path.join(__dirname, '..');
function resourcesDir() {
    const candidates = [
        process.resourcesPath && path.join(process.resourcesPath, 'hermitecut'),
        path.join(__dirname, 'resources'),
        path.join(ROOT, 'build', 'resources')
    ].filter(Boolean);
    return candidates.find(p => fs.existsSync(path.join(p, 'HermiteCut-manifest.json'))) || candidates[candidates.length - 1];
}

// Developer mode: create an empty "devtools.flag" file next to main.js to enable
// Chromium remote debugging on 127.0.0.1:9339 (used for automated testing).
try {
    if (fs.existsSync(path.join(__dirname, 'devtools.flag'))) {
        app.commandLine.appendSwitch('remote-debugging-port', '9339');
        app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
    }
} catch (e) { /* ignore */ }

const MAC = process.platform === 'darwin';
// Resolve loads the panel with WorkflowIntegration.node beside main.js; the
// standalone app owns its menus, single instance and window memory.
const PANEL = fs.existsSync(path.join(__dirname, 'WorkflowIntegration.node'));
const shellSvc = require(path.join(__dirname, 'shell.js'));
const claudeSvc = require(path.join(__dirname, 'claude.js'));
let claude = null; // set once paths are known (registerIpc)
const HELP_URL = 'https://cut.hermitelabs.com/#faq';
const NOTES_URL = 'https://cut.hermitelabs.com/changelog';

// One HermiteCut at a time: opening it again brings the window forward.
const FIRST_INSTANCE = PANEL || app.requestSingleInstanceLock();
if (!FIRST_INSTANCE) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show(); mainWindow.focus();
    });
}

let pinned = true;
let mainWindow = null;
let host = null;

function logFile() {
    return path.join(app.getPath('userData'), 'hermitecut-log.txt');
}
let logRotated = false;
function log(msg) {
    if (!logRotated) { logRotated = true; shellSvc.rotateLog(logFile()); }
    try {
        fs.appendFileSync(logFile(), new Date().toISOString() + '  ' + msg + os.EOL);
    } catch (e) { /* ignore */ }
}

function registerIpc() {
    host = require(path.join(ROOT, 'hosts', 'resolve', 'index.js'))
        .create({ appDir: __dirname, resourcesDir: resourcesDir(), log, app });
    host.api.hostInfo = async () => ({ host: host.id, hostName: host.name, mode: host.mode(),
        version: app.getVersion ? app.getVersion() : '', platform: process.platform });
    if (host.api.engineInfo) {
        host.api.engineInfo()
            .then(i => log('Engine: ' + (i.engine === 'rust' ? 'Rust ' + i.version : 'JavaScript (' + i.reason + ')')))
            .catch(() => 0);
    }

    claude = claudeSvc.create({ nativeDir: path.join(ROOT, 'core', 'native'), log });
    // After an update, refresh the bridge Claude already uses.
    if (claude.status().bridgeInstalled) claude.installBridge().catch(e => log('Claude bridge refresh: ' + e.message));

    ipcMain.handle('hc:call', async (_ev, name, args) => {
        const fn = host.api[name];
        if (!fn) return { ok: false, error: 'Unknown action: ' + name };
        try {
            const res = await fn(args || {});
            return { ok: true, result: res };
        } catch (e) {
            const msg = (e && e.message) ? e.message : String(e);
            log('ERROR ' + name + ': ' + msg + (e && e.stack ? '\n' + e.stack : ''));
            // A stale Resolve handle (e.g. Resolve restarted) -> reset once.
            if (/not initialized|invalid|disconnected|closed|not connected/i.test(msg)) host.reset();
            return { ok: false, error: msg };
        }
    });

    ipcMain.handle('hc:readFile', async (_ev, filePath, maxBytes) => {
        const st = fs.statSync(filePath);
        if (maxBytes && st.size > maxBytes) {
            return { ok: false, error: 'File is too large to analyse (' + Math.round(st.size / 1048576) + ' MB).', size: st.size };
        }
        const buf = fs.readFileSync(filePath);
        return { ok: true, data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), size: st.size };
    });

    ipcMain.handle('hc:openFile', async (_ev, opts) => {
        const r = await dialog.showOpenDialog(mainWindow, {
            title: (opts && opts.title) || 'Choose a file',
            properties: ['openFile'],
            filters: (opts && opts.filters) || []
        });
        return r.canceled ? null : r.filePaths[0];
    });

    ipcMain.handle('hc:saveFile', async (_ev, opts) => {
        const r = await dialog.showSaveDialog(mainWindow, {
            title: (opts && opts.title) || 'Save',
            defaultPath: (opts && opts.defaultPath) || undefined,
            filters: (opts && opts.filters) || []
        });
        return r.canceled ? null : r.filePath;
    });

    ipcMain.handle('hc:chooseFolder', async (_ev, opts) => {
        const r = await dialog.showOpenDialog(mainWindow, {
            title: (opts && opts.title) || 'Choose a folder',
            properties: ['openDirectory', 'createDirectory']
        });
        return r.canceled ? null : r.filePaths[0];
    });

    // App-level actions: never locked by the licence, so a customer can
    // always update and send diagnostics.
    ipcMain.handle('hc:app', async (_ev, cmd, val) => {
        try {
            switch (cmd) {
                case 'info':
                    return { ok: true, result: { version: app.getVersion(), platform: process.platform, arch: process.arch, mode: PANEL ? 'panel' : 'app', helpUrl: HELP_URL, notesUrl: NOTES_URL } };
                // Connecting Claude (app/claude.js).
                case 'claudeStatus':
                    return { ok: true, result: claude.status() };
                case 'claudeConnectDesktop':
                    return { ok: true, result: await claude.connectDesktop() };
                case 'claudeDisconnectDesktop':
                    return { ok: true, result: claude.disconnectDesktop() };
                case 'claudeConnectCode':
                    return { ok: true, result: await claude.connectCode() };
                case 'claudeDisconnectCode':
                    return { ok: true, result: await claude.disconnectCode() };
                case 'checkUpdate':
                    return { ok: true, result: await shellSvc.checkForUpdate(app.getVersion()) };
                case 'diagnostics':
                    return { ok: true, result: await diagnosticsText() };
                case 'copyDiagnostics':
                    clipboard.writeText(await diagnosticsText());
                    return { ok: true, result: true };
                case 'saveDiagnostics': {
                    const r = await dialog.showSaveDialog(mainWindow, { title: 'Save diagnostics', defaultPath: 'HermiteCut-diagnostics.txt', filters: [{ name: 'Text', extensions: ['txt'] }] });
                    if (r.canceled || !r.filePath) return { ok: true, result: null };
                    fs.writeFileSync(r.filePath, await diagnosticsText());
                    return { ok: true, result: r.filePath };
                }
            }
            return { ok: false, error: 'Unknown command: ' + cmd };
        } catch (e) {
            return { ok: false, error: (e && e.message) || String(e) };
        }
    });

    ipcMain.handle('hc:window', async (_ev, cmd, val) => {
        if (!mainWindow) return false;
        switch (cmd) {
            case 'close': mainWindow.close(); return true;
            case 'minimize': mainWindow.minimize(); return true;
            case 'zoom':
                if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
                return mainWindow.isMaximized();
            case 'pin': pinned = !!val; applyPin(); return pinned;
            case 'isPinned': return mainWindow.isAlwaysOnTop();
            case 'openLog': shell.openPath(logFile()); return true;
            case 'openExternal': if (/^https?:\/\//.test(val)) shell.openExternal(val); return true;
            case 'reveal': if (val) shell.showItemInFolder(val); return true;
            case 'copy': clipboard.writeText(String(val || '')); return true;
        }
        return false;
    });
}

function diagnosticsText() {
    return shellSvc.diagnostics({ app, mode: PANEL ? 'Resolve panel' : 'app', api: host ? host.api : {}, logFile: logFile() });
}

// Resolve's plugin host does not keep Electron's always-on-top flag reliably,
// so re-assert it whenever the window is shown, restored or loses focus.
function applyPin() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
        mainWindow.setAlwaysOnTop(pinned, 'pop-up-menu');
        if (pinned) mainWindow.moveTop();
    } catch (e) { log('pin: ' + e.message); }
}

function createWindow() {
    const ws = PANEL ? null : shellSvc.windowState(app, screen, { width: 1120, height: 720, minWidth: 380, minHeight: 420 });
    mainWindow = new BrowserWindow({
        width: 1120,
        height: 720,
        ...(ws ? ws.bounds : {}),
        minWidth: 380,
        minHeight: 420,
        // macOS: the system's traffic lights over a hidden title bar. Elsewhere
        // the page draws matching ones (core/ui .lights).
        ...(MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 16 } } : { frame: false }),
        backgroundColor: '#050505',
        title: 'HermiteCut',
        alwaysOnTop: true,
        show: false,
        icon: path.join(ROOT, 'core', 'ui', 'img', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            spellcheck: false
        }
    });
    mainWindow.setMenu(null);
    if (ws) ws.track(mainWindow);
    shellSvc.guardWindow(mainWindow, log);
    mainWindow.once('ready-to-show', () => { mainWindow.show(); applyPin(); setTimeout(applyPin, 600); });
    ['show', 'restore', 'blur'].forEach(ev => mainWindow.on(ev, () => setTimeout(applyPin, ev === 'blur' ? 30 : 0)));
    mainWindow.on('close', () => {
        try { if (host) host.cleanup(); } catch (e) { /* ignore */ }
        try { if (mcp) mcp.close(); } catch (e) { /* ignore */ }
        app.quit();
    });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
        return { action: 'deny' };
    });
    mainWindow.loadFile(path.join(ROOT, 'core', 'ui', 'index.html'), MAC ? { query: { lights: 'native' } } : {});
}

// The local MCP server, so Claude can use HermiteCut (core/mcp/server.ts).
let mcp = null;
function bridgePath() {
    const exe = 'hermitecut-mcp-' + process.platform + '-' + process.arch + (process.platform === 'win32' ? '.exe' : '');
    return path.join(ROOT, 'core', 'native', exe);
}
async function startMcp() {
    let mcpError = '';
    host.api.mcpInfo = async () => {
        if (!mcp) return { running: false, reason: mcpError || 'Not started' };
        const bridge = bridgePath();
        return {
            running: true, url: mcp.url, port: mcp.port, tools: mcp.tools.length, bridge: fs.existsSync(bridge) ? bridge : null,
            claudeCode: 'claude mcp add --scope user hermitecut -- "' + claude.bridgePath() + '"',
            claudeDesktop: JSON.stringify({ mcpServers: { hermitecut: { command: claude.bridgePath() } } }, null, 2)
        };
    };
    try {
        const { startMcp: start } = require(path.join(ROOT, 'core', 'mcp', 'server.js'));
        mcp = await start({
            api: host.api, version: app.getVersion ? app.getVersion() : '', dataDir: app.getPath('userData'),
            quickJsPath: path.join(ROOT, 'core', 'ui', 'js', 'quick.js'), log
        });
    } catch (e) {
        mcpError = e && e.message ? e.message : String(e);
        log('MCP server not started: ' + mcpError);
    }
}

// The licence (core/licence): every action needs a valid Polar licence key,
// in the app, in the panel and through Claude. Off when the build has no
// Polar organisation.
function setupLicence() {
    try {
        const { buildLicence, gateActions } = require(path.join(ROOT, 'core', 'licence', 'licence.js'));
        const licence = buildLicence();
        gateActions(host.api, licence);
        licence.status()
            .then(s => log('Licence: ' + (!s.required ? 'off in this build' : s.valid ? 'active (' + s.displayKey + ')' : 'not activated')))
            .catch(() => 0);
    } catch (e) {
        log('Licence module not in this build: ' + (e && e.message));
    }
}

// Sends a menu command to the page (core/ui/js/shell.js).
function sendCommand(cmd) {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (cmd === 'openLog') { shell.openPath(logFile()); return; }
    mainWindow.show();
    mainWindow.webContents.send('hc:command', cmd);
}

shellSvc.guardProcess((m) => log(m));

app.whenReady().then(() => {
    if (!FIRST_INSTANCE) return;
    if (MAC && !PANEL) shellSvc.macMenu(Menu, app, sendCommand);
    log('Started HermiteCut ' + app.getVersion() + (PANEL ? ' (Resolve panel)' : '') + ' on ' + process.platform + ' ' + process.arch);
    registerIpc();
    setupLicence();
    startMcp();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
