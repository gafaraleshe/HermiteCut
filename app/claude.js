// HermiteCut — one-click connection to Claude (Claude Desktop and Claude Code)
// on macOS and Windows.
//
// HermiteCut runs a local MCP server (core/mcp). Claude reaches it through
// the small stdio bridge, hermitecut-mcp, which finds the running app via
// ~/.hermitecut/mcp.json. Connecting:
//   1. copies the bridge for this computer to ~/.hermitecut/bin, a place that
//      doesn't move when HermiteCut is updated, moved or reinstalled;
//   2. Claude Desktop: adds "hermitecut" to claude_desktop_config.json, keeping
//      everything else in it and a backup of the original;
//   3. Claude Code: runs `claude mcp add --scope user hermitecut -- <bridge>`.
// No key or token is written into Claude's settings: the bridge reads the
// app's private key from ~/.hermitecut/mcp.json each time.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const NAME = 'hermitecut';

function ctxDefaults(ctx) {
    ctx = ctx || {};
    return {
        platform: ctx.platform || process.platform,
        arch: ctx.arch || process.arch,
        home: ctx.home || os.homedir(),
        env: ctx.env || process.env,
        nativeDir: ctx.nativeDir,
        exec: ctx.exec || execFileP,
        log: ctx.log || (() => {})
    };
}

function execFileP(cmd, args, opts) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, Object.assign({ timeout: 20000, windowsHide: true }, opts || {}), (err, stdout, stderr) => {
            if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); } else resolve({ stdout: String(stdout), stderr: String(stderr) });
        });
    });
}

// ---- the bridge
function bridgeName(c) {
    return 'hermitecut-mcp-' + c.platform + '-' + c.arch + (c.platform === 'win32' ? '.exe' : '');
}
/** Where Claude's settings point: stays put across updates. */
function stableBridge(c) {
    return path.join(c.home, '.hermitecut', 'bin', 'hermitecut-mcp' + (c.platform === 'win32' ? '.exe' : ''));
}

/** Copy this build's bridge to ~/.hermitecut/bin (and refresh it after an update). */
async function installBridge(c) {
    const src = path.join(c.nativeDir, bridgeName(c));
    if (!fs.existsSync(src)) throw new Error('This build of HermiteCut has no Claude bridge for ' + c.platform + ' ' + c.arch + '.');
    const dest = stableBridge(c);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const same = fs.existsSync(dest) && fs.statSync(dest).size === fs.statSync(src).size &&
        fs.readFileSync(dest).equals(fs.readFileSync(src));
    if (!same) {
        // Copy beside it, then swap, so a Claude that is using the old one
        // never sees a half-written file. (On Windows a running .exe can't be
        // replaced; it will be refreshed next time.)
        const tmp = dest + '.new';
        fs.copyFileSync(src, tmp);
        fs.chmodSync(tmp, 0o755);
        try { fs.renameSync(tmp, dest); } catch (e) {
            fs.rmSync(tmp, { force: true });
            if (!fs.existsSync(dest)) throw e;
            c.log('Claude bridge in use; it will be updated next time');
        }
    }
    if (c.platform === 'darwin') {
        // A downloaded app's files carry macOS's quarantine flag, which would
        // stop Claude starting the bridge.
        try { await c.exec('/usr/bin/xattr', ['-d', 'com.apple.quarantine', dest]); } catch (e) { /* not set */ }
    }
    return dest;
}

