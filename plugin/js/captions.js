// HermiteCut — Captions
(function () {
    'use strict';
    const { $, store, toast, call, seg, range, fitCanvas, accent } = window.HC;
    const LANGS = [
        ['auto', 'Auto detect'], ['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['pt', 'Portuguese'], ['de', 'German'],
        ['it', 'Italian'], ['nl', 'Dutch'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Mandarin (Simplified)'],
        ['zh-tw', 'Mandarin (Traditional)'], ['hi', 'Hindi'], ['ru', 'Russian'], ['tr', 'Turkish'], ['pl', 'Polish'],
        ['id', 'Indonesian'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['sv', 'Swedish'], ['da', 'Danish'], ['no', 'Norwegian'],
        ['fi', 'Finnish'], ['ro', 'Romanian'], ['ms', 'Malay'], ['ta', 'Tamil'],
        ['ar', 'Arabic (extended)'], ['uk', 'Ukrainian (extended)'], ['el', 'Greek (extended)'], ['he', 'Hebrew (extended)'],
        ['cs', 'Czech (extended)'], ['hu', 'Hungarian (extended)'], ['sw', 'Swahili (extended)'], ['ur', 'Urdu (extended)'],
        ['fa', 'Persian (extended)'], ['tl', 'Tagalog (extended)'], ['yue', 'Cantonese (extended)']
    ];
    const sel = $('#cLang');
    LANGS.forEach(([v, n]) => sel.add(new Option(n, v)));
    sel.value = store.get('c.lang', 'auto');
    const langLabel = () => { $('#cLangL').textContent = sel.value === 'auto' ? 'Auto language' : sel.options[sel.selectedIndex].text.replace(' (extended)', ''); };
    sel.onchange = () => { store.set('c.lang', sel.value); langLabel(); };
    langLabel();

    const cpl = $('#cCpl');
    cpl.value = store.get('c.cpl', 42);
    const paintCpl = range(cpl, $('#cCplV'), v => String(v), (v) => { store.set('c.cpl', v); if (fmt.get() !== 'custom') fmt.set('custom'); store.set('c.fmt', 'custom'); });
    const lines = seg($('#cLines'), (v) => store.set('c.lines', v), store.get('c.lines', '1'));
    const fmt = seg($('#cFormat'), (v) => {
        store.set('c.fmt', v);
        if (v === 'phrases') { cpl.value = 42; lines.set('2'); }
        if (v === 'words') { cpl.value = 12; lines.set('1'); }
        store.set('c.cpl', +cpl.value); paintCpl();
    }, store.get('c.fmt', 'phrases'));
    $('#cGap').value = store.get('c.gap', 0); $('#cGap').onchange = () => store.set('c.gap', +$('#cGap').value);
    $('#cPreset').value = store.get('c.preset', 'default'); $('#cPreset').onchange = () => store.set('c.preset', $('#cPreset').value);

    // ---- animated viz
    let phase = 0, active = false;
    function viz() {
        const { ctx, w, h } = fitCanvas($('#cViz'));
        ctx.clearRect(0, 0, w, h);
        const n = 26, bw = 3, gap = 4, total = n * (bw + gap), x0 = (w - total) / 2, mid = h / 2 + 6;
        for (let i = 0; i < n; i++) {
            const d = Math.abs(i - n / 2) / (n / 2);
            const env = Math.max(0.08, 1 - d * d);
            const v = active ? (0.35 + 0.65 * Math.abs(Math.sin(phase * 2.2 + i * 0.7) * Math.cos(phase * 0.9 + i * 0.31))) : (0.25 + 0.25 * Math.abs(Math.sin(i * 1.7)));
            const bh = Math.max(3, v * env * (h - 34));
            ctx.fillStyle = i % 5 === 2 ? accent() : 'rgba(255,255,255,.55)';
            ctx.globalAlpha = 0.35 + 0.65 * env;
            ctx.fillRect(x0 + i * (bw + gap), mid - bh / 2, bw, bh);
        }
        ctx.globalAlpha = 1;
        if (active) { phase += 0.06; requestAnimationFrame(viz); }
    }

    function badge(t, cls) { const b = $('#cBadge'); b.textContent = t; b.className = 'badge ' + (cls || ''); }
    function prog(p) { $('#cProg').style.width = Math.max(0, Math.min(100, p)) + '%'; }

    async function status() {
        try {
            const r = await window.hermite.call('captionStatus');
            return (r && r.ok && r.result) ? r.result : null;
        } catch (e) { return null; }
    }
    $('#cCreate').onclick = async () => {
        const btn = $('#cCreate');
        active = true; viz(); badge('Listening', 'busy'); prog(4);
        try {
            await call('createCaptions', {
                lang: sel.value, preset: $('#cPreset').value, charsPerLine: +cpl.value,
                lines: +lines.get(), gap: +$('#cGap').value
            }, { button: btn, busyText: 'Starting…', success: null, noRefresh: true });
            btn.disabled = true;
            btn.innerHTML = '<span class="busy-spin"></span>Transcribing…';
            // Resolve transcribes in the background: follow its job status.
            const t0 = Date.now();
            let final = 'Complete';
            while (Date.now() - t0 < 30 * 60 * 1000) {
                await new Promise(r => setTimeout(r, 800));
                const st = await status();
                if (!st) break;
                const pct = +(st.CompletionPercentage || st.completionPercentage || 0);
                if (pct) prog(pct); else prog(Math.min(90, 4 + (Date.now() - t0) / 1000));
                const js = String(st.JobStatus || st.jobStatus || '');
                if (/complete|fail|cancel/i.test(js)) { final = js; break; }
            }
            if (/fail|cancel/i.test(final)) { badge('Error'); prog(0); toast('Caption job ' + final.toLowerCase(), 'err'); }
            else { prog(100); badge('Done', 'good'); toast('Captions added on a subtitle track'); }
        } catch (e) {
            badge('Error'); prog(0);
        } finally {
            btn.disabled = false;
            btn.innerHTML = window.HC.ICONS.caption + 'Create captions';
            active = false; setTimeout(viz, 50);
            setTimeout(() => { prog(0); badge('Ready'); }, 4000);
            window.HC.poll();
        }
    };
    $('#cImport').onclick = async () => {
        const f = await window.hermite.openFile({ title: 'Import subtitles', filters: [{ name: 'Subtitles', extensions: ['srt', 'vtt', 'stl', 'xml'] }] });
        if (f) call('importSubtitles', { file: f }, { success: (r) => r.appended ? 'Subtitles added to the timeline' : 'Imported to the media pool — drag it onto the timeline' }).catch(() => {});
    };
    window.addEventListener('resize', viz);
    requestAnimationFrame(viz);
})();
