// HermiteCut — Bounce
(function () {
    'use strict';
    const { $, store, call, seg, range, fitCanvas, accent } = window.HC;
    const M = window.HCMath;
    const cv = $('#bCanvas');
    const S = store.get('b.s', { mode: 'overshoot', amplitude: 35, bounces: 3, decay: 4, rise: 30 });
    let anim = -1, raf = 0;

    const mode = seg($('#bModes'), (v) => { S.mode = v; save(); }, S.mode);
    const target = seg($('#bTarget'), (v) => { store.set('b.target', v); syncTarget(); }, store.get('b.target', 'keys'));
    function syncTarget() {
        const pop = target.get() === 'pop';
        $('#bDurRow').hidden = !pop;
        $('#bHint').innerHTML = pop
            ? 'Adds a spring <b>scale-in</b> to each selected clip on the Edit page (HC_Motion node in its Fusion comp).'
            : 'Rewrites each move between two keyframes with a spring. Use on clean keys (one start, one end). Fusion page: <b>selected nodes</b>; Edit page: <b>selected clips\' comps</b>.';
    }
    const opts = () => ({ mode: S.mode, amplitude: S.amplitude / 100, bounces: S.bounces, decay: S.decay, rise: S.rise / 100 });
    window.HC.bounceSpring = opts;

    function save() { store.set('b.s', S); draw(); }
    const bind = (id, key, fmt) => { const el = $(id); el.value = S[key]; range(el, $(id + 'V'), fmt, (v) => { S[key] = v; save(); }); };
    bind('#bAmp', 'amplitude', v => v + '%');
    bind('#bCnt', 'bounces', v => String(v));
    bind('#bDec', 'decay', v => v.toFixed(1));
    bind('#bRise', 'rise', v => v + '%');
    $('#bDur').value = store.get('b.dur', 18);
    $('#bDur').onchange = () => store.set('b.dur', +$('#bDur').value);

    function draw() {
        const { ctx, w, h } = fitCanvas(cv);
        ctx.clearRect(0, 0, w, h);
        const padL = 14, padR = 64, padT = 30, padB = 18;
        const o = opts();
        let lo = 0, hi = 1;
        const pts = [];
        for (let i = 0; i <= 200; i++) { const v = M.spring(i / 200, o); pts.push(v); lo = Math.min(lo, v); hi = Math.max(hi, v); }
        hi = Math.max(hi, 1.05);
        const sx = (p) => padL + p * (w - padL - padR);
        const sy = (v) => padT + (hi - v) / (hi - lo) * (h - padT - padB);
        ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(sx(0), sy(1)); ctx.lineTo(sx(1), sy(1)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx(0), sy(0)); ctx.lineTo(sx(1), sy(0)); ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
        ctx.beginPath();
        pts.forEach((v, i) => { const x = sx(i / 200), y = sy(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(sx(0), sy(0), 3, 0, 7); ctx.fill();
        // labels
        ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.font = '10px "HC Text", sans-serif';
        ctx.fillText(S.mode === 'bounce' ? 'Bounce' : 'Overshoot', padL, h - 5);
        const peak = Math.round((hi - 1) * 100);
        ctx.textAlign = 'right';
        ctx.fillText(S.mode === 'bounce' ? `${S.bounces} bounces` : `peak +${peak}%`, w - padR, h - 5);
        ctx.textAlign = 'left';
        // preview object on the right
        const t = anim >= 0 ? Math.min(1, anim) : 1;
        const v = M.spring(t, o);
        const box = 36 * Math.max(0, v);
        const cx = w - padR / 2 + 6, cy = padT + (h - padT - padB) / 2;
        ctx.fillStyle = accent();
        ctx.globalAlpha = 0.9;
        roundRect(ctx, cx - box / 2, cy - box / 2, box, box, 7 * Math.max(0.2, v));
        ctx.fill();
        ctx.globalAlpha = 1;
        if (anim >= 0) {
            ctx.strokeStyle = accent(); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(sx(t), padT - 4); ctx.lineTo(sx(t), h - padB); ctx.stroke();
            ctx.fillStyle = accent(); ctx.beginPath(); ctx.arc(sx(t), sy(v), 4, 0, 7); ctx.fill();
        }
    }
    function roundRect(ctx, x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    function play() {
        cancelAnimationFrame(raf);
        const t0 = performance.now(), dur = 1100;
        const step = (now) => {
            anim = (now - t0) / dur;
            draw();
            if (anim < 1.25) raf = requestAnimationFrame(step); else { anim = -1; draw(); }
        };
        raf = requestAnimationFrame(step);
    }
    $('#bPlay').onclick = play;
    cv.onclick = play;

    $('#bApply').onclick = () => {
        if (target.get() === 'pop') {
            const d = Math.max(2, +$('#bDur').value || 18);
            call('clipMotion', { preset: 'pop', mode: 'in', durIn: d, durOut: d, spring: opts(), curve: [0.16, 1, 0.3, 1] }, {
                button: $('#bApply'), busyText: 'Animating…', success: (r) => `Pop-in added to ${r.done} clip(s)`
            }).catch(() => {});
        } else {
            call('bounceKeys', { spring: opts(), allIfNone: store.get('ease.all', false) }, {
                button: $('#bApply'), busyText: 'Bouncing…', success: (r) => `Bounce applied to ${r.segments} move(s) on ${r.splines} parameter(s)`
            }).catch(() => {});
        }
    };
    syncTarget();
    window.addEventListener('resize', draw);
    requestAnimationFrame(draw);
    setTimeout(draw, 200);
})();
