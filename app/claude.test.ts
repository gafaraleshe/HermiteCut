// Connecting Claude Desktop and Claude Code, on simulated macOS and Windows
// home folders.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const claude = require('./claude.js');

let home: string, nativeDir: string, calls: string[][];
const exec = async (cmd: string, args: string[]) => { calls.push([cmd, ...args]); return { stdout: '', stderr: '' }; };

function setup(platform: 'darwin' | 'win32', extra: Record<string, unknown> = {}) {
    for (const f of ['hermitecut-mcp-darwin-arm64', 'hermitecut-mcp-win32-x64.exe']) writeFileSync(join(nativeDir, f), 'bridge-v1');
    const arch = platform === 'darwin' ? 'arm64' : 'x64';
    const env = platform === 'win32' ? { APPDATA: join(home, 'AppData', 'Roaming'), LOCALAPPDATA: join(home, 'AppData', 'Local'), PATH: '' } : { PATH: '' };
    return claude.create({ platform, arch, home, env, nativeDir, exec, ...extra });
}
const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'));
const macCfg = () => join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'hc-claude-home-'));
    nativeDir = mkdtempSync(join(tmpdir(), 'hc-claude-native-'));
    calls = [];
});
afterEach(() => { rmSync(home, { recursive: true }); rmSync(nativeDir, { recursive: true }); });

describe('Claude Desktop', () => {
    test('macOS: connects, keeps other servers, backs up, disconnects', async () => {
        mkdirSync(join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
        writeFileSync(macCfg(), JSON.stringify({ mcpServers: { other: { command: 'x' } }, theme: 'dark' }));
        const c = setup('darwin');
        expect(c.status().desktop).toMatchObject({ installed: true, connected: false });
        await c.connectDesktop();
        const bridge = join(home, '.hermitecut', 'bin', 'hermitecut-mcp');
        expect(readFileSync(bridge, 'utf8')).toBe('bridge-v1');
        expect(json(macCfg())).toEqual({ mcpServers: { other: { command: 'x' }, hermitecut: { command: bridge, args: [] } }, theme: 'dark' });
        expect(existsSync(macCfg() + '.before-hermitecut')).toBe(true);
        // the downloaded app's quarantine flag is cleared on the copy
        expect(calls).toContainEqual(['/usr/bin/xattr', '-d', 'com.apple.quarantine', bridge]);
        expect(c.status().desktop.connected).toBe(true);
        c.disconnectDesktop();
        expect(json(macCfg())).toEqual({ mcpServers: { other: { command: 'x' } }, theme: 'dark' });
        expect(c.status().desktop.connected).toBe(false);
    });

    test('macOS: works before Claude Desktop is installed', async () => {
        const c = setup('darwin');
        expect(c.status().desktop.installed).toBe(false);
        await c.connectDesktop();
        expect(json(macCfg()).mcpServers.hermitecut.command).toContain('hermitecut-mcp');
    });

    test('Windows: the normal and Microsoft Store installs both get it', async () => {
        const normal = join(home, 'AppData', 'Roaming', 'Claude');
        const store = join(home, 'AppData', 'Local', 'Packages', 'Claude_pzs8sxrjxfjjc', 'LocalCache', 'Roaming', 'Claude');
        mkdirSync(normal, { recursive: true }); mkdirSync(store, { recursive: true });
        const c = setup('win32');
        await c.connectDesktop();
        const bridge = join(home, '.hermitecut', 'bin', 'hermitecut-mcp.exe');
        expect(json(join(normal, 'claude_desktop_config.json')).mcpServers.hermitecut.command).toBe(bridge);
        expect(json(join(store, 'claude_desktop_config.json')).mcpServers.hermitecut.command).toBe(bridge);
        expect(calls.length).toBe(0); // no xattr on Windows
    });

    test('a settings file with a mistake is left alone', async () => {
        mkdirSync(join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
        writeFileSync(macCfg(), '{ "mcpServers": { oops');
        const c = setup('darwin');
        await expect(c.connectDesktop()).rejects.toThrow('mistake');
        expect(readFileSync(macCfg(), 'utf8')).toBe('{ "mcpServers": { oops');
    });

    test('an entry for an older HermiteCut is reported for repair', async () => {
        mkdirSync(join(home, 'Library', 'Application Support', 'Claude'), { recursive: true });
        writeFileSync(macCfg(), JSON.stringify({ mcpServers: { hermitecut: { command: '/Applications/Old.app/hermitecut-mcp' } } }));
        expect(setup('darwin').status().desktop).toMatchObject({ connected: false, stale: true });
    });

    test('an update refreshes the bridge Claude uses', async () => {
        const c = setup('darwin');
        await c.connectDesktop();
        writeFileSync(join(nativeDir, 'hermitecut-mcp-darwin-arm64'), 'bridge-v2');
        await c.installBridge();
        expect(readFileSync(c.bridgePath(), 'utf8')).toBe('bridge-v2');
    });

    test('a build without the bridge says so', async () => {
        const c = claude.create({ platform: 'darwin', arch: 'arm64', home, env: {}, nativeDir, exec });
        await expect(c.connectDesktop()).rejects.toThrow('no Claude bridge');
    });
});

describe('Claude Code', () => {
    test('macOS: finds claude outside the PATH and adds HermiteCut for the user', async () => {
        mkdirSync(join(home, '.local', 'bin'), { recursive: true });
        writeFileSync(join(home, '.local', 'bin', 'claude'), '');
        const c = setup('darwin');
        expect(c.status().code).toMatchObject({ installed: true, connected: false });
        await c.connectCode();
        const exe = join(home, '.local', 'bin', 'claude');
        expect(calls).toContainEqual([exe, 'mcp', 'remove', '--scope', 'user', 'hermitecut']);
        expect(calls).toContainEqual([exe, 'mcp', 'add', '--scope', 'user', 'hermitecut', '--', c.bridgePath()]);
        // what Claude Code records in ~/.claude.json
        writeFileSync(join(home, '.claude.json'), JSON.stringify({ mcpServers: { hermitecut: { type: 'stdio', command: c.bridgePath(), args: [] } } }));
        expect(c.status().code.connected).toBe(true);
    });

    test('Windows: an npm install (claude.cmd) runs through cmd.exe, with spaces quoted', async () => {
        const npm = join(home, 'AppData', 'Roaming', 'npm');
        mkdirSync(npm, { recursive: true });
        writeFileSync(join(npm, 'claude.cmd'), '');
        const c = setup('win32', { home: home });
        await c.connectCode();
        const add = calls.find(x => x.join(' ').includes(' add '))!;
        expect(add[0]).toBe('cmd.exe');
        expect(add.slice(1, 4)).toEqual(['/d', '/s', '/c']);
        expect(add[4]).toContain('mcp add --scope user hermitecut --');
    });

    test('says so when Claude Code is not installed', async () => {
        const c = setup('darwin');
        expect(c.status().code.installed).toBe(false);
        await expect(c.connectCode()).rejects.toThrow('isn’t installed');
    });

    test('passes on what Claude Code says when it refuses', async () => {
        mkdirSync(join(home, '.local', 'bin'), { recursive: true });
        writeFileSync(join(home, '.local', 'bin', 'claude'), '');
        const failing = async (_c: string, args: string[]) => { if (args.includes('add')) throw Object.assign(new Error('x'), { stderr: 'Invalid scope\nmore' }); return { stdout: '', stderr: '' }; };
        await expect(setup('darwin', { exec: failing }).connectCode()).rejects.toThrow('Invalid scope');
    });
});
