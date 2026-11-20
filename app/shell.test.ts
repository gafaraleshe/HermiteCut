// The desktop shell services: version comparison, the update check, window
// memory and the diagnostics report.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const shell = require('./shell.js');

const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('versions', () => {
    test('compares versions', () => {
        expect(shell.newer('2.3.0', '2.2.0')).toBe(true);
        expect(shell.newer('2.10.0', '2.9.9')).toBe(true);
        expect(shell.newer('v3.0.0', '2.9.9')).toBe(true);
        expect(shell.newer('2.2.0', '2.2.0')).toBe(false);
        expect(shell.newer('2.1.9', '2.2.0')).toBe(false);
        expect(shell.newer('rubbish', '2.2.0')).toBe(false);
    });
});

describe('update check', () => {
    test('reports a newer version', async () => {
        const u = await shell.checkForUpdate('2.2.0', { fetch: json({ version: '2.3.0', released: '2026-11-20', summary: ['Command palette'], notesUrl: 'https://cut.hermitelabs.com/changelog', downloadUrl: 'https://cut.hermitelabs.com/#purchase' }) });
        expect(u).toMatchObject({ available: true, latest: '2.3.0', current: '2.2.0', summary: ['Command palette'] });
    });
    test('up to date', async () => {
        expect((await shell.checkForUpdate('2.3.0', { fetch: json({ version: '2.3.0' }) })).available).toBe(false);
    });
    test('only follows https links from the feed', async () => {
        const u = await shell.checkForUpdate('2.2.0', { fetch: json({ version: '2.3.0', downloadUrl: 'file:///etc/passwd', notesUrl: 'javascript:alert(1)' }) });
        expect(u.downloadUrl).toBe('https://cut.hermitelabs.com/');
        expect(u.notesUrl).toBe('https://cut.hermitelabs.com/changelog');
    });
    test('explains failures', async () => {
        await expect(shell.checkForUpdate('2.2.0', { fetch: json({}, 503) })).rejects.toThrow('answered 503');
        await expect(shell.checkForUpdate('2.2.0', { fetch: json({ nope: 1 }) })).rejects.toThrow('no version');
        const hang = (_u: string, o: { signal: AbortSignal }) => new Promise<Response>((_r, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
        await expect(shell.checkForUpdate('2.2.0', { fetch: hang, timeoutMs: 50 })).rejects.toThrow('did not answer');
    });
});

describe('window memory', () => {
    const screen = { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] };
    const defaults = { width: 1120, height: 720, minWidth: 380, minHeight: 420 };
    test('uses the saved place when it is on screen, the default when it is not', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hc-shell-'));
        const app = { getPath: () => dir };
        expect(shell.windowState(app, screen, defaults).bounds).toEqual({ width: 1120, height: 720 });
        writeFileSync(join(dir, 'window-state.json'), JSON.stringify({ bounds: { x: 100, y: 80, width: 900, height: 600 } }));
        expect(shell.windowState(app, screen, defaults).bounds).toEqual({ x: 100, y: 80, width: 900, height: 600 });
        // a monitor that has since been unplugged
        writeFileSync(join(dir, 'window-state.json'), JSON.stringify({ bounds: { x: 3000, y: 80, width: 900, height: 600 } }));
        expect(shell.windowState(app, screen, defaults).bounds).toEqual({ width: 1120, height: 720 });
        writeFileSync(join(dir, 'window-state.json'), '{broken');
        expect(shell.windowState(app, screen, defaults).bounds).toEqual({ width: 1120, height: 720 });
        rmSync(dir, { recursive: true });
    });
});

describe('logs and diagnostics', () => {
    test('rotates a large log', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hc-shell-'));
        const f = join(dir, 'log.txt');
        writeFileSync(f, 'x'.repeat(3 * 1024 * 1024));
        shell.rotateLog(f);
        expect(existsSync(f)).toBe(false);
        expect(statSync(f + '.old').size).toBe(3 * 1024 * 1024);
        rmSync(dir, { recursive: true });
    });
    test('the report has versions and status, never the key or home folder', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hc-shell-'));
        const f = join(dir, 'log.txt');
        writeFileSync(f, `line one\nopened ${homedir()}/Movies/project.drp\n`);
        const text: string = await shell.diagnostics({
            app: { getVersion: () => '2.3.0', getLocale: () => 'en-GB' },
            mode: 'app',
            logFile: f,
            api: {
                engineInfo: async () => ({ engine: 'rust', version: '2.3.0' }),
                licenceStatus: async () => ({ required: true, valid: true, displayKey: '****-1234', key: 'HC-SECRET-KEY' }),
                status: async () => { throw new Error('Resolve is not running'); },
                mcpInfo: async () => ({ running: true, tools: 12, port: 47361, token: 'secret-token' }),
            },
        });
        expect(text).toContain('HermiteCut 2.3.0 (app)');
        expect(text).toContain('Engine: rust 2.3.0');
        expect(text).toContain('Licence: active ****-1234');
        expect(text).toContain('Resolve: not connected (Resolve is not running)');
        expect(text).toContain('Claude (MCP): running, 12 tools on port 47361');
        expect(text).toContain('~/Movies/project.drp');
        expect(text).not.toContain('HC-SECRET-KEY');
        expect(text).not.toContain('secret-token');
        expect(text).not.toContain(homedir() + '/');
        rmSync(dir, { recursive: true });
    });
});
