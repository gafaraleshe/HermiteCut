// HermiteCut — motion math (shared by Motion, Bounce)
'use strict';

// ---- cubic bezier evaluation (CSS-style, P0=(0,0), P3=(1,1)) ----
function bezierAt(c, x) {
    const [x1, y1, x2, y2] = c;
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    // Solve x(t) = x with Newton + bisection fallback
    const cx = (t) => 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t;
    const cy = (t) => 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t;
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 30; i++) {
        const v = cx(t);
        if (Math.abs(v - x) < 1e-6) break;
        if (v < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
    }
    return cy(t);
}

// ---- spring / bounce curve: f(0)=0, f(1)=1 ----
// opts: { mode:'overshoot'|'bounce', amplitude:0..1, bounces:1..8, decay:0..10, rise:0.1..0.6 }
function spring(p, o) {
    const mode = o.mode || 'overshoot';
    const A = o.amplitude == null ? 0.35 : o.amplitude;
    const n = Math.max(1, o.bounces || 3);
    const k = o.decay == null ? 4 : o.decay;
    const r = Math.min(0.7, Math.max(0.08, o.rise || 0.3));
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    if (p < r) {
        const q = p / r;
        if (mode === 'bounce') return q * q;                 // accelerate like gravity
        // ease-out rise whose end-slope matches the first overshoot lobe
        return 1 - Math.pow(1 - q, 2);
    }
    const q = (p - r) / (1 - r);
    const env = Math.exp(-k * q) * (1 - q);
    if (mode === 'bounce') return 1 - A * env * Math.abs(Math.sin(Math.PI * n * q));
    return 1 + A * env * Math.sin(Math.PI * n * q);
}

function springSamples(o, N) {
    N = N || 120;
    const out = [];
    for (let i = 0; i <= N; i++) out.push(+spring(i / N, o).toFixed(5));
    return out;
}

// ---- keyframe builders. A key = [t, v, rhT, rhV, lhT, lhV, linear] ----
class Channel {
    constructor() { this.map = new Map(); }
    put(t, v, rh, lh, linear) {
        t = Math.round(t * 1000) / 1000;
        const cur = this.map.get(t) || [t, v, null, null, null, null, false];
        cur[1] = v;
        if (rh) { cur[2] = rh[0]; cur[3] = rh[1]; }
        if (lh) { cur[4] = lh[0]; cur[5] = lh[1]; }
        if (linear) cur[6] = true;
        this.map.set(t, cur);
    }
    eased(t0, v0, t1, v1, c) {
        const dt = t1 - t0, dv = v1 - v0;
        this.put(t0, v0, [t0 + c[0] * dt, v0 + c[1] * dv], null);
        this.put(t1, v1, null, [t0 + c[2] * dt, v0 + c[3] * dv]);
    }
    sampled(t0, v0, t1, v1, fn) {
        const dt = t1 - t0;
        if (dt <= 0) return;
        for (let f = 0; f <= dt; f++) {
            const p = f / dt;
            this.put(t0 + f, v0 + (v1 - v0) * fn(p), null, null, true);
        }
    }
    hold(t, v) { this.put(t, v, null, null, true); }
    keys() {
        const ks = [...this.map.values()].sort((a, b) => a[0] - b[0]);
        // Fusion fills missing handles with value 0, so give every key explicit flat handles.
        ks.forEach((k, i) => {
            if (k[6]) return;
            const prev = ks[i - 1], next = ks[i + 1];
            if (k[2] == null && next) { k[2] = k[0] + (next[0] - k[0]) / 3; k[3] = k[1]; }
            if (k[4] == null && prev) { k[4] = k[0] - (k[0] - prev[0]) / 3; k[5] = k[1]; }
        });
        return ks.map(k => {
            const o = [k[0], k[1]];
            o.push(k[2] == null ? null : k[2], k[3] == null ? null : k[3], k[4] == null ? null : k[4], k[5] == null ? null : k[5], !!k[6]);
            return o;
        });
    }
    get empty() { return this.map.size === 0; }
}

// Deterministic pseudo-random for shake
function prng(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
}

/**
 * Build the Fusion keyframe spec for a clip.
 * p = { preset, mode:'in'|'out'|'both', durIn, durOut, amount(0..100+), curve:[x1,y1,x2,y2],
 *       spring:{...}, blur:bool, s, e }
 */
