// HermiteCut — Align
(function () {
    'use strict';
    const { $, store, toast, call, range, hydrateIcons, esc } = window.HC;

    // corner glyphs like a frame viewfinder
    const G = {
        tl: '<path d="M6 14V6h8"/>', t: '<path d="M6 6h12"/>', tr: '<path d="M10 6h8v8"/>',
        l: '<path d="M6 6v12"/>', c: '<circle cx="12" cy="12" r="2.2" fill="currentColor"/>', r: '<path d="M18 6v12"/>',
        bl: '<path d="M6 10v8h8"/>', b: '<path d="M6 18h12"/>', br: '<path d="M10 18h8v-8"/>'
    };
    const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">${d}</svg>`;
    const gridEl = $('#aGrid');
    const names = { tl: 'Top left', t: 'Top', tr: 'Top right', l: 'Left', c: 'Centre', r: 'Right', bl: 'Bottom left', b: 'Bottom', br: 'Bottom right' };
    ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'].forEach(k => {
        const b = document.createElement('button');
        b.innerHTML = svg(G[k]);
        if (k === 'c') b.className = 'c';
        b.dataset.tip = 'Align selected clips: ' + names[k];
        b.onclick = () => call('align', { anchor: k, margin: +$('#aMargin').value }, { success: (r) => `Aligned ${r.done} clip(s) ${names[k].toLowerCase()}` }).catch(() => {});
        gridEl.appendChild(b);
    });

    const mk = (host, list) => list.forEach(([label, tip, fn, icon]) => {
        const b = document.createElement('button');
        b.className = 'btn';
        b.innerHTML = (icon ? svg(icon) : '') + '<span>' + label + '</span>';
        b.dataset.tip = tip;
        b.onclick = fn;
        $(host).appendChild(b);
    });
    const T = (op, value, msg) => () => call('transform', { op, value }, { success: (r) => (msg || op) + ' · ' + r.done + ' clip(s)' }).catch(() => {});
    mk('#aOps', [
        ['Fit', 'Scale to fit the frame', T('fit', null, 'Fit'), '<rect x="4" y="7" width="16" height="10" rx="1"/><rect x="7" y="9" width="10" height="6"/>'],
        ['Fill', 'Scale to fill the frame', T('fill', null, 'Fill'), '<rect x="4" y="7" width="16" height="10" rx="1"/><path d="M2 5h20v14H2z" opacity=".5"/>'],
        ['Reset', 'Reset transform & crop', T('reset', null, 'Reset'), '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'],
        ['Flip H', 'Flip horizontally', T('flipH', null, 'Flipped H'), '<path d="M12 3v18"/><path d="M8 7L3 12l5 5zM16 7l5 5-5 5z"/>'],
        ['Flip V', 'Flip vertically', T('flipV', null, 'Flipped V'), '<path d="M3 12h18"/><path d="M7 8l5-5 5 5zM7 16l5 5 5-5z"/>']
    ]);
    mk('#aOps2', [
        ['−10%', 'Scale down 10%', T('scale', 0.9, 'Scaled'), ''],
        ['+10%', 'Scale up 10%', T('scale', 1.1, 'Scaled'), ''],
        ['⟲ 90°', 'Rotate −90°', T('rotate', -90, 'Rotated'), ''],
        ['⟳ 90°', 'Rotate +90°', T('rotate', 90, 'Rotated'), '']
    ]);
    mk('#aOpacity', [
        ['100%', 'Opacity 100%', T('opacity', 100, 'Opacity 100%'), ''],
        ['75%', 'Opacity 75%', T('opacity', 75, 'Opacity 75%'), ''],
        ['50%', 'Opacity 50%', T('opacity', 50, 'Opacity 50%'), ''],
        ['25%', 'Opacity 25%', T('opacity', 25, 'Opacity 25%'), '']
    ]);
    $('#aBlendGo').onclick = () => call('transform', { op: 'composite', value: $('#aBlend').value }, { success: (r) => 'Blend mode set on ' + r.done + ' clip(s)' }).catch(() => {});

    range($('#aMargin'), $('#aMarginV'), v => v + '%');
    range($('#aGap'), $('#aGapV'), v => v + '%');

    // layouts
    const L = {
        split2v: ['Split 2 (side by side)', '<rect x="1" y="1" width="13" height="16" rx="1.5"/><rect x="16" y="1" width="13" height="16" rx="1.5"/>'],
        split2h: ['Split 2 (stacked)', '<rect x="1" y="1" width="28" height="7" rx="1.5"/><rect x="1" y="10" width="28" height="7" rx="1.5"/>'],
        split3: ['3 columns', '<rect x="1" y="1" width="8.3" height="16" rx="1.5"/><rect x="10.8" y="1" width="8.3" height="16" rx="1.5"/><rect x="20.6" y="1" width="8.3" height="16" rx="1.5"/>'],
        grid4: ['2 × 2 grid', '<rect x="1" y="1" width="13" height="7" rx="1.5"/><rect x="16" y="1" width="13" height="7" rx="1.5"/><rect x="1" y="10" width="13" height="7" rx="1.5"/><rect x="16" y="10" width="13" height="7" rx="1.5"/>'],
        pipTL: ['Picture-in-picture top left', '<rect x="1" y="1" width="28" height="16" rx="1.5" opacity=".35"/><rect x="2.5" y="2.5" width="9" height="5.5" rx="1"/>'],
        pipTR: ['Picture-in-picture top right', '<rect x="1" y="1" width="28" height="16" rx="1.5" opacity=".35"/><rect x="18.5" y="2.5" width="9" height="5.5" rx="1"/>'],
        pipBL: ['Picture-in-picture bottom left', '<rect x="1" y="1" width="28" height="16" rx="1.5" opacity=".35"/><rect x="2.5" y="10" width="9" height="5.5" rx="1"/>'],
        pipBR: ['Picture-in-picture bottom right', '<rect x="1" y="1" width="28" height="16" rx="1.5" opacity=".35"/><rect x="18.5" y="10" width="9" height="5.5" rx="1"/>']
    };
    Object.keys(L).forEach(k => {
        const b = document.createElement('button');
        b.dataset.tip = L[k][0] + ' — selected clips, top track first';
        b.innerHTML = `<svg viewBox="0 0 30 18" fill="rgba(185,172,255,.18)" stroke="currentColor" stroke-width="1" style="color:var(--muted)">${L[k][1]}</svg>`;
        b.onclick = () => call('layout', { kind: k, gap: +$('#aGap').value }, {
            success: (r) => r.used < r.needed ? `Placed ${r.used} of ${r.needed} — select ${r.needed} clips on stacked tracks` : `Layout applied to ${r.done} clip(s)`
        }).catch(() => {});
        $('#aLayouts').appendChild(b);
    });

    // transform clipboard
    let clip = store.get('align.clip', null);
    const saveBtn = $('#aSave');
    const renderSaved = () => {
        const list = store.get('align.saved', []);
        const host = $('#aSaved');
        host.innerHTML = list.length ? '' : '<span class="hint">Copy a clip\'s transform, then save it here.</span>';
        list.forEach((p, i) => {
            const c = document.createElement('span');
            c.className = 'chip';
            c.innerHTML = '<span>' + esc(p.n) + '</span><span class="x" data-tip="Delete">✕</span>';
            c.dataset.tip = 'Apply to selected clips';
            c.onclick = (e) => {
                if (e.target.classList.contains('x')) {
                    const l = store.get('align.saved', []); l.splice(i, 1); store.set('align.saved', l); renderSaved(); return;
                }
                call('pasteTransform', { props: p.props }, { success: (r) => `“${p.n}” applied to ${r.done} clip(s)` }).catch(() => {});
            };
            host.appendChild(c);
        });
        saveBtn.disabled = !clip;
    };
    $('#aCopy').onclick = async () => {
        try {
            const r = await call('copyTransform', {}, { success: (r) => 'Copied transform from “' + r.name + '”' });
            clip = r; store.set('align.clip', r); renderSaved();
        } catch (e) { /* */ }
    };
    $('#aPaste').onclick = () => {
        if (!clip) return toast('Copy a transform first', 'err');
        call('pasteTransform', { props: clip.props }, { success: (r) => 'Pasted to ' + r.done + ' clip(s)' }).catch(() => {});
    };
    saveBtn.onclick = () => {
        if (!clip) return;
        const list = store.get('align.saved', []);
        list.push({ n: (clip.name || 'Transform').slice(0, 18) + ' ' + (list.length + 1), props: clip.props });
        store.set('align.saved', list); renderSaved(); toast('Transform saved', 'info');
    };
    renderSaved();
    hydrateIcons($('[data-mod="align"]'));
})();
