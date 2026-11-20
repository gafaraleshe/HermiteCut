// HermiteCut — app shell: command palette, keyboard shortcuts, updates,
// about, diagnostics and the first-run welcome.
(function () {
    'use strict';
    const { $, $$, store, toast, poll, hydrateIcons } = window.HC;
    const hasApp = !!(window.hermite && window.hermite.app);
    const appCall = async (cmd, val) => {
        if (!hasApp) throw new Error('Not available in this build.');
        const r = await window.hermite.app(cmd, val);
        if (!r || !r.ok) throw new Error((r && r.error) || 'Unknown error');
        return r.result;
    };

    let INFO = { version: '', platform: navigator.platform.toLowerCase().includes('mac') ? 'darwin' : 'win32', mode: 'app', helpUrl: 'https://cut.hermitelabs.com/#faq', notesUrl: 'https://cut.hermitelabs.com/changelog' };
    const isMac = () => INFO.platform === 'darwin';
    const MOD = () => (isMac() ? '⌘' : 'Ctrl');
    const open = (url) => window.hermite.win('openExternal', url);

    // ---------- sheets
    const sheets = ['#settings', '#sheetShortcuts', '#sheetAbout', '#sheetWelcome'];
    let lastFocus = null;
    function showSheet(sel) {
        closeAll();
        lastFocus = document.activeElement;
        const m = $(sel);
        m.classList.add('open');
        const f = m.querySelector('button.cta, button:not([data-close]), input, [data-close]');
        if (f) setTimeout(() => f.focus(), 30);
    }
    function closeAll() {
        sheets.forEach(s => $(s) && $(s).classList.remove('open'));
        closePalette(true);
    }
    $$('[data-close]').forEach(b => b.addEventListener('click', closeAll));
    sheets.slice(1).forEach(s => $(s).addEventListener('click', (e) => { if (e.target === $(s)) closeAll(); }));
    const anyOpen = () => sheets.some(s => $(s).classList.contains('open')) || !$('#palette').hidden;

    // ---------- updates
    function showUpdate(u) {
        $('#updateText').textContent = 'HermiteCut ' + u.latest + ' is available' + (u.summary && u.summary[0] ? ': ' + u.summary[0] : '.');
        $('#updateNotes').onclick = () => open(u.notesUrl);
        $('#updateGet').onclick = () => open(u.downloadUrl);
        $('#updateClose').onclick = () => { $('#updateBar').hidden = true; store.set('updates.dismissed', u.latest); };
        $('#updateBar').hidden = false;
        window.dispatchEvent(new Event('resize'));
    }
    async function checkUpdate(manual) {
        try {
            const u = await appCall('checkUpdate');
            store.set('updates.last', Date.now());
            store.set('updates.info', u.available ? u : null);
            if (u.available) {
                if (manual || store.get('updates.dismissed', '') !== u.latest) showUpdate(u);
                if (manual) toast('HermiteCut ' + u.latest + ' is available', 'info');
            } else if (manual) {
                toast('You’re up to date (HermiteCut ' + u.current + ')');
            }
        } catch (e) {
            if (manual) toast(e.message, 'err');
        }
    }

    // ---------- diagnostics
    async function copyDiagnostics() {
        try { await appCall('copyDiagnostics'); toast('Diagnostics copied: paste them into your support email'); } catch (e) { toast(e.message, 'err'); }
    }
    async function saveDiagnostics() {
        try { const f = await appCall('saveDiagnostics'); if (f) toast('Diagnostics saved'); } catch (e) { toast(e.message, 'err'); }
    }

    // ---------- going to a tool
    function goToTool(card) {
        const cur = store.get('set', 'main');
        if (card.classList.contains('hidden')) {
            const sets = card.dataset.sets.split(',');
            window.HC.applySet(sets.includes(cur) ? cur : sets.find(s => s !== 'all') || 'all');
        }
        setTimeout(() => {
            card.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
            card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash');
            const f = card.querySelector('input, button.cta, button');
            if (f) f.focus({ preventScroll: true });
        }, 60);
    }

    // ---------- commands
    function commands() {
        const list = [];
        $$('#sets button').forEach((b, i) => list.push({ name: 'Show ' + b.textContent.trim(), group: 'View', keys: i < 9 ? [MOD(), String(i + 1)] : null, run: () => b.click() }));
        $$('.card[data-mod]').forEach(c => {
            const h = c.querySelector('h2');
            if (h) list.push({ name: 'Go to ' + h.textContent.trim(), group: 'Tools', run: () => goToTool(c) });
        });
        (window.HC.actions || []).forEach(a => list.push({ name: a.name, group: 'Action · ' + a.group, run: a.run }));
        list.push(
            { name: 'Settings', group: 'HermiteCut', keys: [MOD(), ','], run: () => showSheet('#settings') },
            { name: 'Keyboard shortcuts', group: 'HermiteCut', keys: [MOD(), '/'], run: () => showSheet('#sheetShortcuts') },
            { name: 'Check for updates', group: 'HermiteCut', run: () => checkUpdate(true) },
            { name: 'What’s new', group: 'HermiteCut', run: () => open(INFO.notesUrl) },
            { name: 'Help and FAQ', group: 'HermiteCut', run: () => open(INFO.helpUrl) },
            { name: 'About HermiteCut', group: 'HermiteCut', run: () => showSheet('#sheetAbout') },
            { name: 'Refresh the connection to Resolve', group: 'HermiteCut', keys: [MOD(), 'R'], run: () => { poll(); toast('Refreshed', 'info'); } },
            { name: 'Keep on top of Resolve: on / off', group: 'HermiteCut', run: () => $('#btnPin').click() },
            { name: 'Copy diagnostics for support', group: 'Support', run: copyDiagnostics },
            { name: 'Save diagnostics to a file', group: 'Support', run: saveDiagnostics },
            { name: 'Open the log file', group: 'Support', run: () => window.hermite.win('openLog') },
            { name: 'Show the welcome screen', group: 'HermiteCut', run: () => showSheet('#sheetWelcome') }
        );
        if ($('#licGate')) list.push({ name: 'Licence', group: 'HermiteCut', run: () => window.HC.applySet('setup') });
        return list;
    }

    // ---------- command palette
    // Fuzzy match: every typed character in order; earlier and word-start
    // matches score higher.
    function score(text, q) {
        if (!q) return 1;
        const t = text.toLowerCase();
        const i = t.indexOf(q);
        if (i >= 0) return 1000 - i * 2 - (i > 0 && t[i - 1] !== ' ' ? 50 : 0);
        let ti = 0, s = 0, last = -2;
        for (const ch of q) {
            const k = t.indexOf(ch, ti);
            if (k < 0) return 0;
            s += (k === last + 1 ? 8 : 1) + (k === 0 || t[k - 1] === ' ' ? 6 : 0);
            last = k; ti = k + 1;
        }
        return s;
    }

    let all = [], shown = [], sel = 0;
    const recent = () => store.get('palette.recent', []);
    function renderPalette() {
        const q = $('#palInput').value.trim().toLowerCase();
        const rec = recent();
        if (!q) {
            const r = rec.map(n => all.find(c => c.name === n)).filter(Boolean);
            shown = r.concat(all.filter(c => !rec.includes(c.name) && !c.group.startsWith('Action'))).slice(0, 60);
        } else {
            shown = all.map(c => ({ c, s: score(c.name + ' ' + c.group, q) + (score(c.name, q) ? 200 : 0) }))
                .filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 60).map(x => x.c);
        }
        sel = Math.min(sel, Math.max(0, shown.length - 1));
        const list = $('#palList');
        list.innerHTML = '';
        if (!shown.length) { list.innerHTML = '<div class="palette-empty">Nothing matches. Try another word.</div>'; return; }
        shown.forEach((c, i) => {
            const row = document.createElement('div');
            row.className = 'palette-item' + (i === sel ? ' on' : '');
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', String(i === sel));
            row.id = 'pal-' + i;
            const name = document.createElement('span'); name.className = 'nm'; name.textContent = c.name;
            const grp = document.createElement('span'); grp.className = 'grp'; grp.textContent = !q && rec.includes(c.name) ? 'Recent' : c.group;
            row.append(name, grp);
            if (c.keys) { const k = document.createElement('span'); k.className = 'keys-inline'; c.keys.forEach(x => { const e = document.createElement('kbd'); e.textContent = x; k.appendChild(e); }); row.appendChild(k); }
            row.addEventListener('mousemove', () => { if (sel !== i) { sel = i; mark(); } });
            row.addEventListener('click', () => runSel(i));
            list.appendChild(row);
        });
        $('#palInput').setAttribute('aria-activedescendant', 'pal-' + sel);
    }
    function mark() {
        $$('.palette-item').forEach((r, i) => { r.classList.toggle('on', i === sel); r.setAttribute('aria-selected', String(i === sel)); });
        const r = $('#pal-' + sel); if (r) r.scrollIntoView({ block: 'nearest' });
        $('#palInput').setAttribute('aria-activedescendant', 'pal-' + sel);
    }
    function runSel(i) {
        const c = shown[i];
        if (!c) return;
        store.set('palette.recent', [c.name].concat(recent().filter(n => n !== c.name)).slice(0, 6));
        closePalette();
        setTimeout(() => c.run(), 0);
    }
    function openPalette() {
        if (!$('#licGate') || $('#licGate').hidden) {
            sheets.forEach(s => $(s).classList.remove('open'));
        }
        lastFocus = document.activeElement;
        all = commands(); sel = 0;
        $('#palInput').value = '';
        $('#palette').hidden = false;
        renderPalette();
        $('#palInput').focus();
    }
    function closePalette(silent) {
        if ($('#palette').hidden) return;
        $('#palette').hidden = true;
        if (!silent && lastFocus && lastFocus.focus) lastFocus.focus();
    }
    $('#palInput').addEventListener('input', () => { sel = 0; renderPalette(); });
    $('#palInput').addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); mark(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
        else if (e.key === 'PageDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 8); mark(); }
        else if (e.key === 'PageUp') { e.preventDefault(); sel = Math.max(0, sel - 8); mark(); }
        else if (e.key === 'Enter') { e.preventDefault(); runSel(sel); }
        else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
        else if (e.key === 'Tab') { e.preventDefault(); }
    });
    $('#palette').addEventListener('mousedown', (e) => { if (e.target === $('#palette')) closePalette(); });
    $('#btnPalette').addEventListener('click', openPalette);

    // ---------- keyboard shortcuts
    function shortcutList() {
        const m = MOD();
        return [
            [[m, 'K'], 'Search tools, actions and settings'],
            [[m, ','], 'Settings'],
            [[m, '1'], 'Main tools'],
            [[m, '2 … 8'], 'Motion, Beats & Captions, FX, Sound, Shorts, Setup, All'],
            [[m, 'R'], 'Refresh the connection to Resolve'],
            [[m, '/'], 'This list'],
            [['Esc'], 'Close a window or the search'],
            [['Right-click'], 'Add an action to ★ Favourites']
        ];
    }
    function renderKeys() {
        const host = $('#keyList');
        host.innerHTML = '';
        shortcutList().forEach(([keys, what]) => {
            const row = document.createElement('div'); row.className = 'key-row';
            const k = document.createElement('span'); k.className = 'keys-inline';
            keys.forEach(x => { const e = document.createElement('kbd'); e.textContent = x; k.appendChild(e); });
            const t = document.createElement('span'); t.textContent = what;
            row.append(t, k); host.appendChild(row);
        });
    }

    const typing = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
    // In the macOS app these keys belong to the menu bar (app/shell.js).
    const menuOwns = () => isMac() && INFO.mode === 'app';
    document.addEventListener('keydown', (e) => {
        const mod = isMac() ? e.metaKey : e.ctrlKey;
        const k = e.key.toLowerCase();
        if (mod && !e.altKey && !e.shiftKey) {
            if (k === 'k' && !menuOwns()) { e.preventDefault(); $('#palette').hidden ? openPalette() : closePalette(); return; }
            if (k === ',' && !menuOwns()) { e.preventDefault(); showSheet('#settings'); return; }
            if (k === '/' && !menuOwns()) { e.preventDefault(); showSheet('#sheetShortcuts'); return; }
            if (k === 'r' && !menuOwns()) { e.preventDefault(); poll(); toast('Refreshed', 'info'); return; }
            if (/^[1-9]$/.test(k) && !anyOpen()) {
                const b = $$('#sets button')[+k - 1];
                if (b) { e.preventDefault(); b.click(); }
                return;
            }
        }
        if (e.key === 'Escape' && anyOpen()) { closeAll(); if (lastFocus && lastFocus.focus) lastFocus.focus(); return; }
        if (e.key === '?' && !typing(e.target) && !anyOpen()) { e.preventDefault(); showSheet('#sheetShortcuts'); }
    });

    // Menu bar commands (macOS app).
    if (window.hermite.onCommand) {
        window.hermite.onCommand((cmd) => {
            switch (cmd) {
                case 'palette': $('#palette').hidden ? openPalette() : closePalette(); break;
                case 'settings': showSheet('#settings'); break;
                case 'shortcuts': showSheet('#sheetShortcuts'); break;
                case 'about': showSheet('#sheetAbout'); break;
                case 'checkUpdate': checkUpdate(true); break;
                case 'whatsNew': open(INFO.notesUrl); break;
                case 'help': open(INFO.helpUrl); break;
                case 'diagnostics': copyDiagnostics(); break;
                case 'refresh': poll(); toast('Refreshed', 'info'); break;
            }
        });
    }

    // ---------- settings and about wiring
    const auto = $('#sAutoUpdate');
    auto.checked = store.get('updates.auto', true);
    auto.onchange = () => store.set('updates.auto', auto.checked);
    $('#sCheckUpdate').onclick = () => checkUpdate(true);
    $('#sShortcuts').onclick = () => showSheet('#sheetShortcuts');
    $('#sDiag').onclick = copyDiagnostics;
    $('#sDiagSave').onclick = saveDiagnostics;
    $('#abNotes').onclick = () => open(INFO.notesUrl);
    $('#abHelp').onclick = () => open(INFO.helpUrl);
    $('#abUpdate').onclick = () => checkUpdate(true);
    $('#wGo').onclick = () => { store.set('welcomed', true); closeAll(); };
    $('#wSetup').onclick = () => { store.set('welcomed', true); closeAll(); window.HC.applySet('setup'); };
    // Settings opened from the gear keeps working; route it through showSheet
    // so Escape and focus behave the same everywhere.
    $('#btnSettings').onclick = () => showSheet('#settings');

    async function init() {
        try { INFO = Object.assign(INFO, await appCall('info')); } catch (e) { /* older main process */ }
        if (INFO.version) {
            $('#aboutVersion').textContent = 'HermiteCut ' + INFO.version;
            $('#abVersion').textContent = 'Version ' + INFO.version + (INFO.mode === 'panel' ? ' · Resolve panel' : '');
        }
        $$('kbd[data-mod]').forEach(k => { k.textContent = MOD(); });
        $('#btnPalette').dataset.tip = 'Search tools and actions (' + MOD() + '+K)';
        renderKeys();
        hydrateIcons(document);
        if (!store.get('welcomed', false)) showSheet('#sheetWelcome');
        const known = store.get('updates.info', null);
        if (known && known.current === INFO.version && store.get('updates.dismissed', '') !== known.latest) showUpdate(known);
        const last = store.get('updates.last', 0);
        if (hasApp && store.get('updates.auto', true) && Date.now() - last > 12 * 3600 * 1000) setTimeout(() => checkUpdate(false), 4000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

    window.HC.palette = { open: openPalette, close: closePalette };
    window.HC.checkUpdate = checkUpdate;
})();