// ---- Claude Desktop
/** claude_desktop_config.json locations for this computer, most likely first. */
function desktopConfigPaths(c) {
    if (c.platform === 'darwin') return [path.join(c.home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')];
    if (c.platform === 'win32') {
        const appData = c.env.APPDATA || path.join(c.home, 'AppData', 'Roaming');
        const local = c.env.LOCALAPPDATA || path.join(c.home, 'AppData', 'Local');
        const list = [path.join(appData, 'Claude', 'claude_desktop_config.json')];
        // The Microsoft Store version keeps its settings in its own package folder.
        try {
            for (const d of fs.readdirSync(path.join(local, 'Packages'))) {
                if (/^Claude_/i.test(d)) list.push(path.join(local, 'Packages', d, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json'));
            }
        } catch (e) { /* no Packages folder */ }
        return list;
    }
    return [path.join(c.env.XDG_CONFIG_HOME || path.join(c.home, '.config'), 'Claude', 'claude_desktop_config.json')];
}

function readJson(file) {
    if (!fs.existsSync(file)) return {};
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) return {};
    try {
        const v = JSON.parse(text);
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        return v;
    } catch (e) {
        throw new Error('Claude’s settings file has a mistake in it, so HermiteCut left it alone: ' + file);
    }
}

function writeJsonAtomic(file, obj) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.hermitecut-tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
    fs.renameSync(tmp, file);
}

/** The config files to change: the ones Claude Desktop already has, or the usual place. */
function desktopTargets(c) {
    const all = desktopConfigPaths(c);
    const existing = all.filter(f => fs.existsSync(path.dirname(f)));
    return existing.length ? existing : [all[0]];
}

function desktopStatus(c) {
    const bridge = stableBridge(c);
    const installed = desktopConfigPaths(c).some(f => fs.existsSync(path.dirname(f)));
    let connected = false, stale = false, error = '';
    for (const f of desktopConfigPaths(c)) {
        try {
            const e = (readJson(f).mcpServers || {})[NAME];
            if (!e) continue;
            if (e.command === bridge && fs.existsSync(bridge)) connected = true; else stale = true;
        } catch (err) { error = err.message; }
    }
    return { installed, connected, stale: stale && !connected, error };
}

async function connectDesktop(c) {
    const bridge = await installBridge(c);
    const files = desktopTargets(c);
    for (const f of files) {
        const cfg = readJson(f);
        if (fs.existsSync(f) && !fs.existsSync(f + '.before-hermitecut')) fs.copyFileSync(f, f + '.before-hermitecut');
        cfg.mcpServers = Object.assign({}, cfg.mcpServers, { [NAME]: { command: bridge, args: [] } });
        writeJsonAtomic(f, cfg);
        c.log('Claude Desktop: connected in ' + f);
    }
    return { files, bridge };
}

function disconnectDesktop(c) {
    const changed = [];
    for (const f of desktopConfigPaths(c)) {
        if (!fs.existsSync(f)) continue;
        const cfg = readJson(f);
        if (cfg.mcpServers && cfg.mcpServers[NAME]) {
            delete cfg.mcpServers[NAME];
            writeJsonAtomic(f, cfg);
            changed.push(f);
        }
    }
    return { files: changed };
}

// ---- Claude Code
/** Where the claude command usually is. Apps opened from the Dock or Start
 *  menu don't get the terminal's PATH, so look in the usual places too. */
function claudeCandidates(c) {
    const pathDirs = String(c.env.PATH || c.env.Path || '').split(path.delimiter).filter(Boolean);
    const names = c.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
    const extra = c.platform === 'win32'
        ? [path.join(c.home, '.local', 'bin'), path.join(c.env.APPDATA || path.join(c.home, 'AppData', 'Roaming'), 'npm'), path.join(c.home, '.claude', 'local')]
        : [path.join(c.home, '.local', 'bin'), path.join(c.home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin', path.join(c.home, '.npm-global', 'bin'), path.join(c.home, '.bun', 'bin')];
    const out = [];
    for (const d of pathDirs.concat(extra)) for (const n of names) {
        const f = path.join(d, n);
        if (!out.includes(f)) out.push(f);
    }
    return out;
}

function findClaude(c) {
    return claudeCandidates(c).find(f => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } }) || null;
}

function runClaude(c, exe, args) {
    // .cmd scripts (npm installs on Windows) have to go through cmd.exe.
    if (c.platform === 'win32' && /\.cmd$/i.test(exe)) return c.exec(c.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"' + [exe].concat(args).map(a => /[\s"]/.test(a) ? '"' + a.replace(/"/g, '""') + '"' : a).join(' ') + '"'], { windowsVerbatimArguments: true });
    return c.exec(exe, args);
}

function codeStatus(c) {
    const exe = findClaude(c);
    let connected = false;
    try {
        const cfg = readJson(path.join(c.home, '.claude.json'));
        const e = (cfg.mcpServers || {})[NAME];
        connected = !!(e && (e.command === stableBridge(c) || /hermitecut/i.test(JSON.stringify(e))));
    } catch (e) { /* unreadable: treat as not connected */ }
    return { installed: !!exe, connected };
}

async function connectCode(c) {
    const exe = findClaude(c);
    if (!exe) throw new Error('Claude Code isn’t installed on this computer (or HermiteCut can’t find the claude command).');
    const bridge = await installBridge(c);
    try { await runClaude(c, exe, ['mcp', 'remove', '--scope', 'user', NAME]); } catch (e) { /* wasn't there */ }
    try {
        await runClaude(c, exe, ['mcp', 'add', '--scope', 'user', NAME, '--', bridge]);
    } catch (e) {
        throw new Error('Claude Code didn’t accept the connection: ' + String((e.stderr || e.message || '')).trim().split('\n')[0]);
    }
    c.log('Claude Code: connected (' + exe + ')');
    return { exe, bridge };
}

async function disconnectCode(c) {
    const exe = findClaude(c);
    if (!exe) return { removed: false };
    try { await runClaude(c, exe, ['mcp', 'remove', '--scope', 'user', NAME]); return { removed: true }; } catch (e) { return { removed: false }; }
}

/** The connection helpers bound to this computer. */
function create(ctx) {
    const c = ctxDefaults(ctx);
    return {
        bridgePath: () => stableBridge(c),
        installBridge: () => installBridge(c),
        status: () => ({ desktop: desktopStatus(c), code: codeStatus(c), bridge: stableBridge(c), bridgeInstalled: fs.existsSync(stableBridge(c)) }),
        connectDesktop: () => connectDesktop(c),
        disconnectDesktop: () => disconnectDesktop(c),
        connectCode: () => connectCode(c),
        disconnectCode: () => disconnectCode(c),
        desktopConfigPaths: () => desktopConfigPaths(c),
        claudeCandidates: () => claudeCandidates(c)
    };
}

module.exports = { create, NAME };
