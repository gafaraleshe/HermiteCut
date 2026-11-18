// HermiteCut — Motion
(function () {
    'use strict';
    const { $, store, call, seg, range, shared } = window.HC;
    const M = window.HCMath;
    const s = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    // id, label, icon, amount label, default amount
    const PRESETS = [
        ['grow', 'Grow', '<rect x="8" y="8" width="8" height="8" rx="1"/><path d="M4 9V4h5M20 15v5h-5"/>', 'Scale change', 20],
        ['shrink', 'Shrink', '<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M9 9h6v6H9z"/>', 'Scale change', 20],
        ['slideLeft', 'Slide ←', '<path d="M20 12H5M10 7l-5 5 5 5"/>', 'Distance (% of frame)', 100],
        ['slideRight', 'Slide →', '<path d="M4 12h15M14 7l5 5-5 5"/>', 'Distance (% of frame)', 100],
        ['slideUp', 'Slide ↑', '<path d="M12 20V5M7 10l5-5 5 5"/>', 'Distance (% of frame)', 100],
        ['slideDown', 'Slide ↓', '<path d="M12 4v15M7 14l5 5 5-5"/>', 'Distance (% of frame)', 100],
        ['whip', 'Whip', '<path d="M3 9h12M6 12h14M3 15h12"/>', 'Distance', 100],
        ['spin', 'Spin', '<path d="M20 12a8 8 0 1 1-3-6.2"/><path d="M20 4v5h-5"/>', 'Rotation (% of a turn)', 25],
        ['pop', 'Pop', '<circle cx="12" cy="12" r="6"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>', '— uses Bounce spring', 0],
        ['punch', 'Punch', '<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M9 10l-2-2M15 10l2-2M9 14l-2 2M15 14l2 2"/>', 'Zoom amount', 15],
        ['kenburns', 'Ken Burns', '<rect x="3" y="6" width="18" height="12" rx="1"/><rect x="9" y="9" width="9" height="6" rx="1"/>', 'Zoom over clip', 12],
        ['shake', 'Shake', '<path d="M4 12l3-4 3 8 3-8 3 8 3-4"/>', 'Intensity', 20]
    ];
    let preset = store.get('m.preset', 'grow');
    const grid = $('#mPresets');
    PRESETS.forEach(p => {
        const b = document.createElement('button');
        b.innerHTML = s(p[2]) + '<span>' + p[1] + '</span>';
        b.dataset.v = p[0];
        b.onclick = () => { preset = p[0]; store.set('m.preset', preset); sync(true); };
        grid.appendChild(b);
    });
    const dir = seg($('#mDir'), (v) => store.set('m.dir', v), store.get('m.dir', 'in'));
    ['#mIn', '#mOut'].forEach(id => { const v = store.get(id, null); if (v) $(id).value = v; $(id).onchange = () => store.set(id, $(id).value); });
    $('#mBlur').checked = store.get('m.blur', false); $('#mBlur').onchange = () => store.set('m.blur', $('#mBlur').checked);
    $('#mUseEase').checked = store.get('m.useEase', true); $('#mUseEase').onchange = () => { store.set('m.useEase', $('#mUseEase').checked); drawCurve(); };

    const amt = $('#mAmt');
    const paint = range(amt, $('#mAmtV'), v => preset === 'pop' ? '—' : v + '%', (v) => store.set('m.amt.' + preset, v));
    function sync(resetAmt) {
        [...grid.children].forEach(b => b.classList.toggle('on', b.dataset.v === preset));
        const p = PRESETS.find(x => x[0] === preset) || PRESETS[0];
        $('#mAmtL').textContent = p[3];
        amt.disabled = preset === 'pop';
        amt.value = store.get('m.amt.' + preset, p[4]);
        paint();
        void resetAmt;
    }
    const DEFAULT_CURVE = [0.16, 1, 0.3, 1];
    function curve() { return $('#mUseEase').checked ? shared.curve : DEFAULT_CURVE; }
    function drawCurve() {
        const c = curve();
        $('#mCurveSvg').innerHTML = `<path d="${M.curvePath(c, 1, 1, 0)}" transform="translate(0,0)" fill="none" stroke="currentColor" stroke-width="0.12" vector-effect="non-scaling-stroke" style="stroke-width:1.8px;color:var(--accent)"/>`;
        $('#mCurveName').textContent = $('#mUseEase').checked ? 'Ease: ' + shared.curveName : 'Expo Out (default)';
    }
    shared.curveListeners.push(drawCurve);

    $('#mApply').onclick = () => {
        const sp = window.HC.bounceSpring ? window.HC.bounceSpring() : undefined;
        call('clipMotion', {
            preset, mode: dir.get(), durIn: +$('#mIn').value, durOut: +$('#mOut').value,
            amount: +amt.value, curve: curve(), blur: $('#mBlur').checked, spring: sp
        }, {
            button: $('#mApply'), busyText: 'Animating…',
            success: (r) => `Animated ${r.done} clip(s)` + (r.errors && r.errors.length ? ` · ${r.errors.length} skipped` : '')
        }).catch(() => {});
    };
    $('#mRemove').onclick = () => call('removeMotion', {}, { success: (r) => `Removed motion from ${r.removed} clip(s)` }).catch(() => {});
    const fr = () => Math.max(1, +$('#mIn').value || 12);
    $('#mFadeIn').onclick = () => call('fades', { fadeIn: fr() }, { success: (r) => 'Fade in on ' + r.done + ' clip(s)' }).catch(() => {});
    $('#mFadeOut').onclick = () => call('fades', { fadeOut: Math.max(1, +$('#mOut').value || 12) }, { success: (r) => 'Fade out on ' + r.done + ' clip(s)' }).catch(() => {});
    $('#mFadeOff').onclick = () => call('fades', { fadeIn: 0, fadeOut: 0 }, { success: (r) => 'Fades removed on ' + r.done + ' clip(s)' }).catch(() => {});

    sync(); drawCurve();
})();
