// HermiteCut's local MCP server, so Claude (Claude Code, Claude Desktop) can
// use HermiteCut in Resolve.
//
// - Streamable HTTP (MCP JSON-RPC over POST /mcp), on 127.0.0.1 only.
// - Every request needs the token: "Authorization: Bearer <token>". The token
//   is made once and kept in the app's data folder.
// - Requests from web pages (an Origin header that isn't localhost) are
//   refused, so a site in a browser can't drive it.
// - ~/.hermitecut/mcp.json says where it is, for the stdio bridge
//   (crates/hc-mcp) that Claude Desktop starts.
//
// scripts/assemble.py compiles this file to core/mcp/server.js for Electron.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildTools, type Call, type Json, type Tool } from './tools.ts';

export const DEFAULT_PORT = 47361;
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS =
    'HermiteCut edits in DaVinci Resolve: effects, transitions (including Grid Reveal), titles, sounds and one-click actions. ' +
    'Start with resolve_status. Effects and actions work on the clips selected on the Edit page timeline, so ask the user to select clips first if none are selected. ' +
    'Use list_templates and list_sounds to find names before applying them.';

export interface McpOptions {
    /** The app's actions (host.api), name -> async (args) => result. */
    api: Record<string, (args: Json) => Promise<unknown>>;
    version: string;
    /** Where the token is kept (the app's data folder). */
    dataDir: string;
    /** core/ui/js/quick.js, for the list of one-click actions. */
    quickJsPath?: string;
    port?: number;
    /** Where to write mcp.json for the stdio bridge; null to skip. */
    discoveryDir?: string | null;
    log?: (msg: string) => void;
}

export interface McpHandle {
    url: string;
    port: number;
    token: string;
    tools: Tool[];
    close(): Promise<void>;
}

export function discoveryDir(): string {
    return join(homedir(), '.hermitecut');
}

function loadToken(dataDir: string): string {
    const file = join(dataDir, 'mcp-token');
    try {
        const t = readFileSync(file, 'utf8').trim();
        if (/^[0-9a-f]{64}$/.test(t)) return t;
    } catch {
        /* make one */
    }
    const t = randomBytes(32).toString('hex');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, t, { mode: 0o600 });
    return t;
}

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Json };

const reply = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Tools without their run functions, as MCP lists them. */
function describe(tools: Tool[]) {
    return tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, ...(annotations ? { annotations } : {}) }));
}

/** Handle one JSON-RPC message. Returns undefined for notifications. */
export async function handle(msg: Rpc, tools: Tool[], call: Call, version: string): Promise<unknown> {
    if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Invalid request');
    const isNotification = msg.id === undefined || msg.id === null;
    if (isNotification) return undefined;
    switch (msg.method) {
        case 'initialize': {
            const asked = String(msg.params?.protocolVersion ?? '');
            return reply(msg.id, {
                protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
                capabilities: { tools: { listChanged: false } },
                serverInfo: { name: 'hermitecut', title: 'HermiteCut', version },
                instructions: INSTRUCTIONS,
            });
        }
        case 'ping':
            return reply(msg.id, {});
        case 'tools/list':
            return reply(msg.id, { tools: describe(tools) });
        case 'tools/call': {
            const name = String(msg.params?.name ?? '');
            const tool = tools.find((t) => t.name === name);
            if (!tool) return fail(msg.id, -32602, `Unknown tool: ${name}`);
            try {
                const result = await tool.run((msg.params?.arguments as Json) ?? {}, call);
                const text = typeof result === 'string' ? result : JSON.stringify(result ?? { ok: true }, null, 2);
                return reply(msg.id, { content: [{ type: 'text', text }], isError: false });
            } catch (e) {
                return reply(msg.id, { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true });
            }
        }
        default:
            return fail(msg.id, -32601, `Method not found: ${msg.method}`);
    }
}

