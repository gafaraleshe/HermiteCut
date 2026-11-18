// HermiteCut — standalone bridge to Resolve over fuscript (JSON lines).
// Resolve objects come back as Proxy objects, so `await timeline.GetName()`
// works exactly as it does with Resolve's WorkflowIntegration.node.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CANDIDATES = {
    win32: [
        'C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\fuscript.exe'
    ],
    darwin: [
        '/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript',
        '/Applications/DaVinci Resolve Studio/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript'
    ],
    linux: ['/opt/resolve/libs/Fusion/fuscript']
};

function findFuscript() {
    const env = process.env.HERMITECUT_FUSCRIPT;
    if (env && fs.existsSync(env)) return env;
    return (CANDIDATES[process.platform] || []).find(p => fs.existsSync(p)) || null;
}

class FuscriptBridge {
    constructor(opts) {
        this.opts = Object.assign({ timeoutMs: 30000 }, opts || {});
        this.proc = null;
        this.seq = 1;
        this.pending = new Map();
        this.buf = '';
        this.ready = null;
    }

    start() {
        if (this.ready) return this.ready;
        const exe = this.opts.fuscript || findFuscript();
        if (!exe) return Promise.reject(new Error('DaVinci Resolve was not found (fuscript is missing).'));
        const script = this.opts.script || path.join(__dirname, 'bridge.lua');
        this.ready = new Promise((resolve, reject) => {
            const p = spawn(exe, ['-l', 'lua', script], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
            this.proc = p;
            let started = false;
            const fail = (msg) => { if (!started) { started = true; this.ready = null; reject(new Error(msg)); } };
            p.on('error', (e) => fail('Could not start fuscript: ' + e.message));
            p.on('exit', () => {
                fail('Resolve did not answer. Is it running, with External scripting set to Local?');
                for (const [, w] of this.pending) w.reject(new Error('The connection to Resolve closed.'));
                this.pending.clear();
                this.proc = null;
                this.ready = null;
            });
            p.stdout.setEncoding('utf8');
            p.stdout.on('data', (chunk) => {
                this.buf += chunk;
                let i;
                while ((i = this.buf.indexOf('\n')) >= 0) {
                    const line = this.buf.slice(0, i).trim();
                    this.buf = this.buf.slice(i + 1);
                    if (!line) continue;
                    let msg;
                    try { msg = JSON.parse(line); } catch (e) { continue; }
                    if ('ready' in msg) {
                        if (msg.ready) { started = true; resolve(this.proxy(0)); } else fail('Resolve did not answer. Is it running, with External scripting set to Local?');
                        continue;
                    }
                    const w = this.pending.get(msg.id);
                    if (!w) continue;
                    this.pending.delete(msg.id);
                    clearTimeout(w.timer);
                    if (msg.ok) w.resolve(this.revive(msg.r));
                    // Through a Proxy every method "exists", so the adapter's feature checks
                    // (has(obj, 'Method')) pass; a method Resolve doesn't have returns
                    // undefined, which is what those code paths already handle.
                    else if (/\bno method\b/.test(msg.e || '')) w.resolve(undefined);
                    else w.reject(new Error(msg.e || 'Resolve error'));
                }
            });
            setTimeout(() => fail('Resolve did not answer in time. Is External scripting set to Local?'), 15000);
        });
        return this.ready;
    }

    stop() { if (this.proc) { try { this.proc.stdin.end(); this.proc.kill(); } catch (e) { /* */ } } }

    send(req) {
        if (!this.proc) return Promise.reject(new Error('Not connected to Resolve.'));
        const id = this.seq++;
        req.id = id;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Resolve took too long to answer (' + req.m + ').'));
            }, this.opts.timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            this.proc.stdin.write(JSON.stringify(req) + '\n');
        });
    }

    encode(v) {
        if (v && typeof v === 'object' && v.__hcHandle !== undefined) return { $h: v.__hcHandle };
        if (Array.isArray(v)) return v.map(x => this.encode(x));
        if (v && typeof v === 'object') {
            const o = {};
            for (const k of Object.keys(v)) o[k] = this.encode(v[k]);
            return o;
        }
        return v;
    }

    revive(v) {
        if (v && typeof v === 'object') {
            if (v.$h !== undefined && Object.keys(v).length === 1) return this.proxy(v.$h);
            if (Array.isArray(v)) return v.map(x => this.revive(x));
            const o = {};
            for (const k of Object.keys(v)) o[k] = this.revive(v[k]);
            return o;
        }
        return v;
    }

    proxy(h) {
        const self = this;
        return new Proxy({}, {
            get(_t, name) {
                if (name === '__hcHandle') return h;
                if (name === 'then' || typeof name === 'symbol' || name === 'toJSON' || name === 'inspect') return undefined;
                return (...args) => self.send({ h, m: String(name), a: self.encode(args) });
            },
            has(_t, name) { return typeof name === 'string'; }
        });
    }
}

module.exports = { FuscriptBridge, findFuscript };