function buildMotion(p) {
    const s = p.s, e = p.e;
    const len = Math.max(1, e - s);
    const curve = p.curve || [0.22, 1, 0.36, 1];
    const durIn = Math.max(1, Math.min(p.durIn || 12, len));
    const durOut = Math.max(1, Math.min(p.durOut || 12, len));
    const amt = (p.amount == null ? 20 : p.amount) / 100;
    const wantIn = p.mode === 'in' || p.mode === 'both';
    const wantOut = p.mode === 'out' || p.mode === 'both';
    const size = new Channel(), angle = new Channel(), cx = new Channel(), cy = new Channel();
    const spec = { blur: !!p.blur, baseSize: 1, edges: 0 };
    const reverse = (c) => [1 - c[2], 1 - c[3], 1 - c[0], 1 - c[1]];

    const inSeg = (ch, from, to, c) => ch.eased(s, from, s + durIn, to, c || curve);
    const outSeg = (ch, from, to, c) => ch.eased(e - durOut, from, e, to, c || curve);

    switch (p.preset) {
        case 'grow':
            if (wantIn) inSeg(size, Math.max(0, 1 - amt), 1);
            if (wantOut) outSeg(size, 1, 1 + amt);
            break;
        case 'shrink':
            if (wantIn) inSeg(size, 1 + amt, 1);
            if (wantOut) outSeg(size, 1, Math.max(0, 1 - amt));
            break;
        case 'slideLeft': case 'slideRight': case 'slideUp': case 'slideDown': case 'whip': {
            const d = p.preset === 'whip' ? 1 : Math.max(0.02, amt); // amount = distance in % of frame width/height
            const dir = { slideLeft: [-1, 0], whip: [-1, 0], slideRight: [1, 0], slideUp: [0, 1], slideDown: [0, -1] }[p.preset];
            const c = p.preset === 'whip' ? [0.85, 0, 0.15, 1] : curve;
            if (dir[0]) {
                if (wantIn) inSeg(cx, 0.5 - dir[0] * d, 0.5, c);
                if (wantOut) outSeg(cx, 0.5, 0.5 + dir[0] * d, c);
            } else {
                if (wantIn) inSeg(cy, 0.5 - dir[1] * d, 0.5, c);
                if (wantOut) outSeg(cy, 0.5, 0.5 + dir[1] * d, c);
            }
            if (p.preset === 'whip') spec.blur = true;
            break;
        }
        case 'spin': {
            const deg = Math.max(5, amt * 360); // amount = % of a full turn
            if (wantIn) { inSeg(angle, -deg, 0); inSeg(size, 0.4, 1); }
            if (wantOut) { outSeg(angle, 0, deg); outSeg(size, 1, 0.4); }
            break;
        }
        case 'pop': {
            const sp = p.spring || { mode: 'overshoot', amplitude: 0.35, bounces: 3, decay: 4 };
            if (wantIn) size.sampled(s, 0, s + durIn, 1, (q) => spring(q, sp));
            if (wantOut) outSeg(size, 1, 0, [0.6, -0.4, 0.8, 0.4]);
            break;
        }
        case 'punch': {
            // fast punch-in that holds
            const at = wantOut && !wantIn ? e - durOut : s;
            const d = wantOut && !wantIn ? durOut : durIn;
            size.eased(at, 1, at + d, 1 + amt, curve);
            if (at > s) size.hold(s, 1);
            break;
        }
        case 'kenburns': {
            size.eased(s, 1, e, 1 + amt, curve);
            cx.eased(s, 0.5, e, 0.5 - amt / 8, curve);
            break;
        }
        case 'shake': {
            const rnd = prng(1234 + Math.round(len));
            const dur = wantOut && !wantIn ? durOut : durIn;
            const t0 = wantOut && !wantIn ? e - dur : s;
            const mag = Math.max(0.002, amt * 0.12);
            spec.baseSize = 1 + mag * 2.2;
            size.hold(t0, spec.baseSize);
            for (let f = 0; f <= dur; f += 2) {
                const k = 1 - f / dur;
                const decay = k * k;
                cx.hold(t0 + f, 0.5 + rnd() * mag * decay);
                cy.hold(t0 + f, 0.5 + rnd() * mag * decay);
                angle.hold(t0 + f, rnd() * mag * 40 * decay);
            }
            cx.hold(t0 + dur, 0.5); cy.hold(t0 + dur, 0.5); angle.hold(t0 + dur, 0);
            break;
        }
        default:
            throw new Error('Unknown motion preset: ' + p.preset);
    }
    if (!size.empty) spec.size = size.keys();
    if (!angle.empty) spec.angle = angle.keys();
    if (!cx.empty) spec.cx = cx.keys();
    if (!cy.empty) spec.cy = cy.keys();
    void reverse;
    return spec;
}

module.exports = { bezierAt, spring, springSamples, buildMotion };