function localOrigin(origin: string | undefined): boolean {
    if (!origin || origin === 'null') return true;
    try {
        const h = new URL(origin).hostname;
        return h === '127.0.0.1' || h === 'localhost' || h === '[::1]';
    } catch {
        return false;
    }
}

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
    const text = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store', ...headers });
    res.end(text);
}

function readBody(req: IncomingMessage, limit = 4 * 1024 * 1024): Promise<string> {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => {
            size += c.length;
            if (size > limit) {
                reject(new Error('Request too large'));
                req.destroy();
            } else chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function listen(server: Server, port: number): Promise<number> {
    return new Promise((resolve, reject) => {
        const onError = (e: NodeJS.ErrnoException) => {
            server.off('listening', onListening);
            reject(e);
        };
        const onListening = () => {
            server.off('error', onError);
            const a = server.address();
            resolve(typeof a === 'object' && a ? a.port : port);
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
    });
}

/** Start the server. Tries the default port and the next nine. */
export async function startMcp(opts: McpOptions): Promise<McpHandle> {
    const log = opts.log ?? (() => {});
    const token = loadToken(opts.dataDir);
    const tools = buildTools({ actionNames: Object.keys(opts.api).sort(), ...(opts.quickJsPath ? { quickJsPath: opts.quickJsPath } : {}) });
    const call: Call = async (action, args = {}) => {
        const fn = opts.api[action];
        if (!fn) throw new Error(`HermiteCut has no action called ${action}.`);
        return fn(args);
    };

    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            if (url.pathname !== '/mcp') return send(res, 404, { error: 'Not found' });
            if (!localOrigin(req.headers.origin)) return send(res, 403, { error: 'Forbidden origin' });
            if (req.headers.authorization !== `Bearer ${token}`) {
                return send(res, 401, { error: 'Missing or wrong token' }, { 'WWW-Authenticate': 'Bearer realm="hermitecut"' });
            }
            if (req.method === 'GET' || req.method === 'DELETE') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
            if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' }, { Allow: 'POST' });
            let body: unknown;
            try {
                body = JSON.parse(await readBody(req));
            } catch {
                return send(res, 400, fail(null, -32700, 'Parse error'));
            }
            const msgs = Array.isArray(body) ? (body as Rpc[]) : [body as Rpc];
            const out = (await Promise.all(msgs.map((m) => handle(m, tools, call, opts.version)))).filter((r) => r !== undefined);
            if (!out.length) return send(res, 202);
            return send(res, 200, Array.isArray(body) ? out : out[0]);
        } catch (e) {
            log('MCP request failed: ' + (e instanceof Error ? e.message : String(e)));
            if (!res.headersSent) send(res, 500, fail(null, -32603, 'Internal error'));
        }
    });

    const first = opts.port ?? DEFAULT_PORT;
    let port = -1;
    for (let p = first; p < first + (first === 0 ? 1 : 10); p++) {
        try {
            port = await listen(server, p);
            break;
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
        }
    }
    if (port < 0) throw new Error(`Ports ${first}-${first + 9} are all in use`);
    const url = `http://127.0.0.1:${port}/mcp`;

    const dir = opts.discoveryDir === undefined ? discoveryDir() : opts.discoveryDir;
    const disc = dir ? join(dir, 'mcp.json') : null;
    if (dir && disc) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(disc, JSON.stringify({ url, token, pid: process.pid, version: opts.version }, null, 2), { mode: 0o600 });
    }
    log(`MCP server for Claude on ${url} (${tools.length} tools)`);

    return {
        url,
        port,
        token,
        tools,
        close: () =>
            new Promise<void>((resolve) => {
                if (disc) {
                    try {
                        const d = JSON.parse(readFileSync(disc, 'utf8')) as { pid?: number };
                        if (d.pid === process.pid) rmSync(disc);
                    } catch {
                        /* already gone */
                    }
                }
                server.close(() => resolve());
            }),
    };
}
