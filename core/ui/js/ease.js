// HermiteCut — Ease
(function () {
    'use strict';
    const { $, store, toast, call, fitCanvas, accent, shared } = window.HC;
    const M = window.HCMath;
    const cv = $('#eGraph');
    let curve = shared.curve.slice();
    let name = shared.curveName;
    let drag = -1;
    let geo = null;

    const fmt = (n) => (Math.round(n * 100) / 100).toFixed(2);

    function view() {
        const { w, h } = fitCanvas(cv);
        const yMin = Math.min(-0.15, curve[1] - 0.1, curve[3] - 0.1);
        const yMax = Math.max(1.15, curve[1] + 0.1, curve[3] + 0.1);
        const padX = 26, padTop = 30, padBot = 16;
        const sx = (x) => padX + x * (w - padX * 2);
        const sy = (y) => padTop + (yMax - y) / (yMax - yMin) * (h - padTop - padBot);
        const ix = (px) => (px - padX) / (w - padX * 2);
        const iy = (py) => yMax - (py - padTop) / (h - padTop - padBot) * (yMax - yMin);
        return { w, h, sx, sy, ix, iy };
    }

    function draw() {
        const { ctx } = fitCanvas(cv);
        geo = view();
        const { w, h, sx, sy } = geo;
        ctx.clearRect(0, 0, w, h);
        // grid
        ctx.strokeStyle = 'rgba(255,255,255,.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const x = sx(i / 4), y = sy(i / 4);
            ctx.beginPath(); ctx.moveTo(x, sy(0)); ctx.lineTo(x, sy(1)); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(sx(0), y); ctx.lineTo(sx(1), y); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(255,255,255,.12)';
        ctx.strokeRect(sx(0), sy(1), sx(1) - sx(0), sy(0) - sy(1));
        ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(sx(0), sy(0)); ctx.lineTo(sx(1), sy(1)); ctx.stroke();
        ctx.setLineDash([]);
        // handles
        const hc = '#f5c04a';
        ctx.strokeStyle = 'rgba(245,192,74,.65)'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(sx(0), sy(0)); ctx.lineTo(sx(curve[0]), sy(curve[1])); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(sx(1), sy(1)); ctx.lineTo(sx(curve[2]), sy(curve[3])); ctx.stroke();
        // curve
        const grad = ctx.createLinearGradient(sx(0), 0, sx(1), 0);
        grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, accent());
        ctx.strokeStyle = grad; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx(0), sy(0));
        ctx.bezierCurveTo(sx(curve[0]), sy(curve[1]), sx(curve[2]), sy(curve[3]), sx(1), sy(1));
        ctx.stroke();
        // end points
        ctx.fillStyle = '#fff';
        [[0, 0], [1, 1]].forEach(([x, y]) => { ctx.beginPath(); ctx.arc(sx(x), sy(y), 3.2, 0, 7); ctx.fill(); });
        // handle knobs
        [[curve[0], curve[1]], [curve[2], curve[3]]].forEach(([x, y], i) => {
            ctx.beginPath(); ctx.arc(sx(x), sy(y), drag === i ? 7 : 5.5, 0, 7);
            ctx.fillStyle = hc; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
        });
        const ec = $('#eCode'); if (ec) ec.textContent = curve.map(fmt).join(', ');
        $('#eName').textContent = name;
    }

    function commit(newName) {
        if (newName !== undefined) name = newName;
        shared.setCurve(curve.slice(), name);
        markPreset();
        draw();
    }

    cv.addEventListener('mousedown', (e) => {
        if (!geo) return;
        const r = cv.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        const d = (x, y) => Math.hypot(geo.sx(x) - px, geo.sy(y) - py);
        const d1 = d(curve[0], curve[1]), d2 = d(curve[2], curve[3]);
        drag = d1 <= d2 ? 0 : 1;
        if (Math.min(d1, d2) > 40) drag = px < (geo.sx(0) + geo.sx(1)) / 2 ? 0 : 1;
        move(e);
    });
    function move(e) {
        if (drag < 0 || !geo) return;
        const r = cv.getBoundingClientRect();
        let x = geo.ix(e.clientX - r.left), y = geo.iy(e.clientY - r.top);
        x = Math.max(0, Math.min(1, x));
        y = Math.max(-1, Math.min(2, y));
        if (e.shiftKey) { x = Math.round(x * 20) / 20; y = Math.round(y * 20) / 20; }
        curve[drag * 2] = +x.toFixed(3);
        curve[drag * 2 + 1] = +y.toFixed(3);
        name = 'Custom';
        draw();
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', () => { if (drag >= 0) { drag = -1; commit(); } });

    // ---- presets
    const grid = $('#ePresets');
    function iconSvg(c) {
        return `<svg viewBox="0 0 30 30"><path d="${M.curvePath(c, 30, 30, 0.18)}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
    }
    function allPresets() {
        return M.PRESETS.map(([n, c]) => ({ n, c, user: false }))
            .concat(store.get('ease.user', []).map(p => ({ n: p.n, c: p.c, user: true })));
    }
    function buildPresets() {
        grid.innerHTML = '';
        allPresets().forEach(p => {
            const b = document.createElement('button');
            b.innerHTML = iconSvg(p.c);
            b.dataset.tip = p.n + (p.user ? '  (right-click to delete)' : '');
            b.dataset.c = p.c.join(',');
            if (p.user) b.classList.add('user');
            b.onclick = () => { curve = p.c.slice(); commit(p.n); };
            b.oncontextmenu = (e) => {
                e.preventDefault();
                if (!p.user) return;
                store.set('ease.user', store.get('ease.user', []).filter(u => u.n !== p.n));
                buildPresets(); toast('Deleted preset “' + p.n + '”', 'info');
            };
            grid.appendChild(b);
        });
        markPreset();
    }
    function markPreset() {
        const key = curve.join(',');
        [...grid.children].forEach(b => b.classList.toggle('on', b.dataset.c === key));
    }

    $('#eSave').onclick = () => {
        const user = store.get('ease.user', []);
        const n = 'My curve ' + (user.length + 1);
        user.push({ n, c: curve.slice() });
        store.set('ease.user', user);
        name = n; commit();
        buildPresets();
        toast('Saved as “' + n + '”');
    };
    $('#eReset').onclick = () => { curve = [0.25, 0.1, 0.25, 1]; commit('Ease'); };
    $('#eFlip').onclick = () => { curve = [1 - curve[2], 1 - curve[3], 1 - curve[0], 1 - curve[1]].map(v => +v.toFixed(3)); commit('Custom'); };
    $('#eCopy').onclick = async () => {
        const s = 'cubic-bezier(' + curve.map(fmt).join(', ') + ')';
        try { await navigator.clipboard.writeText(s); toast('Copied ' + s, 'info'); } catch (e) { toast(s, 'info'); }
    };
    $('#eCode').onclick = () => {
        const el = $('#eCode');
        const inp = document.createElement('input');
        inp.type = 'text'; inp.className = 'code-input'; inp.value = curve.map(fmt).join(', ');
        el.replaceWith(inp); inp.focus(); inp.select();
        const done = (ok) => {
            if (ok) {
                const n = (inp.value.match(/-?\d*\.?\d+/g) || []).map(Number);
                if (n.length === 4) { curve = [Math.max(0, Math.min(1, n[0])), n[1], Math.max(0, Math.min(1, n[2])), n[3]]; name = 'Custom'; }
                else toast('Type four numbers, e.g. 0.16, 1, 0.3, 1', 'err');
            }
            inp.replaceWith(el); commit();
        };
        inp.onkeydown = (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
        inp.onblur = () => done(true);
    };

    $('#eAll').checked = store.get('ease.all', false);
    $('#eAll').onchange = () => store.set('ease.all', $('#eAll').checked);

    $('#eApply').onclick = () => call('easeKeys', { curve, allIfNone: $('#eAll').checked }, {
        button: $('#eApply'), busyText: 'Easing…',
        success: (r) => `Eased ${r.segments} segment(s) on ${r.splines} animated parameter(s)`
    }).catch(() => {});

    buildPresets();
    window.addEventListener('resize', draw);
    requestAnimationFrame(draw);
    setTimeout(draw, 200);
})();
