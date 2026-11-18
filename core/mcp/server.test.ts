// HermiteCut's MCP server: protocol, security and tools, plus Claude Desktop's
// path end to end (the Rust stdio bridge, crates/hc-mcp, talking to it).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startMcp, type McpHandle } from './server.ts';
import { quickActions } from './tools.ts';

const repo = join(import.meta.dir, '..', '..');
const calls: { action: string; args: unknown }[] = [];
const api: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    status: async () => ({ connected: true, page: 'edit', project: 'Scratch', timeline: 'Edit 1', selected: 2 }),
    catalogue: async () => ({
        templates: [
            { id: 'Fusion/Effects/HermiteCut/Flash', kind: 'effect', name: 'Flash', family: 'Flashes', blurb: 'A clean white flash.' },
            { id: 'Fusion/Transitions/HermiteCut/Whip', kind: 'transition', name: 'Whip', family: 'Motion' },
        ],
        sounds: [{ name: 'Whoosh Fast', category: 'Whooshes', file: 'Whooshes/Whoosh Fast.wav', seconds: 0.6 }],
        sfxDir: '/res/sfx',
    }),
    applyEffect: async (a) => (calls.push({ action: 'applyEffect', args: a }), { msg: 'Flash on 2 clip(s)' }),
    placeAudio: async (a) => (calls.push({ action: 'placeAudio', args: a }), { placed: 1 }),
    quick: async (a) => (calls.push({ action: 'quick', args: a }), { msg: 'done' }),
    removeEffects: async () => {
        throw new Error('Select clips on the Edit page first.');
    },
};

let mcp: McpHandle;
let dir: string;
const post = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(mcp.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mcp.token}`, ...headers },
        body: JSON.stringify(body),
    });
const rpc = async (method: string, params?: unknown, id = 1) => (await (await post({ jsonrpc: '2.0', id, method, params })).json()) as any;

beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'hc-mcp-'));
    mcp = await startMcp({ api, version: '9.9.9', dataDir: dir, port: 0, discoveryDir: dir, quickJsPath: join(repo, 'core', 'ui', 'js', 'quick.js') });
});
afterAll(async () => {
    await mcp.close();
    rmSync(dir, { recursive: true });
});

describe('security', () => {
    test('listens on 127.0.0.1 only and needs the token', async () => {
        expect(mcp.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
        expect(mcp.token).toMatch(/^[0-9a-f]{64}$/);
        expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: 'Bearer wrong' })).status).toBe(401);
        const none = await fetch(mcp.url, { method: 'POST', body: '{}' });
        expect(none.status).toBe(401);
    });
    test('refuses requests from web pages', async () => {
        expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://evil.example' })).status).toBe(403);
        expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'http://localhost:3000' })).status).toBe(200);
    });
    test('keeps the same token across restarts, and writes mcp.json', async () => {
        const again = await startMcp({ api, version: '9.9.9', dataDir: dir, port: 0, discoveryDir: null });
        expect(again.token).toBe(mcp.token);
        await again.close();
        const d = JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8'));
        expect(d).toMatchObject({ url: mcp.url, token: mcp.token, version: '9.9.9' });
    });
});

describe('protocol', () => {
    test('initialize agrees a version and describes HermiteCut', async () => {
        const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
        expect(r.result.protocolVersion).toBe('2025-06-18');
        expect(r.result.serverInfo).toMatchObject({ name: 'hermitecut', version: '9.9.9' });
        expect(r.result.capabilities.tools).toBeDefined();
        expect((await rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion).toBe('2025-11-25');
    });
    test('notifications get 202 and no body', async () => {
        const r = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
        expect(r.status).toBe(202);
        expect(await r.text()).toBe('');
    });
    test('unknown methods and bad JSON are JSON-RPC errors', async () => {
        expect((await rpc('nope')).error.code).toBe(-32601);
        const bad = await fetch(mcp.url, { method: 'POST', headers: { Authorization: `Bearer ${mcp.token}` }, body: '{' });
        expect(bad.status).toBe(400);
        expect(((await bad.json()) as any).error.code).toBe(-32700);
    });
});

describe('tools', () => {
    test('lists the tools with schemas', async () => {
        const { tools } = (await rpc('tools/list')).result;
        const names = tools.map((t: any) => t.name);
        for (const n of ['resolve_status', 'list_templates', 'apply_effect', 'add_transition', 'insert_title', 'place_sound', 'run_action', 'hermitecut_action']) {
            expect(names).toContain(n);
        }
        for (const t of tools) expect(t.inputSchema.type).toBe('object');
        const run = tools.find((t: any) => t.name === 'run_action');
        expect(run.description).toContain('speed');
    });
    test('resolve_status runs the status action', async () => {
        const r = (await rpc('tools/call', { name: 'resolve_status', arguments: {} })).result;
        expect(r.isError).toBe(false);
        expect(JSON.parse(r.content[0].text)).toMatchObject({ project: 'Scratch', selected: 2 });
    });
    test('apply_effect finds the template by name and passes its id', async () => {
        const r = (await rpc('tools/call', { name: 'apply_effect', arguments: { template: 'flash', values: { Frames: 8 } } })).result;
        expect(r.isError).toBe(false);
        expect(calls.at(-1)).toEqual({ action: 'applyEffect', args: { id: 'Fusion/Effects/HermiteCut/Flash', values: { Frames: 8 } } });
        const miss = (await rpc('tools/call', { name: 'apply_effect', arguments: { template: 'Whip' } })).result;
        expect(miss.isError).toBe(true);
        expect(miss.content[0].text).toContain('list_templates');
    });
    test('place_sound turns a name into the file', async () => {
        await rpc('tools/call', { name: 'place_sound', arguments: { sound: 'Whoosh Fast', where: 'cuts', offset: -6 } });
        expect(calls.at(-1)).toEqual({ action: 'placeAudio', args: { file: '/res/sfx/Whooshes/Whoosh Fast.wav', where: 'cuts', offset: -6 } });
    });
    test('an action error comes back as a tool error Claude can read', async () => {
        const r = (await rpc('tools/call', { name: 'remove_effects', arguments: {} })).result;
        expect(r.isError).toBe(true);
        expect(r.content[0].text).toBe('Select clips on the Edit page first.');
    });
    test('reads the one-click actions from the Actions module', () => {
        const q = quickActions(readFileSync(join(repo, 'core', 'ui', 'js', 'quick.js'), 'utf8'));
        expect(q.length).toBeGreaterThan(20);
        expect(q.find((a) => a.id === 'speed')?.names).toContain('Speed 50%');
    });
});

const bridge = join(repo, 'target', 'debug', `hermitecut-mcp${process.platform === 'win32' ? '.exe' : ''}`);
test.skipIf(!existsSync(bridge))("Claude Desktop's path: the Rust stdio bridge talks to the server", async () => {
    const child = spawn(bridge, [], { env: { ...process.env, HERMITECUT_MCP_DISCOVERY: join(dir, 'mcp.json') } });
    const lines: string[] = [];
    let buf = '';
    child.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            lines.push(buf.slice(0, i));
            buf = buf.slice(i + 1);
        }
    });
    const send = (m: unknown) => child.stdin.write(JSON.stringify(m) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-desktop-test', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'resolve_status', arguments: {} } });
    for (let t = 0; t < 100 && lines.length < 2; t++) await Bun.sleep(50);
    child.stdin.end();
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).result.serverInfo.name).toBe('hermitecut');
    expect(JSON.parse(JSON.parse(lines[1]!).result.content[0].text).timeline).toBe('Edit 1');
});
