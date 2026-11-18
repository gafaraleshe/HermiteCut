// HermiteCut — Beats (beat & transient detection in the panel)
(function () {
    'use strict';
    const { $, store, toast, call, seg, range, fitCanvas, accent } = window.HC;
    const SR = 22050, N = 1024, HOP = 256;
    const FPS_ENV = SR / HOP; // onset envelope rate (~86 Hz)

    let src = null;      // { file, start, srcStart, srcEnd, speed, fps, name, uid, fileMode }
    let audio = null;    // Float32Array mono (cropped)
    let peaks = null;    // waveform peaks
    let ana = null;      // { env, low, full, bpm, beats[], trans[] } (times in seconds)
    let picks = [];      // seconds (relative to crop start) currently marked
    let busy = false;

    const mode = seg($('#btMode'), (v) => { store.set('bt.mode', v); pick(); }, store.get('bt.mode', 'beats'));
    const every = seg($('#btEvery'), (v) => { store.set('bt.every', v); pick(); }, store.get('bt.every', '1'));
    const sens = $('#btSens'); sens.value = store.get('bt.sens', 55);
    range(sens, $('#btSensV'), v => v + '%', (v) => { store.set('bt.sens', v); pick(); });
    ['#btOffset', '#btGap'].forEach(id => { const v = store.get(id, null); if (v !== null) $(id).value = v; $(id).onchange = () => { store.set(id, $(id).value); pick(); }; });
    const colors = ['Lavender', 'Blue', 'Cyan', 'Green', 'Yellow', 'Red', 'Pink', 'Purple', 'Fuchsia', 'Rose', 'Sky', 'Mint', 'Lemon', 'Sand', 'Cocoa', 'Cream'];
    colors.forEach(c => $('#btColor').add(new Option(c, c)));
    $('#btColor').value = store.get('bt.color', 'Lavender'); $('#btColor').onchange = () => store.set('bt.color', $('#btColor').value);
    $('#btTarget').value = store.get('bt.target', 'timeline'); $('#btTarget').onchange = () => store.set('bt.target', $('#btTarget').value);

    function badge(text, cls) { const b = $('#btBadge'); b.textContent = text; b.className = 'badge ' + (cls || ''); }

    // ---------------------------------------------------------- DSP
    function fft(re, im) {
        const n = re.length;
        for (let i = 1, j = 0; i < n; i++) {
            let bit = n >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
        }
        for (let len = 2; len <= n; len <<= 1) {
            const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
            for (let i = 0; i < n; i += len) {
                let cr = 1, ci = 0;
                for (let k = 0; k < len / 2; k++) {
                    const ar = re[i + k], ai = im[i + k];
                    const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
                    const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
                    re[i + k] = ar + br; im[i + k] = ai + bi;
                    re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
                    const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
                }
            }
        }
    }
    const tick = () => new Promise(r => setTimeout(r, 0));

    async function onsetEnvelope(x) {
        const frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
        const win = new Float32Array(N);
        for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
        const half = N / 2;
        let prev = new Float32Array(half), cur = new Float32Array(half);
        const full = new Float32Array(frames), low = new Float32Array(frames);
        const re = new Float32Array(N), im = new Float32Array(N);
        const lowBin = Math.round(180 / (SR / N)); // < 180 Hz (kick / bass)
        for (let f = 0; f < frames; f++) {
            const o = f * HOP;
            for (let i = 0; i < N; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
            fft(re, im);
            let sf = 0, sl = 0;
            for (let k = 1; k < half; k++) {
                const m = Math.log1p(100 * Math.hypot(re[k], im[k]));
                cur[k] = m;
                const d = m - prev[k];
                if (d > 0) { sf += d; if (k <= lowBin) sl += d; }
            }
            full[f] = sf; low[f] = sl;
            const t = prev; prev = cur; cur = t;
            if ((f & 2047) === 0) { badge('Analysing ' + Math.round(f / frames * 100) + '%', 'busy'); await tick(); }
        }
        return { full: normalize(adapt(full)), low: normalize(adapt(low)) };
    }
    function adapt(e) {
        // subtract local mean (≈0.4 s) and half-wave rectify
        const w = Math.round(FPS_ENV * 0.2), out = new Float32Array(e.length);
        let acc = 0;
        const pre = new Float64Array(e.length + 1);
        for (let i = 0; i < e.length; i++) { acc += e[i]; pre[i + 1] = acc; }
        for (let i = 0; i < e.length; i++) {
            const a = Math.max(0, i - w), b = Math.min(e.length, i + w + 1);
            const mean = (pre[b] - pre[a]) / (b - a);
            out[i] = Math.max(0, e[i] - mean);
        }
        return out;
    }
    function normalize(e) {
        let mx = 0; for (const v of e) mx = Math.max(mx, v);
        if (mx > 0) for (let i = 0; i < e.length; i++) e[i] /= mx;
        return e;
    }
    function tempo(env) {
        const minLag = Math.round(FPS_ENV * 60 / 190), maxLag = Math.round(FPS_ENV * 60 / 60);
        let best = 0, bestLag = Math.round(FPS_ENV * 60 / 120);
        const scores = [];
        for (let lag = minLag; lag <= maxLag; lag++) {
            let s = 0;
            for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
            s /= (env.length - lag);
            const bpm = 60 * FPS_ENV / lag;
            const wgt = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2)); // prefer ~120 bpm
            scores.push([lag, s * wgt]);
            if (s * wgt > best) { best = s * wgt; bestLag = lag; }
        }
        // parabolic refine
        const i = scores.findIndex(x => x[0] === bestLag);
        let lag = bestLag;
        if (i > 0 && i < scores.length - 1) {
            const a = scores[i - 1][1], b = scores[i][1], c = scores[i + 1][1];
            const d = (a - 2 * b + c);
            if (d !== 0) lag = bestLag + 0.5 * (a - c) / d;
        }
        return { lag, bpm: 60 * FPS_ENV / lag };
    }
    function trackBeats(env, period) {
        // Ellis dynamic-programming beat tracker
        const n = env.length, score = new Float32Array(n), back = new Int32Array(n).fill(-1);
        const alpha = 100;
        for (let t = 0; t < n; t++) {
            let best = -Infinity, bi = -1;
            const a = Math.round(t - 2 * period), b = Math.round(t - period / 2);
            for (let p = Math.max(0, a); p <= b; p++) {
                const pen = -alpha * Math.pow(Math.log((t - p) / period), 2);
                const v = score[p] + pen;
                if (v > best) { best = v; bi = p; }
            }
            score[t] = env[t] + (bi >= 0 ? Math.max(0, best) : 0);
            back[t] = bi;
        }
        // start from best score in last period
        let t = n - 1, mx = -Infinity;
        for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > mx) { mx = score[i]; t = i; }
        const beats = [];
        while (t >= 0) { beats.push(t); t = back[t]; }
        return beats.reverse();
    }
    function peakPick(env, thresh, minGapEnv) {
        const out = [];
        let last = -1e9;
        for (let i = 2; i < env.length - 2; i++) {
            const v = env[i];
            if (v < thresh) continue;
            if (v >= env[i - 1] && v >= env[i + 1] && v >= env[i - 2] && v >= env[i + 2]) {
                if (i - last >= minGapEnv) { out.push(i); last = i; }
                else if (out.length && v > env[out[out.length - 1]]) { out[out.length - 1] = i; last = i; }
            }
        }
        return out;
    }
    function stats(e) {
        let s = 0, s2 = 0; for (const v of e) { s += v; s2 += v * v; }
        const m = s / e.length; return { mean: m, std: Math.sqrt(Math.max(0, s2 / e.length - m * m)) };
    }

    // ---------------------------------------------------------- pipeline
    async function decode(file) {
        const r = await window.hermite.readFile(file, 1.5 * 1024 * 1024 * 1024);
        if (!r.ok) throw new Error(r.error);
        const bytes = r.data;
        const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        const ctx = new OfflineAudioContext(1, 1, SR);
        let buf;
        try { buf = await ctx.decodeAudioData(ab); }
        catch (e) { throw new Error('Could not decode the audio in this file. Try the WAV/MP3, or a clip whose audio is AAC/MP3/WAV/FLAC.'); }
        const len = buf.length, ch = buf.numberOfChannels;
        const mono = new Float32Array(len);
        for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / ch; }
        return mono;
    }

    async function analyse(info) {
        if (busy) return;
        busy = true;
        $('#btAnalyse').disabled = true;
        try {
            src = info;
            $('#btSrc').textContent = '♪ ' + (info.name || info.file.split(/[\\/]/).pop()) + (info.fileMode ? ' — markers start at the playhead' : '');
            badge('Loading', 'busy');
            await tick();
            const mono = await decode(info.file);
            const a = Math.max(0, Math.floor((info.srcStart || 0) * SR));
            const b = info.srcEnd ? Math.min(mono.length, Math.ceil(info.srcEnd * SR)) : mono.length;
            audio = mono.subarray(a, Math.max(a + N * 4, b));
            peaks = buildPeaks(audio, 1600);
            draw();
            const env = await onsetEnvelope(audio);
            const mix = new Float32Array(env.full.length);
            for (let i = 0; i < mix.length; i++) mix[i] = 0.55 * env.low[i] + 0.45 * env.full[i];
            const tp = tempo(mix);
            const beats = trackBeats(mix, tp.lag);
            ana = { env, mix, bpm: tp.bpm, beats };
            $('#btBpm').textContent = Math.round(tp.bpm * 10) / 10 + ' bpm';
            badge('Ready', 'good');
            pick();
        } catch (e) {
            badge('Error');
            toast(e.message, 'err');
        } finally {
            busy = false;
            $('#btAnalyse').disabled = false;
        }
    }

    function pick() {
        if (!ana) { draw(); return; }
        const m = mode.get();
        const s = +sens.value / 100;
        const toSec = (i) => (i * HOP + N / 2) / SR;
        const strength = (e, i) => Math.max(e[i] || 0, e[i - 1] || 0, e[i + 1] || 0, e[i - 2] || 0, e[i + 2] || 0);
        let res = [];
        if (m === 'beats' || m === 'mixed') {
            // drop only beats that are weak compared with the typical beat (e.g. silent intros)
            const strs = ana.beats.map(i => strength(ana.mix, i));
            const sorted = strs.slice().sort((a, b) => a - b);
            const median = sorted[Math.floor(sorted.length / 2)] || 0;
            const th = median * Math.pow(1 - s, 1.5) * 1.1;
            res = ana.beats.filter((i, k) => strs[k] >= th).map(toSec);
        }
        if (m === 'transients' || m === 'mixed') {
            const env = m === 'mixed' ? ana.mix : ana.env.full;
            const st = stats(env);
            const k = m === 'mixed' ? 2.6 - 1.2 * s : 2.2 - 1.9 * s;
            const minGapEnv = Math.max(2, Math.round(FPS_ENV * 0.06));
            const tr = peakPick(env, st.mean + k * st.std, minGapEnv).map(toSec);
            if (m === 'mixed') {
                const tol = 0.09;
                tr.forEach(t => { if (!res.some(b => Math.abs(b - t) < tol)) res.push(t); });
                res.sort((a, b) => a - b);
            } else res = tr;
        }
        const n = +every.get() || 1;
        if (n > 1) res = res.filter((_, i) => i % n === 0);
        // min gap in timeline frames
        const fps = (src && src.fps) || 24;
        const speed = (src && src.speed) || 100;
        const gap = Math.max(1, +$('#btGap').value || 1) / fps * (speed / 100);
        const out = [];
        for (const t of res) if (!out.length || t - out[out.length - 1] >= gap) out.push(t);
        picks = out;
        $('#btCount').textContent = picks.length + ' markers';
        draw();
    }

    function buildPeaks(x, n) {
        const out = new Float32Array(n * 2), step = x.length / n;
        for (let i = 0; i < n; i++) {
            let mn = 0, mx = 0;
            const a = Math.floor(i * step), b = Math.min(x.length, Math.floor((i + 1) * step));
            for (let j = a; j < b; j += 4) { const v = x[j]; if (v < mn) mn = v; if (v > mx) mx = v; }
            out[i * 2] = mn; out[i * 2 + 1] = mx;
        }
        return out;
    }

    function draw() {
        const cv = $('#btWave');
        const { ctx, w, h } = fitCanvas(cv);
        ctx.clearRect(0, 0, w, h);
        const top = 26, bot = h - 6, mid = (top + bot) / 2, amp = (bot - top) / 2;
        if (!peaks) {
            // idle pulse graphic
            ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1.5;
            ctx.beginPath();
            for (let x = 0; x <= w; x += 3) {
                const k = Math.sin(x / 9) * Math.exp(-Math.pow((x - w / 2) / (w / 5), 2));
                ctx.lineTo(x, mid - k * amp * 0.7);
            }
            ctx.stroke();
            return;
        }
        const n = peaks.length / 2;
        let mx = 0.0001; for (const v of peaks) mx = Math.max(mx, Math.abs(v));
        ctx.fillStyle = 'rgba(255,255,255,.34)';
        for (let x = 0; x < w; x++) {
            const i = Math.floor(x / w * n);
            const lo = peaks[i * 2] / mx, hi = peaks[i * 2 + 1] / mx;
            ctx.fillRect(x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
        }
        if (audio && picks.length) {
            const dur = audio.length / SR;
            ctx.strokeStyle = accent(); ctx.globalAlpha = 0.9; ctx.lineWidth = 1;
            picks.forEach(t => { const x = Math.round(t / dur * w) + 0.5; ctx.beginPath(); ctx.moveTo(x, top - 2); ctx.lineTo(x, bot); ctx.stroke(); });
            ctx.globalAlpha = 1;
        }
    }

    // ---------------------------------------------------------- actions
    $('#btAnalyse').onclick = async () => {
        try {
            const info = await call('audioSource', {}, { silent: false, noRefresh: true });
            await analyse(info);
        } catch (e) { /* toast shown */ }
    };
    $('#btFile').onclick = async () => {
        const f = await window.hermite.openFile({ title: 'Choose an audio file', filters: [{ name: 'Audio / video', extensions: ['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'mp4', 'mov', 'webm'] }] });
        if (!f) return;
        try {
            const ph = await call('playhead', {}, { silent: true, noRefresh: true });
            await analyse({ file: f, name: f.split(/[\\/]/).pop(), start: ph.frame, srcStart: 0, srcEnd: 0, speed: 100, fps: ph.fps, fileMode: true });
        } catch (e) {
            toast('Open a timeline in Resolve first, then choose the file.', 'err');
        }
    };
    $('#btMark').onclick = () => {
        if (!ana || !src) return toast('Analyse a clip first', 'err');
        if (!picks.length) return toast('No beats at this sensitivity', 'err');
        const off = +$('#btOffset').value || 0;
        const k = 100 / (src.speed || 100);
        const frames = picks.map(t => Math.round(src.start + t * src.fps * k) + off);
        const target = src.fileMode ? 'timeline' : $('#btTarget').value;
        call('addBeatMarkers', { frames, color: $('#btColor').value, name: 'Beat', target, uid: src.uid }, {
            button: $('#btMark'), busyText: 'Marking…', success: (r) => `Added ${r.added} beat marker(s)`
        }).catch(() => {});
    };
    $('#btClear').onclick = () => call('clearBeatMarkers', {}, { success: (r) => `Removed ${r.removed} beat marker(s)` }).catch(() => {});

    window.addEventListener('resize', draw);
    requestAnimationFrame(draw);
})();
