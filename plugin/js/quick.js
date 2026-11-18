// HermiteCut — Actions
(function () {
    'use strict';
    const { $, $$, store, toast, call } = window.HC;

    const MARKER_COLORS = ['Blue', 'Cyan', 'Green', 'Yellow', 'Red', 'Pink', 'Purple', 'Fuchsia', 'Rose', 'Lavender', 'Sky', 'Mint', 'Lemon', 'Sand', 'Cocoa', 'Cream'];
    const CLIP_COLORS = ['Orange', 'Apricot', 'Yellow', 'Lime', 'Olive', 'Green', 'Teal', 'Navy', 'Blue', 'Purple', 'Violet', 'Pink', 'Tan', 'Beige', 'Brown', 'Chocolate'];
    const fill = (sel, list, def) => { const s = $(sel); list.forEach(c => s.add(new Option(c, c))); s.value = store.get('q.' + sel, def); s.onchange = () => store.set('q.' + sel, s.value); };
    fill('#qMarker', MARKER_COLORS, 'Blue');
    fill('#qClipColor', CLIP_COLORS.concat(['none']), 'Orange');
    ['#qFrames', '#qLufs', '#qSilence', '#qNudge'].forEach(id => {
        const el = $(id); const v = store.get('q.' + id, null); if (v !== null) el.value = v;
        el.onchange = () => store.set('q.' + id, el.value);
    });
    const opt = (id) => $(id).value;

    const CATS = [
        ['fav', '★ Favourites'], ['timing', 'Timing'], ['clip', 'Clips'], ['marker', 'Markers'],
        ['insert', 'Insert'], ['audio', 'Audio'], ['color', 'Colour & AI'], ['timeline', 'Timeline'], ['page', 'Pages']
    ];
    // [id, code, name, cat, argFn]
    const A = [
        ['speed', '50%', 'Speed 50%', 'timing', () => 50],
        ['speed', '75%', 'Speed 75%', 'timing', () => 75],
        ['speed', '100%', 'Speed 100%', 'timing', () => 100],
        ['speed', '150%', 'Speed 150%', 'timing', () => 150],
        ['speed', '200%', 'Speed 200%', 'timing', () => 200],
        ['speed', 'FRZ', 'Freeze frame (0%)', 'timing', () => 0],
        ['fadeIn', 'F-IN', 'Fade in', 'timing', () => +opt('#qFrames')],
        ['fadeOut', 'F-OUT', 'Fade out', 'timing', () => +opt('#qFrames')],
        ['fadeBoth', 'F-I/O', 'Fade in + out', 'timing', () => +opt('#qFrames')],
        ['fadeNone', 'F-0', 'Remove fades', 'timing'],
        ['dissolveIn', 'DIS◂', 'Cross dissolve at start', 'timing', () => +opt('#qFrames')],
        ['dissolveOut', 'DIS▸', 'Cross dissolve at end', 'timing', () => +opt('#qFrames')],
        ['dipIn', 'DIP◂', 'Dip to colour at start', 'timing'],
        ['dipOut', 'DIP▸', 'Dip to colour at end', 'timing'],
        ['rippleDelete', 'RDEL', 'Ripple delete selection', 'timing'],
        ['deleteGaps', 'GAPS', 'Close all gaps', 'timing'],
        ['removeSilence', 'SIL', 'Remove silence (audio clips)', 'timing', () => +opt('#qSilence')],

        ['toggleEnable', 'ON/OFF', 'Enable / disable clips', 'clip'],
        ['delete', 'DEL', 'Delete selection (leave gap)', 'clip'],
        ['link', 'LNK', 'Link clips', 'clip'],
        ['unlink', 'ULNK', 'Unlink clips', 'clip'],
        ['compound', 'CMP', 'Make compound clip', 'clip'],
        ['fusionClip', 'FUS', 'Make Fusion clip', 'clip'],
        ['clipColor', 'CLR', 'Set clip colour', 'clip', () => opt('#qClipColor')],
        ['flag', 'FLG', 'Add red flag', 'clip', () => 'Red'],
        ['clearFlags', 'FLG-0', 'Clear flags', 'clip'],

        ['marker', 'MRK', 'Marker at playhead', 'marker', () => opt('#qMarker')],
        ['markerClips', 'MRK▣', 'Markers at selected clip starts', 'marker', () => opt('#qMarker')],
        ['nextMarker', 'MRK▸', 'Go to next marker', 'marker'],
        ['prevMarker', '◂MRK', 'Go to previous marker', 'marker'],
        ['clearMarkers', 'MRK-0', 'Clear all timeline markers', 'marker'],
        ['clearClipMarkers', 'CMK-0', 'Clear markers on selected clips', 'marker'],

        ['textPlus', 'TXT+', 'Insert Text+ at playhead', 'insert'],
        ['title', 'TXT', 'Insert basic text title', 'insert'],
        ['adjustment', 'ADJ', 'Insert adjustment clip', 'insert'],
        ['solid', 'SOL', 'Insert solid colour', 'insert'],
        ['fusionComp', 'COMP', 'Insert Fusion composition', 'insert'],

        ['normalize', 'LUFS', 'Normalize loudness', 'audio', () => +opt('#qLufs')],
        ['voiceIsolation', 'VOX', 'Voice isolation on', 'audio', () => 80],
        ['volume', '−6dB', 'Volume −6 dB', 'audio', () => -6],
        ['volume', '0dB', 'Volume 0 dB', 'audio', () => 0],
        ['volume', '+3dB', 'Volume +3 dB', 'audio', () => 3],

        ['autoColor', 'AUTO', 'Auto colour balance', 'color'],
        ['stabilize', 'STAB', 'Stabilize clips', 'color'],
        ['smartReframe', 'RFRM', 'Smart reframe', 'color'],
        ['grabStill', 'STILL', 'Grab still to gallery', 'color'],
        ['sceneCuts', 'CUTS', 'Scene cut detection', 'color'],

        ['addTrack', '+V', 'Add video track', 'timeline', () => 'video'],
        ['addTrack', '+A', 'Add audio track', 'timeline', () => 'audio'],
        ['deleteEmptyTracks', 'TRK-0', 'Delete empty tracks', 'timeline'],
        ['lockAll', 'LOCK', 'Lock all tracks', 'timeline'],
        ['unlockAll', 'ULCK', 'Unlock all tracks', 'timeline'],
        ['markInOutSelection', 'I/O', 'Set In/Out to selection', 'timeline'],
        ['clearInOut', 'I/O-0', 'Clear In/Out', 'timeline'],
        ['goStart', '|◂', 'Playhead to start', 'timeline'],
        ['goEnd', '▸|', 'Playhead to end', 'timeline'],
        ['nudgePlayhead', '◂◂', 'Playhead back N frames', 'timeline', () => -(+opt('#qNudge'))],
        ['nudgePlayhead', '▸▸', 'Playhead forward N frames', 'timeline', () => +opt('#qNudge')],
        ['duplicateTimeline', 'DUP', 'Duplicate timeline', 'timeline'],
        ['save', 'SAVE', 'Save project', 'timeline'],

        ['page', 'MED', 'Media page', 'page', () => 'media'],
        ['page', 'CUT', 'Cut page', 'page', () => 'cut'],
        ['page', 'EDT', 'Edit page', 'page', () => 'edit'],
        ['page', 'FUS', 'Fusion page', 'page', () => 'fusion'],
        ['page', 'COL', 'Color page', 'page', () => 'color'],
        ['page', 'FAIR', 'Fairlight page', 'page', () => 'fairlight'],
        ['page', 'DLV', 'Deliver page', 'page', () => 'deliver']
    ];
    const key = (a) => a[0] + ':' + a[1];
    let cat = store.get('q.cat', 'timing');
    let favs = new Set(store.get('q.favs', ['marker:MRK', 'fadeBoth:F-I/O', 'dissolveOut:DIS▸', 'speed:200%', 'textPlus:TXT+', 'normalize:LUFS']));

    const cats = $('#qCats');
    CATS.forEach(([k, label]) => {
        const b = document.createElement('button');
        b.textContent = label; b.dataset.k = k;
        b.onclick = () => { cat = k; store.set('q.cat', k); $('#qSearch').value = ''; render(); };
        cats.appendChild(b);
    });

    function render() {
        const q = $('#qSearch').value.trim().toLowerCase();
        $$('button', cats).forEach(b => b.classList.toggle('on', !q && b.dataset.k === cat));
        const g = $('#qGrid');
        g.innerHTML = '';
        A.filter(a => q ? (a[2] + ' ' + a[1] + ' ' + a[3]).toLowerCase().includes(q) : (cat === 'fav' ? favs.has(key(a)) : a[3] === cat))
            .forEach(a => {
                const b = document.createElement('button');
                b.className = 'qbtn c-' + a[3];
                b.innerHTML = `<span class="code"></span><span class="nm"></span>${favs.has(key(a)) ? '<span class="star">★</span>' : ''}`;
                b.querySelector('.code').textContent = a[1];
                b.querySelector('.nm').textContent = a[2];
                b.dataset.tip = a[2] + (favs.has(key(a)) ? ' — right-click to unfavourite' : ' — right-click to favourite');
                b.onclick = () => call('quick', { id: a[0], arg: a[4] ? a[4]() : undefined }).catch(() => {});
                b.oncontextmenu = (e) => {
                    e.preventDefault();
                    const k = key(a);
                    if (favs.has(k)) favs.delete(k); else favs.add(k);
                    store.set('q.favs', [...favs]); render();
                    toast(favs.has(k) ? '★ Added to favourites' : 'Removed from favourites', 'info');
                };
                g.appendChild(b);
            });
        if (!g.children.length) g.innerHTML = '<div class="hint">' + (cat === 'fav' && !q ? 'Right-click any action to add it here.' : 'No actions match.') + '</div>';
    }
    $('#qSearch').addEventListener('input', render);
    $('#qOptsBtn').onclick = () => { $('#qOpts').hidden = !$('#qOpts').hidden; $('#qOptsBtn').classList.toggle('on', !$('#qOpts').hidden); };
    render();

    // ---- deliver
    let folder = store.get('q.folder', '');
    const showFolder = () => { $('#qFolder').textContent = folder ? '📁 ' + folder.split(/[\\/]/).slice(-2).join('/') : 'Choose output folder…'; $('#qFolder').dataset.tip = folder || 'Output folder (uses preset folder if empty)'; };
    showFolder();
    $('#qFolder').onclick = async () => { const f = await window.hermite.chooseFolder({ title: 'Render output folder' }); if (f) { folder = f; store.set('q.folder', f); showFolder(); } };
    async function loadPresets(quiet) {
        try {
            const list = await call('renderPresets', {}, { silent: quiet, noRefresh: true });
            const s = $('#qPreset'); const cur = store.get('q.preset', s.value);
            s.length = 1;
            (list || []).forEach(p => s.add(new Option(p, p)));
            s.value = [...s.options].some(o => o.value === cur) ? cur : '';
        } catch (e) { /* */ }
    }
    $('#qPreset').onchange = () => store.set('q.preset', $('#qPreset').value);
    $('#qPresetRefresh').onclick = () => loadPresets(false);
    setTimeout(() => loadPresets(true), 800);
    const queue = (start, btn) => call('queueRender', { preset: $('#qPreset').value, dir: folder || undefined, start }, {
        button: btn, success: (r) => start ? 'Rendering “' + r.timeline + '”…' : 'Added “' + r.timeline + '” to the render queue'
    }).catch(() => {});
    $('#qQueue').onclick = (e) => queue(false, e.currentTarget);
    $('#qRender').onclick = (e) => queue(true, e.currentTarget);
    $('#qStill').onclick = async () => {
        const f = await window.hermite.saveFile({ title: 'Export still', defaultPath: 'still.png', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'tif', 'dpx', 'exr'] }] });
        if (f) call('exportStill', { file: f }, { success: 'Still exported' }).catch(() => {});
    };
    $('#qExport').onclick = async () => {
        const k = $('#qExpKind').value;
        const ext = { fcpxml: 'fcpxml', xml: 'xml', edl: 'edl', otio: 'otio', csv: 'csv', drt: 'drt' }[k];
        const f = await window.hermite.saveFile({ title: 'Export timeline', defaultPath: 'timeline.' + ext, filters: [{ name: k.toUpperCase(), extensions: [ext] }] });
        if (f) call('exportTimeline', { file: f, kind: k }, { success: 'Timeline exported' }).catch(() => {});
    };
})();
