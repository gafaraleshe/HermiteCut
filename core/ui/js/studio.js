// HermiteCut 2 — Templates, Grid Reveal, Sound, Library, Captions+, Shorts and Setup.
// Host-independent: every action goes through window.hermite.call(name, args).
(function () {
    'use strict';
    const HC = window.HC;
    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const store = HC.store;
    let CAT = { templates: [], sounds: [], sfxDir: '' };

    function seg(el, cb) {
        el.addEventListener('click', (e) => {
            const b = e.target.closest('button'); if (!b) return;
            $$('button', el).forEach(x => x.classList.toggle('on', x === b));
            cb && cb(b.dataset.v);
        });
        return () => ($('button.on', el) || {}).dataset ? $('button.on', el).dataset.v : null;
    }
    const val = (sel) => { const b = $(sel + ' button.on'); return b ? b.dataset.v : null; };

    // ============================================================ Templates
    const TABS = {
        effects: t => t.kind === 'effect' && !['Time FX', 'Grid Reveal'].includes(t.family),
        timefx: t => t.family === 'Time FX',
        transitions: t => t.kind === 'transition' && t.family !== 'Grid Reveal',
        titles: t => t.kind === 'title',
        favs: t => (store.get('favs', [])).includes(t.id)
    };
    let tTab = 'effects', tFamily = 'All', tSel = null;

    function renderTemplates() {
        const q = ($('#tSearch').value || '').toLowerCase();
        const inTab = CAT.templates.filter(TABS[tTab]);
        const fams = ['All', ...new Set(inTab.map(t => t.family))];
        $('#tFamilies').innerHTML = fams.length > 2 ? fams.map(f => `<button class="chip${f === tFamily ? ' on' : ''}" data-f="${esc(f)}">${esc(f)}</button>`).join('') : '';
        const favs = store.get('favs', []);
        const list = inTab.filter(t => (tFamily === 'All' || t.family === tFamily) && (!q || (t.name + ' ' + t.blurb).toLowerCase().includes(q)));
        $('#tList').innerHTML = list.map(t => `
          <button class="tpl${tSel && tSel.id === t.id ? ' on' : ''}" data-id="${esc(t.id)}" data-tip="${esc(t.blurb)}">
            <span class="tpl-n">${esc(t.name)}</span><span class="tpl-f">${esc(t.family)}</span>
            <span class="star${favs.includes(t.id) ? ' on' : ''}" data-star="${esc(t.id)}">★</span>
          </button>`).join('') || '<div class="hint">Nothing here yet. Open Setup if the template list is empty.</div>';
        renderTemplateOptions();
    }
    function renderTemplateOptions() {
        const box = $('#tOpts');
        if (!tSel) { box.innerHTML = '<div class="hint">Pick a template. Effects go on the <b>selected clips</b>, transitions on the cut after the selected clip, titles at the playhead.</div>'; $('#tApply').disabled = true; return; }
        $('#tApply').disabled = false;
        const d = tSel.defaults || {};
        let html = `<div class="tpl-title">${esc(tSel.name)}</div><div class="hint">${esc(tSel.blurb)}${tSel.styles && tSel.styles.length ? ' Styles: ' + tSel.styles.map(esc).join(', ') + '.' : ''}</div>`;
        if (tSel.kind === 'effect') {
            html += `<div class="label">Apply at</div><div class="seg" id="tMode">${['Post', 'Pre', 'Both', 'Whole'].map((m, i) => `<button data-v="${i}" class="${i === (d.Mode || 0) ? 'on' : ''}">${m}</button>`).join('')}</div>
              <div class="row"><div><div class="label">Frames</div><input type="number" id="tFrames" min="1" max="600" value="${d.Frames || 8}" style="width:100%"></div>
              <div><div class="label">Strength <span class="val" id="tStrV">${d.Strength || 1}</span></div><input type="range" id="tStr" min="0" max="2" step="0.05" value="${d.Strength || 1}"></div></div>`;
        } else if (tSel.kind === 'transition') {
            html += `<div class="row"><div><div class="label">Duration (frames)</div><input type="number" id="tDur" min="2" max="120" value="${store.get('trDur', 20)}" style="width:100%"></div></div>`;
        } else {
            html += `<div class="label">Place at</div><div class="seg" id="tAt"><button data-v="playhead" class="on">Playhead</button><button data-v="clip">Clip start</button></div>`;
            for (const f of tSel.fields || []) html += `<div class="label">${esc(f.label)}</div><input type="text" class="tfield" data-k="${esc(f.key)}" placeholder="${esc(f.label)}" style="width:100%">`;
            html += `<div class="row"><button class="btn" id="tSavePreset">Save as my preset</button><select id="tPresets"><option value="">My presets…</option>${Object.keys(store.get('titlePresets', {})).map(n => `<option>${esc(n)}</option>`).join('')}</select></div>`;
        }
        box.innerHTML = html;
        HC.hydrateIcons && HC.hydrateIcons(box);
        $$('.seg', box).forEach(s => seg(s));
        const str = $('#tStr'); if (str) str.oninput = () => { $('#tStrV').textContent = (+str.value).toFixed(2); };
        const save = $('#tSavePreset');
        if (save) save.onclick = () => {
            const name = prompt('Preset name');
            if (!name) return;
            const all = store.get('titlePresets', {});
            all[name] = { id: tSel.id, values: titleValues() };
            store.set('titlePresets', all);
            HC.toast('Saved "' + name + '"');
            renderTemplateOptions();
        };
        const pick = $('#tPresets');
        if (pick) pick.onchange = () => {
            const p = store.get('titlePresets', {})[pick.value];
            if (!p) return;
            $$('.tfield').forEach(i => { i.value = p.values[i.dataset.k] || ''; });
        };
    }
    function titleValues() { const v = {}; $$('.tfield').forEach(i => { if (i.value) v[i.dataset.k] = i.value; }); return v; }

    async function applyTemplate() {
        const t = tSel; if (!t) return;
        const btn = $('#tApply');
        if (t.kind === 'effect') {
            const values = { Mode: +val('#tMode'), Frames: +$('#tFrames').value, Strength: +$('#tStr').value };
            const r = await HC.call('applyEffect', { id: t.id, values }, { button: btn, busyText: 'Applying…' });
            pushUndo('effect', r);
        } else if (t.kind === 'transition') {
            store.set('trDur', +$('#tDur').value);
            await HC.call('addTransition', { name: t.name, id: t.id, frames: +$('#tDur').value }, { button: btn, busyText: 'Adding…' });
        } else {
            await HC.call('insertTitle', { name: t.name, at: val('#tAt'), values: titleValues() }, { button: btn, busyText: 'Inserting…' });
        }
    }
    function pushUndo() { $('#tUndo').disabled = false; }

    function initTemplates() {
        seg($('#tTabs'), (v) => { tTab = v; tFamily = 'All'; tSel = null; renderTemplates(); });
        $('#tSearch').addEventListener('input', renderTemplates);
        $('#tFamilies').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) { tFamily = b.dataset.f; renderTemplates(); } });
        $('#tList').addEventListener('click', (e) => {
            const star = e.target.closest('[data-star]');
            if (star) {
                const favs = new Set(store.get('favs', []));
                favs.has(star.dataset.star) ? favs.delete(star.dataset.star) : favs.add(star.dataset.star);
                store.set('favs', [...favs]);
                renderTemplates();
                return;
            }
            const b = e.target.closest('.tpl'); if (!b) return;
            tSel = CAT.templates.find(t => t.id === b.dataset.id);
            renderTemplates();
        });
        $('#tApply').addEventListener('click', applyTemplate);
        $('#tUndo').addEventListener('click', () => HC.call('removeEffects', {}, { button: $('#tUndo') }));
    }

    // ============================================================ Grid Reveal
    const GRID_LOOKS = [
        ['Grid Clean Reveal', { Cells: 14, Order: 2, Anim: 1, Spread: 0.75, ShowLines: 1 }],
        ['Grid Diagonal Sweep', { Cells: 14, Order: 2, Anim: 0, Spread: 0.85, ShowLines: 1 }],
        ['Grid Spiral In', { Cells: 14, Order: 4, Anim: 1, Spread: 0.8, ShowLines: 1 }],
        ['Grid Centre Burst', { Cells: 14, Order: 3, Anim: 1, Spread: 0.7, ShowLines: 0 }],
        ['Grid Beat', { Cells: 14, Order: 0, Anim: 0, Spread: 0.9, ShowLines: 1, Steps: 8 }],
        ['Grid Glitch', { Cells: 14, Order: 5, Anim: 0, Spread: 0.9, ShowLines: 1 }],
        ['Grid White Flash', { Cells: 14, Order: 2, Anim: 0, Spread: 0.85, ShowLines: 1, FlashAmt: 1 }],
        ['Grid Neon', { Cells: 14, Order: 3, Anim: 2, Spread: 0.75, ShowLines: 1 }],
        ['Grid Mosaic Out', { Cells: 14, Order: 3, Anim: 4, Spread: 0.7, ShowLines: 0 }],
        ['Grid Light Reveal', { Cells: 14, Order: 6, Anim: 2, Spread: 0.85, ShowLines: 0 }],
        ['Grid Collage', { Cells: 14, Order: 5, Anim: 1, Spread: 0.6, ShowLines: 1 }]
    ];
    const ORDERS = ['Row by row', 'Column by column', 'Diagonal', 'Centre out', 'Spiral', 'Random', 'By brightness'];
    const ANIMS = ['Pop', 'Scale', 'Fade', 'Wipe', 'Shrink', 'Flip'];
    let gLook = GRID_LOOKS[0][0], gVals = Object.assign({}, GRID_LOOKS[0][1]), gT0 = performance.now();

    function cellOrder(i, j, C, R, order, seed) {
        const dx = i + 0.5 - C / 2, dy = j + 0.5 - R / 2;
        switch (order) {
            case 0: return ((R - 1 - j) * C + i) / Math.max(1, C * R - 1);
            case 1: return (i * R + (R - 1 - j)) / Math.max(1, C * R - 1);
            case 2: return (i + (R - 1 - j)) / Math.max(1, C + R - 2);
            case 3: return Math.hypot(dx, dy) / Math.hypot(C / 2, R / 2);
            case 4: { const ring = Math.max(Math.abs(dx), Math.abs(dy)); return Math.min(1, (ring - 0.5 + ((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI))) / (Math.max(C, R) / 2)); }
            case 5: { const h = Math.sin((seed * 97 + i * 131 + j * 7919 + 17) * 12.9898) * 43758.5453; return h - Math.floor(h); }
            default: return 1 - (0.5 + 0.4 * Math.sin(i / C * 7) * Math.cos(j / R * 5));
        }
    }
    function drawGrid() {
        const cv = $('#gPreview'); if (!cv || !cv.isConnected || cv.offsetParent === null) return requestAnimationFrame(drawGrid);
        const ctx = cv.getContext('2d');
        const W = cv.width = cv.clientWidth * devicePixelRatio, H = cv.height = cv.clientHeight * devicePixelRatio;
        const t = ((performance.now() - gT0) / 2600) % 1.4;
        const P0 = Math.min(1, t), steps = gVals.Steps || 0;
        const P = steps ? Math.floor(P0 * steps + 1e-4) / steps : P0;
        const C = gVals.Cells, R = Math.max(1, Math.round(C * H / W)), S = gVals.Spread;
        const cw = W / C, ch = H / R;
        const A = (x, y) => `hsl(${220 + 30 * Math.sin(x / W * 4)},25%,${18 + 10 * Math.cos(y / H * 3)}%)`;
        ctx.fillStyle = A(0, 0); ctx.fillRect(0, 0, W, H);
        const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#b9acff'); g.addColorStop(1, '#4f8fe8');
        for (let i = 0; i < C; i++) for (let j = 0; j < R; j++) {
            const o = Math.min(1, Math.max(0, cellOrder(i, R - 1 - j, C, R, gVals.Order, 0)));
            const p = Math.min(1, Math.max(0, (P - o * S) / Math.max(1e-4, 1 - S)));
            const x = i * cw, y = j * ch;
            ctx.fillStyle = g;
            if (gVals.Anim === 0 && p > 0.5) ctx.fillRect(x, y, cw, ch);
            else if (gVals.Anim === 1 && p > 0) { const e = p * p * (3 - 2 * p), s = e * cw, sh = e * ch; ctx.fillRect(x + (cw - s) / 2, y + (ch - sh) / 2, s, sh); }
            else if (gVals.Anim === 2 && p > 0) { ctx.globalAlpha = p; ctx.fillRect(x, y, cw, ch); ctx.globalAlpha = 1; }
            else if (gVals.Anim === 3 && p > 0) ctx.fillRect(x, y, cw * p, ch);
            else if (gVals.Anim === 4) { ctx.fillRect(x, y, cw, ch); if (p < 1) { const s = (1 - p); ctx.fillStyle = A(x, y); ctx.fillRect(x + cw * (1 - s) / 2, y + ch * (1 - s) / 2, cw * s, ch * s); } }
            else if (gVals.Anim === 5 && p > 0.5) { const s = 2 * p - 1; ctx.fillRect(x + cw * (1 - s) / 2, y, cw * s, ch); }
            if (gVals.FlashAmt && p > 0 && p < 0.35) { ctx.fillStyle = `rgba(255,255,255,${1 - p / 0.35})`; ctx.fillRect(x, y, cw, ch); }
        }
        if (gVals.ShowLines) {
            ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = Math.max(1, devicePixelRatio);
            ctx.beginPath();
            for (let i = 0; i <= C; i++) { ctx.moveTo(Math.round(i * cw) + .5, 0); ctx.lineTo(Math.round(i * cw) + .5, H); }
            for (let j = 0; j <= R; j++) { ctx.moveTo(0, Math.round(j * ch) + .5); ctx.lineTo(W, Math.round(j * ch) + .5); }
            ctx.stroke();
        }
        requestAnimationFrame(drawGrid);
    }
    function renderGrid() {
        const mine = store.get('gridPresets', {});
        $('#gLooks').innerHTML = GRID_LOOKS.map(([n]) => `<button class="chip${n === gLook ? ' on' : ''}" data-l="${esc(n)}">${esc(n.replace('Grid ', ''))}</button>`).join('') +
            Object.keys(mine).map(n => `<button class="chip mine${n === gLook ? ' on' : ''}" data-m="${esc(n)}">★ ${esc(n)}</button>`).join('');
        $('#gCells').value = gVals.Cells; $('#gCellsV').textContent = gVals.Cells;
        $('#gSpread').value = gVals.Spread;
        $('#gOrder').value = gVals.Order; $('#gAnim').value = gVals.Anim;
        $('#gLines').checked = !!gVals.ShowLines; $('#gFlash').checked = !!gVals.FlashAmt;
    }
    function initGrid() {
        $('#gOrder').innerHTML = ORDERS.map((o, i) => `<option value="${i}">${o}</option>`).join('');
        $('#gAnim').innerHTML = ANIMS.map((o, i) => `<option value="${i}">${o}</option>`).join('');
        $('#gLooks').addEventListener('click', (e) => {
            const b = e.target.closest('.chip'); if (!b) return;
            if (b.dataset.l) { gLook = b.dataset.l; gVals = Object.assign({}, GRID_LOOKS.find(x => x[0] === gLook)[1]); }
            else { const p = store.get('gridPresets', {})[b.dataset.m]; gLook = p.look; gVals = Object.assign({}, p.values); }
            gT0 = performance.now(); renderGrid();
        });
        const upd = () => {
            gVals.Cells = +$('#gCells').value; $('#gCellsV').textContent = gVals.Cells;
            gVals.Spread = +$('#gSpread').value; gVals.Order = +$('#gOrder').value; gVals.Anim = +$('#gAnim').value;
            gVals.ShowLines = $('#gLines').checked ? 1 : 0; gVals.FlashAmt = $('#gFlash').checked ? 1 : 0;
        };
        ['#gCells', '#gSpread', '#gOrder', '#gAnim', '#gLines', '#gFlash'].forEach(s => $(s).addEventListener('input', upd));
        $('#gSave').addEventListener('click', () => {
            const name = prompt('Name this grid preset'); if (!name) return;
            const all = store.get('gridPresets', {}); all[name] = { look: gLook, values: Object.assign({}, gVals) };
            store.set('gridPresets', all); renderGrid(); HC.toast('Saved "' + name + '"');
        });
        $('#gApply').addEventListener('click', async () => {
            const t = CAT.templates.find(x => x.name === gLook);
            await HC.call('addTransition', { name: gLook, id: t && t.id, frames: +$('#gDur').value }, { button: $('#gApply'), busyText: 'Adding…' });
            if ($('#gSfx').checked) await HC.call('placeAudio', { file: sfxPath('Glitch 07'), where: 'playhead' }, { silent: true }).catch(() => 0);
        });
        $('#gTrack').addEventListener('click', () => {
            const t = CAT.templates.find(x => x.name === 'Grid Hand Track');
            HC.call('applyEffect', { id: t ? t.id : 'Fusion/Effects/HermiteCut/Grid Hand Track', values: { Cells: gVals.Cells } }, { button: $('#gTrack') });
        });
        renderGrid();
        requestAnimationFrame(drawGrid);
    }

    // ============================================================ Sound
    let sCat = 'All', audio = null, playing = null;
    function sfxPath(name) { const s = CAT.sounds.find(x => x.name === name); return s ? CAT.sfxDir + '/' + s.file : ''; }
    function renderSounds() {
        const q = ($('#sSearch').value || '').toLowerCase();
        const cats = ['All', '★', ...new Set(CAT.sounds.map(s => s.category))];
        $('#sCats').innerHTML = cats.map(c => `<button class="chip${c === sCat ? ' on' : ''}" data-c="${esc(c)}">${esc(c)}</button>`).join('');
        const favs = store.get('sfxFavs', []);
        const list = CAT.sounds.filter(s => (sCat === 'All' || s.category === sCat || (sCat === '★' && favs.includes(s.name))) && (!q || s.name.toLowerCase().includes(q)));
        $('#sList').innerHTML = list.map(s => `<div class="snd${playing === s.name ? ' playing' : ''}" data-n="${esc(s.name)}">
            <button class="ibtn play" data-play="${esc(s.name)}" data-icon="play"></button>
            <span class="snd-n">${esc(s.name)}</span><span class="snd-d">${s.seconds.toFixed(1)}s</span>
            <span class="star${favs.includes(s.name) ? ' on' : ''}" data-sfav="${esc(s.name)}">★</span>
            <button class="btn sm" data-place="${esc(s.name)}">Place</button></div>`).join('') || '<div class="hint">No sounds match.</div>';
        HC.hydrateIcons && HC.hydrateIcons($('#sList'));
    }
    async function play(name) {
        if (audio) { audio.pause(); audio = null; }
        if (playing === name) { playing = null; renderSounds(); return; }
        playing = name; renderSounds();
        try {
            const r = await window.hermite.readFile(sfxPath(name), 20 * 1048576);
            if (!r || !r.ok) throw new Error(r && r.error);
            audio = new Audio(URL.createObjectURL(new Blob([r.data], { type: 'audio/wav' })));
            audio.onended = () => { playing = null; renderSounds(); };
            await audio.play();
        } catch (e) { playing = null; renderSounds(); HC.toast('Could not play: ' + (e.message || e), 'err'); }
    }
    function initSound() {
        $('#sSearch').addEventListener('input', renderSounds);
        $('#sCats').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) { sCat = b.dataset.c; renderSounds(); } });
        seg($('#sWhere'));
        $('#sList').addEventListener('click', (e) => {
            const p = e.target.closest('[data-play]'); if (p) return play(p.dataset.play);
            const f = e.target.closest('[data-sfav]');
            if (f) { const s = new Set(store.get('sfxFavs', [])); s.has(f.dataset.sfav) ? s.delete(f.dataset.sfav) : s.add(f.dataset.sfav); store.set('sfxFavs', [...s]); return renderSounds(); }
            const pl = e.target.closest('[data-place]');
            if (pl) HC.call('placeAudio', { file: sfxPath(pl.dataset.place), where: val('#sWhere') }, { button: pl });
        });
    }

    // ============================================================ Library
    let libIndex = null, libType = 'all';
    const LIB_ACTION = { lut: 'Apply LUT', video: 'Place overlay', image: 'Place', audio: 'Place', drfx: 'Install pack', drt: 'Import timeline', setting: 'Install' };
    function renderLibrary() {
        const folders = store.get('libFolders', []);
        $('#lFolders').innerHTML = folders.map((f, i) => `<div class="folder"><span data-icon="folder" class="fi"></span><span class="fp" data-tip="${esc(f)}">${esc(f)}</span><button class="ibtn" data-rm="${i}" data-icon="x"></button></div>`).join('') ||
            '<div class="hint">Add the folders where you keep LUTs, overlays, sounds and packs. HermiteCut reads them where they are, including inside .zip files, and never copies them.</div>';
        HC.hydrateIcons && HC.hydrateIcons($('#lFolders'));
        const q = ($('#lSearch').value || '').toLowerCase();
        const items = (libIndex ? libIndex.items : []).filter(it => (libType === 'all' || it.type === libType || (libType === 'overlay' && (it.type === 'video' || it.type === 'image'))) && (!q || (it.name + ' ' + it.folder).toLowerCase().includes(q))).slice(0, 400);
        $('#lCount').textContent = libIndex ? libIndex.items.length + ' files' : '';
        $('#lList').innerHTML = items.map((it, i) => `<div class="asset"><span class="badge t-${it.type}">${it.type.toUpperCase()}</span><span class="an" data-tip="${esc(it.folder)}">${esc(it.name)}</span>${it.zip ? '<span class="zip">zip</span>' : ''}<button class="btn sm" data-use="${i}">${LIB_ACTION[it.type]}</button></div>`).join('');
        $('#lList')._items = items;
    }
    function initLibrary() {
        libIndex = store.get('libIndex', null);
        seg($('#lTypes'), (v) => { libType = v; renderLibrary(); });
        $('#lSearch').addEventListener('input', renderLibrary);
        $('#lAdd').addEventListener('click', async () => {
            const f = await window.hermite.chooseFolder({ title: 'Add a folder to the library' });
            if (!f) return;
            const all = store.get('libFolders', []); if (!all.includes(f)) all.push(f);
            store.set('libFolders', all); renderLibrary();
        });
        $('#lFolders').addEventListener('click', (e) => {
            const b = e.target.closest('[data-rm]'); if (!b) return;
            const all = store.get('libFolders', []); all.splice(+b.dataset.rm, 1); store.set('libFolders', all); renderLibrary();
        });
        $('#lIndex').addEventListener('click', async () => {
            libIndex = await HC.call('libraryIndex', { folders: store.get('libFolders', []) }, { button: $('#lIndex'), busyText: 'Reading folders…', success: (r) => r.items.length + ' files indexed' });
            store.set('libIndex', libIndex.items.length < 20000 ? libIndex : null);
            renderLibrary();
        });
        $('#lList').addEventListener('click', (e) => {
            const b = e.target.closest('[data-use]'); if (!b) return;
            HC.call('libraryUse', { item: $('#lList')._items[+b.dataset.use], action: 'playhead' }, { button: b });
        });
        renderLibrary();
    }

    // ============================================================ Captions+, Shorts, Setup
    function initCaptionsPlus() {
        $('#cpStyle').innerHTML = CAT.templates.filter(t => t.kind === 'title').map(t => `<option${t.name === 'Caption' ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
        $('#cpMax').addEventListener('input', () => { $('#cpMaxV').textContent = $('#cpMax').value + ' s'; });
        $('#cpGo').addEventListener('click', () => HC.call('captionsPlus', { title: $('#cpStyle').value, maxSeconds: +$('#cpMax').value }, { button: $('#cpGo'), busyText: 'Building captions…' }));
    }
    function initShorts() {
        $('#shDup').addEventListener('click', () => HC.call('shortsDuplicate', { reframe: $('#shReframe').checked }, { button: $('#shDup'), busyText: 'Creating 9:16 timeline…' }));
        $('#shReframeSel').addEventListener('click', () => HC.call('smartReframe', {}, { button: $('#shReframeSel') }));
    }
    const SETUP = [
        ['scripting', 'Connection to Resolve', null, 'In Resolve: Preferences → System → General → External scripting using: <b>Local</b>, then restart Resolve.'],
        ['templates', 'Template pack', 'installTemplates', 'Effects, transitions, titles and Grid Reveal in the Effects library.'],
        ['plugin', 'Resolve panel', 'installPlugin', 'Workspace → Workflow Integrations → HermiteCut (Resolve Studio). Asks for administrator rights.'],
        ['launcher', 'Scripts menu launcher', 'installLauncher', 'Workspace → Scripts → HermiteCut opens this app.'],
        ['fonts', 'Title fonts', 'installFonts', 'Archivo, Outfit and Montserrat for the titles.']
    ];
    async function renderSetup() {
        let st = {};
        try { st = await HC.call('setupStatus', {}, { silent: true }); } catch (e) { st = {}; }
        $('#suList').innerHTML = SETUP.map(([k, name, action, hint]) => `<div class="su-row"><span class="su-dot ${st[k] ? 'ok' : ''}"></span>
            <div class="su-t"><div>${name}${k === 'scripting' && st.resolve ? ' · ' + esc(st.resolve) : ''}</div><div class="hint">${hint}</div></div>
            ${action ? `<button class="btn sm" data-act="${action}">${st[k] ? 'Reinstall' : 'Install'}</button>` : ''}</div>`).join('');
        $('#suMode').textContent = st.mode === 'plugin' ? 'Running as the Resolve panel' : 'Running as the HermiteCut app';
    }
    function initSetup() {
        $('#suList').addEventListener('click', async (e) => {
            const b = e.target.closest('[data-act]'); if (!b) return;
            await HC.call(b.dataset.act, {}, { button: b }).catch(() => 0); renderSetup();
        });
        $('#suAll').addEventListener('click', async () => {
            for (const a of ['installTemplates', 'installLauncher', 'installFonts', 'installPlugin']) await HC.call(a, {}, { silent: a === 'installPlugin' }).catch(() => 0);
            renderSetup();
        });
        $('#suCheck').addEventListener('click', renderSetup);
        renderSetup();
    }

    async function init() {
        if (!$('#tList')) return;
        try { CAT = await window.hermite.call('catalogue', {}).then(r => (r && r.ok) ? r.result : CAT); } catch (e) { /* */ }
        CAT.templates = CAT.templates || []; CAT.sounds = CAT.sounds || [];
        initTemplates(); renderTemplates();
        initGrid(); initSound(); renderSounds(); initLibrary(); initCaptionsPlus(); initShorts(); initSetup();
    }
    document.addEventListener('DOMContentLoaded', init);
    if (document.readyState !== 'loading') init();
})();
