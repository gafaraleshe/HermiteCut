// HermiteCut — settings
(function () {
    'use strict';
    const { $, $$, store, toast } = window.HC;
    const ACCENTS = [
        ['Lavender', '#b9acff', '185,172,255'], ['Teal', '#49c9bd', '73,201,189'], ['Resolve Orange', '#ff8a3d', '255,138,61'],
        ['Blue', '#5aa2ff', '90,162,255'], ['Rose', '#ff7aa8', '255,122,168'], ['Lime', '#b6e35a', '182,227,90'], ['Gold', '#f5c04a', '245,192,74'], ['Ice', '#d8e6ff', '216,230,255']
    ];
    function applyAccent(i) {
        const a = ACCENTS[i] || ACCENTS[0];
        document.documentElement.style.setProperty('--accent', a[1]);
        document.documentElement.style.setProperty('--accent-rgb', a[2]);
        $$('#sSwatches button').forEach((b, k) => b.classList.toggle('on', k === i));
        window.dispatchEvent(new Event('resize'));
    }
    ACCENTS.forEach((a, i) => {
        const b = document.createElement('button');
        b.style.background = a[1]; b.dataset.tip = a[0];
        b.onclick = () => { store.set('accent', i); applyAccent(i); };
        $('#sSwatches').appendChild(b);
    });
    applyAccent(store.get('accent', 0));

    const glow = $('#sGlow'), compact = $('#sCompact'), pinDef = $('#sPinDefault');
    glow.checked = store.get('glow', true); compact.checked = store.get('compact', false); pinDef.checked = store.get('pin', true);
    const applyLook = () => { document.body.classList.toggle('no-glow', !glow.checked); document.body.classList.toggle('compact', compact.checked); window.dispatchEvent(new Event('resize')); };
    glow.onchange = () => { store.set('glow', glow.checked); applyLook(); };
    compact.onchange = () => { store.set('compact', compact.checked); applyLook(); };
    pinDef.onchange = async () => { store.set('pin', pinDef.checked); const v = await window.hermite.win('pin', pinDef.checked); $('#btnPin').classList.toggle('on', !!v); };
    applyLook();

    const MODS = [['ease', 'Ease'], ['align', 'Align'], ['quick', 'Actions'], ['motion', 'Motion'], ['bounce', 'Bounce'], ['beats', 'Beats'], ['captions', 'Captions']];
    const host = $('#sMods');
    const cur = () => store.get('mainSet', ['ease', 'align', 'quick']);
    MODS.forEach(([k, n]) => {
        const l = document.createElement('label'); l.className = 'check';
        l.innerHTML = `<input type="checkbox" value="${k}"> ${n}`;
        const cb = l.firstChild;
        cb.checked = cur().includes(k);
        cb.onchange = () => {
            const set = $$('input', host).filter(i => i.checked).map(i => i.value);
            store.set('mainSet', set.length ? set : ['ease']);
            if (store.get('set', 'main') === 'main') window.HC.applySet('main');
        };
        host.appendChild(l);
    });

    const modal = $('#settings');
    $('#btnSettings').onclick = () => modal.classList.add('open');
    $('#sClose').onclick = () => modal.classList.remove('open');
    modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('open'); };
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.classList.remove('open'); });
    $('#sLog').onclick = () => window.hermite.win('openLog');
    $('#sReset').onclick = () => { store.clear(); toast('Settings reset — reopening', 'info'); setTimeout(() => location.reload(), 600); };
})();
