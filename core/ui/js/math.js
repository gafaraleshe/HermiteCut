// HermiteCut — shared curve math (renderer)
(function () {
    'use strict';
    function bezierAt(c, x) {
        const [x1, y1, x2, y2] = c;
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        const cx = (t) => 3 * x1 * t * (1 - t) * (1 - t) + 3 * x2 * t * t * (1 - t) + t * t * t;
        const cy = (t) => 3 * y1 * t * (1 - t) * (1 - t) + 3 * y2 * t * t * (1 - t) + t * t * t;
        let lo = 0, hi = 1, t = x;
        for (let i = 0; i < 32; i++) {
            const v = cx(t);
            if (Math.abs(v - x) < 1e-6) break;
            if (v < x) lo = t; else hi = t;
            t = (lo + hi) / 2;
        }
        return cy(t);
    }
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
            if (mode === 'bounce') return q * q;
            return 1 - Math.pow(1 - q, 2);
        }
        const q = (p - r) / (1 - r);
        const env = Math.exp(-k * q) * (1 - q);
        if (mode === 'bounce') return 1 - A * env * Math.abs(Math.sin(Math.PI * n * q));
        return 1 + A * env * Math.sin(Math.PI * n * q);
    }
    // name, cubic-bezier
    const PRESETS = [
        ['Linear', [0, 0, 1, 1]],
        ['Ease', [0.25, 0.1, 0.25, 1]],
        ['Ease In', [0.42, 0, 1, 1]],
        ['Ease Out', [0, 0, 0.58, 1]],
        ['Ease In Out', [0.42, 0, 0.58, 1]],
        ['Sine In', [0.12, 0, 0.39, 0]],
        ['Sine Out', [0.61, 1, 0.88, 1]],
        ['Sine In Out', [0.37, 0, 0.63, 1]],
        ['Quad In', [0.11, 0, 0.5, 0]],
        ['Quad Out', [0.5, 1, 0.89, 1]],
        ['Quad In Out', [0.45, 0, 0.55, 1]],
        ['Cubic In', [0.32, 0, 0.67, 0]],
        ['Cubic Out', [0.33, 1, 0.68, 1]],
        ['Cubic In Out', [0.65, 0, 0.35, 1]],
        ['Quint In', [0.64, 0, 0.78, 0]],
        ['Quint Out', [0.22, 1, 0.36, 1]],
        ['Quint In Out', [0.83, 0, 0.17, 1]],
        ['Expo In', [0.7, 0, 0.84, 0]],
        ['Expo Out', [0.16, 1, 0.3, 1]],
        ['Expo In Out', [0.87, 0, 0.13, 1]],
        ['Circ In', [0.55, 0, 1, 0.45]],
        ['Circ Out', [0, 0.55, 0.45, 1]],
        ['Circ In Out', [0.85, 0, 0.15, 1]],
        ['Back In', [0.36, 0, 0.66, -0.56]],
        ['Back Out', [0.34, 1.56, 0.64, 1]],
        ['Back In Out', [0.68, -0.6, 0.32, 1.6]],
        ['Snap', [0.9, 0, 0.1, 1]],
        ['Smooth Glide', [0.4, 0, 0.2, 1]],
        ['Whip', [0.95, 0.05, 0.05, 0.95]],
        ['Anticipate', [0.5, -0.4, 0.4, 1.3]]
    ];
    function curvePath(c, w, h, pad) {
        // SVG path in a w x h box with vertical padding fraction pad (allows overshoot)
        const pts = [];
        for (let i = 0; i <= 32; i++) {
            const x = i / 32;
            const y = bezierAt(c, x);
            pts.push([x * w, h - (pad * h) - y * h * (1 - 2 * pad)]);
        }
        return 'M' + pts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L');
    }
    window.HCMath = { bezierAt, spring, PRESETS, curvePath };
})();
