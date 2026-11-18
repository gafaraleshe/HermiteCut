// HermiteCut — Resolve-side actions (main process)
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const LUA = require('./lua.js');
const MOTION = require('../../core/lib/motion.js');

let H = null; // { getResolve, log, app }

// ---------------------------------------------------------------- helpers
const arr = (x) => {
    if (!x) return [];
    if (Array.isArray(x)) return x;
    if (typeof x === 'object') return Object.keys(x).sort((a, b) => (+a) - (+b)).map(k => x[k]);
    return [];
};
const has = (o, m) => { try { return !!o && o[m] !== undefined && o[m] !== null; } catch (e) { return false; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// The JS bridge rejects undefined values, so strip them from option objects.
const clean = (o) => { const r = {}; for (const k of Object.keys(o)) if (o[k] !== undefined && o[k] !== null && !Number.isNaN(o[k])) r[k] = o[k]; return r; };

async function R() { return H.getResolve(); }
async function project() {
    const r = await R();
    const pm = await r.GetProjectManager();
    const p = pm ? await pm.GetCurrentProject() : null;
    if (!p) throw new Error('No project is open in Resolve.');
    return p;
}
async function timeline() {
    const p = await project();
    const t = await p.GetCurrentTimeline();
    if (!t) throw new Error('Open a timeline first.');
    return t;
}
async function settingsOf(t) {
    if (has(t, 'GetSettings')) {
        const s = await t.GetSettings();
        if (s && typeof s === 'object') return s;
    }
    const keys = ['timelineFrameRate', 'timelineResolutionWidth', 'timelineResolutionHeight',
        'timelineDropFrameTimecode', 'timelineInputResMismatchBehavior'];
    const o = {};
    for (const k of keys) { try { o[k] = await t.GetSetting(k); } catch (e) { /* */ } }
    return o;
}
async function geom(t) {
    const s = await settingsOf(t);
    const fpsRaw = String(s.timelineFrameRate || '24');
    const fps = parseFloat(fpsRaw) || 24;
    const df = /DF/i.test(fpsRaw) || String(s.timelineDropFrameTimecode) === '1';
    return {
        fps, df,
        W: parseInt(s.timelineResolutionWidth, 10) || 1920,
        H: parseInt(s.timelineResolutionHeight, 10) || 1080,
        mismatch: s.timelineInputResMismatchBehavior || 'scaleToFit',
        start: await t.GetStartFrame()
    };
}
function tcToFrames(tc, fps, df) {
    if (!tc) return 0;
    const parts = String(tc).split(/[:;.]/).map(n => parseInt(n, 10) || 0);
    while (parts.length < 4) parts.unshift(0);
    const [h, m, s, f] = parts;
    const nom = Math.round(fps);
    let frames = ((h * 3600) + (m * 60) + s) * nom + f;
    if (df || String(tc).includes(';')) {
        const drop = Math.round(fps * 0.066666);
        const totalMin = 60 * h + m;
        frames -= drop * (totalMin - Math.floor(totalMin / 10));
    }
    return frames;
}
function framesToTc(frames, fps, df) {
    const nom = Math.round(fps);
    let f = Math.max(0, Math.round(frames));
    if (df) {
        // SMPTE drop-frame: skip frame numbers 0/1 (0-3 at 59.94) each minute except every 10th
        const drop = Math.round(fps * 0.066666);
        const per10 = Math.round(fps * 600);
        const per1 = nom * 60 - drop;
        const d = Math.floor(f / per10), m = f % per10;
        f += 9 * drop * d + (m > drop ? drop * Math.floor((m - drop) / per1) : 0);
    }
    const ff = f % nom, tot = Math.floor(f / nom);
    const s = tot % 60, m = Math.floor(tot / 60) % 60, h = Math.floor(tot / 3600);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(h)}:${p(m)}:${p(s)}${df ? ';' : ':'}${p(ff)}`;
}
async function playhead(t, g) {
    const tc = await t.GetCurrentTimecode();
    return tcToFrames(tc, g.fps, g.df); // absolute frame number
}
async function selected(t, opts) {
    opts = opts || {};
    let items = [];
    if (has(t, 'GetSelectedClips')) items = arr(await t.GetSelectedClips());
    if (!items.length && opts.fallbackCurrent) {
        const cur = await t.GetCurrentVideoItem();
        if (cur) items = [cur];
    }
    if (opts.type) {
        const out = [];
        for (const it of items) {
            let ty = '';
            try { ty = has(it, 'GetType') ? await it.GetType() : ''; } catch (e) { ty = ''; }
            if (!ty || opts.type.includes(ty)) out.push(it);
        }
        items = out;
    }
    if (!items.length && opts.required !== false) {
        throw new Error(opts.message || 'Select one or more clips on the timeline first.');
    }
    return items;
}
async function getProps(item, keys) {
    if (has(item, 'GetProperties')) {
        const p = await item.GetProperties();
        if (p && typeof p === 'object') return p;
    }
    const o = {};
    for (const k of keys) { try { o[k] = await item.GetProperty(k); } catch (e) { /* */ } }
    return o;
}
async function setProps(item, obj) {
    if (has(item, 'SetProperties')) {
        const ok = await item.SetProperties(obj);
        if (ok) return true;
    }
    let ok = true;
    for (const k of Object.keys(obj)) {
        try { ok = (await item.SetProperty(k, obj[k])) && ok; } catch (e) { ok = false; }
    }
    return ok;
}
// Resolve scripting constants (values from DaVinci Resolve 21.2). The JavaScript bridge
// does not expose resolve.* constants, so they are listed here.
const CONST = {"COMPOSITE_NORMAL": 0, "COMPOSITE_ADD": 1, "COMPOSITE_SUBTRACT": 2, "COMPOSITE_DIFF": 3, "COMPOSITE_MULTIPLY": 4, "COMPOSITE_SCREEN": 5, "COMPOSITE_OVERLAY": 6, "COMPOSITE_HARDLIGHT": 7, "COMPOSITE_SOFTLIGHT": 8, "COMPOSITE_DARKEN": 9, "COMPOSITE_LIGHTEN": 10, "COMPOSITE_COLOR_DODGE": 11, "COMPOSITE_COLOR_BURN": 12, "AUTO_CAPTION_AUTO": 0, "AUTO_CAPTION_MANDARIN_SIMPLIFIED": 1, "AUTO_CAPTION_DUTCH": 2, "AUTO_CAPTION_ENGLISH": 3, "AUTO_CAPTION_FINNISH": 4, "AUTO_CAPTION_FRENCH": 5, "AUTO_CAPTION_GERMAN": 6, "AUTO_CAPTION_HINDI": 7, "AUTO_CAPTION_INDONESIAN": 8, "AUTO_CAPTION_ITALIAN": 9, "AUTO_CAPTION_JAPANESE": 10, "AUTO_CAPTION_KOREAN": 11, "AUTO_CAPTION_MALAY": 12, "AUTO_CAPTION_NORWEGIAN": 13, "AUTO_CAPTION_POLISH": 14, "AUTO_CAPTION_PORTUGUESE": 15, "AUTO_CAPTION_ROMANIAN": 16, "AUTO_CAPTION_RUSSIAN": 17, "AUTO_CAPTION_SPANISH": 18, "AUTO_CAPTION_SWEDISH": 19, "AUTO_CAPTION_TURKISH": 20, "AUTO_CAPTION_VIETNAMESE": 21, "AUTO_CAPTION_TAMIL": 22, "AUTO_CAPTION_THAI": 23, "AUTO_CAPTION_DANISH": 24, "AUTO_CAPTION_MANDARIN_TRADITIONAL": 25, "AUTO_CAPTION_ARABIC": 29, "AUTO_CAPTION_CANTONESE": 41, "AUTO_CAPTION_CZECH": 43, "AUTO_CAPTION_GREEK": 48, "AUTO_CAPTION_HEBREW": 53, "AUTO_CAPTION_HUNGARIAN": 54, "AUTO_CAPTION_PERSIAN": 78, "AUTO_CAPTION_SWAHILI": 89, "AUTO_CAPTION_TAGALOG": 91, "AUTO_CAPTION_UKRAINIAN": 96, "AUTO_CAPTION_URDU": 97, "AUTO_CAPTION_SUBTITLE_DEFAULT": 0, "AUTO_CAPTION_TELETEXT": 1, "AUTO_CAPTION_NETFLIX": 2, "AUTO_CAPTION_LINE_SINGLE": 1, "AUTO_CAPTION_LINE_DOUBLE": 2, "EXPORT_AAF": 0, "EXPORT_DRT": 1, "EXPORT_EDL": 2, "EXPORT_FCP_7_XML": 3, "EXPORT_FCPXML_1_8": 4, "EXPORT_FCPXML_1_9": 5, "EXPORT_FCPXML_1_10": 6, "EXPORT_TEXT_CSV": 10, "EXPORT_TEXT_TAB": 11, "EXPORT_OTIO": 15, "EXPORT_ALE": 16, "EXPORT_NONE": -1, "NORMALIZE_AUDIO_SET_LEVEL_RELATIVE": 0, "NORMALIZE_AUDIO_SET_LEVEL_INDEPENDENT": 1, "SCALE_USE_PROJECT": 0, "SCALE_CROP": 1, "SCALE_FIT": 2, "SCALE_FILL": 3, "SCALE_STRETCH": 4};
async function constant(name, fallback) {
    if (Object.prototype.hasOwnProperty.call(CONST, name)) return CONST[name];
    try {
        const r = await R();
        const v = await r[name];
        if (v !== undefined && v !== null && typeof v !== 'function') return v;
    } catch (e) { /* */ }
    return fallback;
}
async function trackOf(item) {
    try {
        const ti = arr(await item.GetTrackTypeAndIndex());
        return { type: ti[0], index: +ti[1] };
    } catch (e) { return { type: 'video', index: 1 }; }
}

// ---------------------------------------------------------------- Fusion bridge
let luaSeq = 0;
// Calls whose native return value is void make the JS bridge throw
// "Parse - Unknown object type"; the call itself still ran, so ignore that.
async function voidCall(fn) {
    try { return await fn(); } catch (e) {
        if (/Unknown object type/i.test(String(e && e.message))) return undefined;
        throw e;
    }
}
async function runLua(comp, script, timeoutMs) {
    // comp:Execute() runs asynchronously inside Fusion, so poll for the script's reply,
    // matched by a per-call token.
    if (!comp) throw new Error('No Fusion composition available.');
    const token = 'hc' + Date.now().toString(36) + (++luaSeq);
    await voidCall(() => comp.Execute(script.split('__HCTOKEN__').join(token)));
    const t0 = Date.now();
    const limit = timeoutMs || 20000;
    let wait = 15;
    while (Date.now() - t0 < limit) {
        let r = '';
        try { r = String((await comp.GetData('HermiteCut.r')) || ''); } catch (e) { r = ''; }
        if (r.startsWith(token + '|')) {
            r = r.slice(token.length + 1);
            if (r.startsWith('ERR:')) throw new Error('Fusion: ' + r.slice(4));
            if (r.startsWith('OK:')) return r.slice(3);
        }
        await sleep(wait);
        wait = Math.min(120, wait + 10);
    }
    throw new Error('Fusion did not answer in time (is a modal dialog open in Resolve?).');
}
async function currentComp() {
    const r = await R();
    let fu = null;
    try { fu = await r.Fusion(); } catch (e) { fu = null; }
    if (fu) {
        try { const c = await fu.CurrentComp; if (c && typeof c === 'object') return c; } catch (e) { /* */ }
        try { if (typeof fu.GetCurrentComp === 'function') { const c = await fu.GetCurrentComp(); if (c) return c; } } catch (e) { /* */ }
    }
    // Fallback: the clip under the playhead (what the Fusion page shows)
    try {
        const t = await timeline();
        const it = await t.GetCurrentVideoItem();
        if (it) { const cs = await compsForItem(it, false); if (cs.length) return cs[0]; }
    } catch (e) { /* */ }
    return null;
}
async function compsForItem(item, create) {
    const n = has(item, 'GetFusionCompCount') ? (await item.GetFusionCompCount()) || 0 : 0;
    const out = [];
    for (let i = 1; i <= n; i++) {
        const c = await item.GetFusionCompByIndex(i);
        if (c) out.push(c);
    }
    if (!out.length && create) {
        const c = await item.AddFusionComp();
        if (c) out.push(c);
    }
    return out;
}
// Targets for Ease / Bounce: Fusion page -> current comp; otherwise selected clips' comps
async function keyframeTargets() {
    const r = await R();
    const page = await r.GetCurrentPage();
    if (page === 'fusion') {
        const c = await currentComp();
        if (!c) throw new Error('No Fusion composition is open.');
        return { page, comps: [c], selectedOnly: true };
    }
    const t = await timeline();
    const items = await selected(t, { message: 'Select clips with Fusion keyframes (or switch to the Fusion page and select nodes).' });
    const comps = [];
    for (const it of items) comps.push(...await compsForItem(it, false));
    if (!comps.length) throw new Error('The selected clips have no Fusion compositions / keyframes.');
    return { page, comps, selectedOnly: false };
}

// ---------------------------------------------------------------- API
const api = {};

api.status = async () => {
    const r = await R();
    const out = { connected: true, page: await r.GetCurrentPage(), version: '' };
    try { out.version = await r.GetVersionString(); } catch (e) { /* */ }
    const pm = await r.GetProjectManager();
    const p = pm ? await pm.GetCurrentProject() : null;
    if (!p) return out;
    out.project = await p.GetName();
    const t = await p.GetCurrentTimeline();
    if (!t) return out;
    out.timeline = await t.GetName();
    const g = await geom(t);
    out.fps = g.fps; out.width = g.W; out.height = g.H;
    try { out.tc = await t.GetCurrentTimecode(); } catch (e) { /* */ }
    try { out.selected = arr(await t.GetSelectedClips()).length; } catch (e) { out.selected = 0; }
    return out;
};

api.openPage = async ({ page }) => (await R()).OpenPage(page);

// ---------- Ease / Bounce (Fusion keyframes)
api.easeKeys = async ({ curve, allIfNone }) => {
    const tg = await keyframeTargets();
    let segs = 0, splines = 0;
    for (const c of tg.comps) {
        const res = await runLua(c, LUA.ease(curve, tg.selectedOnly ? !!allIfNone : true));
        const [a, b] = res.split(',').map(Number);
        segs += a || 0; splines += b || 0;
    }
    if (!splines) throw new Error(tg.selectedOnly ? 'No animated parameters on the selected nodes. Select keyframed nodes in the Fusion page.' : 'No keyframes found in the selected clips\' Fusion comps.');
    return { segments: segs, splines, comps: tg.comps.length };
};

api.bounceKeys = async ({ spring, allIfNone }) => {
    const tg = await keyframeTargets();
    const samples = MOTION.springSamples(spring, 160);
    let segs = 0, splines = 0;
    for (const c of tg.comps) {
        const res = await runLua(c, LUA.bounce(samples, tg.selectedOnly ? !!allIfNone : true));
        const [a, b] = res.split(',').map(Number);
        segs += a || 0; splines += b || 0;
    }
    if (!segs) throw new Error('Need at least two keyframes with different values on the selected nodes.');
    return { segments: segs, splines };
};

// ---------- Motion (clip animation via Fusion Transform)
api.clipMotion = async (p) => {
    const t = await timeline();
    const items = await selected(t, { type: ['video', 'generator', ''], fallbackCurrent: false });
    let done = 0; const errors = [];
    for (const it of items) {
        try {
            const comps = await compsForItem(it, true);
            const c = comps[0];
            const rng = (await runLua(c, LUA.info())).split(',').map(Number);
            const spec = MOTION.buildMotion(Object.assign({}, p, { s: rng[0], e: rng[1] }));
            await runLua(c, LUA.motion(spec));
            done++;
        } catch (e) { errors.push(e.message); }
    }
    if (!done) throw new Error(errors[0] || 'Could not animate the selected clips.');
    return { done, errors };
};

api.removeMotion = async () => {
    const t = await timeline();
    const items = await selected(t);
    let n = 0;
    for (const it of items) {
        for (const c of await compsForItem(it, false)) n += +(await runLua(c, LUA.removeMotion())) || 0;
    }
    return { removed: n };
};

api.fades = async ({ fadeIn, fadeOut }) => {
    const t = await timeline();
    const items = await selected(t);
    let n = 0;
    for (const it of items) {
        if (!has(it, 'SetFades')) throw new Error('This Resolve version does not support fades via scripting.');
        const cur = (await it.GetFades()) || {};
        const v = { FadeIn: fadeIn == null ? (cur.FadeIn || 0) : fadeIn, FadeOut: fadeOut == null ? (cur.FadeOut || 0) : fadeOut };
        if (await it.SetFades(v)) n++;
    }
    return { done: n };
};

// ---------- Align
async function itemBox(it, g) {
    const props = await getProps(it, ['Pan', 'Tilt', 'ZoomX', 'ZoomY', 'Scaling', 'CropLeft', 'CropRight', 'CropTop', 'CropBottom', 'RotationAngle']);
    let cw = g.W, ch = g.H;
    try {
        const mpi = await it.GetMediaPoolItem();
        if (mpi) {
            const res = String((await mpi.GetClipProperty('Resolution')) || '');
            const m = res.match(/(\d+)\s*[x×]\s*(\d+)/);
            if (m) { cw = +m[1]; ch = +m[2]; }
        }
    } catch (e) { /* */ }
    // Base size of the image at zoom 1.0 inside the timeline frame
    const SC = {
        crop: await constant('SCALE_CROP', 1), fit: await constant('SCALE_FIT', 2),
        fill: await constant('SCALE_FILL', 3), stretch: await constant('SCALE_STRETCH', 4)
    };
    let mode = g.mismatch;
    const sc = props.Scaling;
    if (sc === SC.crop) mode = 'centerCrop';
    else if (sc === SC.fit) mode = 'scaleToFit';
    else if (sc === SC.fill) mode = 'scaleToCrop';
    else if (sc === SC.stretch) mode = 'stretch';
    let bw, bh;
    if (mode === 'stretch') { bw = g.W; bh = g.H; }
    else if (mode === 'centerCrop') { bw = cw; bh = ch; }
    else {
        const s = (mode === 'scaleToCrop' ? Math.max : Math.min)(g.W / cw, g.H / ch);
        bw = cw * s; bh = ch * s;
    }
    const zx = props.ZoomX == null ? 1 : +props.ZoomX;
    const zy = props.ZoomY == null ? zx : +props.ZoomY;
    // Resolve units (measured on 21.2): Pan px = Pan * bw/W, Tilt px = Tilt * bh/H,
    // crop px on screen = Crop * zoom * bh/H (crop is in "image scaled to timeline height" pixels)
    const kx = bw / g.W, ky = bh / g.H, kc = bh / g.H;
    const c = (k) => +(props[k] || 0);
    const cl = c('CropLeft') * zx * kc, cr = c('CropRight') * zx * kc, ct = c('CropTop') * zy * kc, cb = c('CropBottom') * zy * kc;
    return { props, bw, bh, zx, zy, w: bw * zx, h: bh * zy, cw, ch, kx, ky, kc, cl, cr, ct, cb };
}

api.align = async ({ anchor, margin }) => {
    // anchor: 'tl','t','tr','l','c','r','bl','b','br' ; margin in % of the shorter frame side
    const t = await timeline();
    const g = await geom(t);
    const items = await selected(t, { type: ['video', 'generator', ''] });
    const m = (margin || 0) / 100 * Math.min(g.W, g.H);
    let n = 0;
    for (const it of items) {
        const b = await itemBox(it, g);
        const hx = /l/.test(anchor) ? -1 : /r/.test(anchor) ? 1 : 0;
        const vy = anchor.startsWith('t') ? 1 : anchor.startsWith('b') ? -1 : 0;
        // visible box relative to the image centre (screen px, y up)
        const visL = -b.w / 2 + b.cl, visR = b.w / 2 - b.cr;
        const visT = b.h / 2 - b.ct, visB = -b.h / 2 + b.cb;
        let dx = 0, dy = 0;
        if (hx < 0) dx = (-g.W / 2 + m) - visL;
        else if (hx > 0) dx = (g.W / 2 - m) - visR;
        else dx = -(visL + visR) / 2;
        if (vy > 0) dy = (g.H / 2 - m) - visT;
        else if (vy < 0) dy = (-g.H / 2 + m) - visB;
        else dy = -(visT + visB) / 2;
        const set = { Pan: dx / b.kx, Tilt: dy / b.ky };
        if (await setProps(it, set)) n++;
    }
    return { done: n };
};

api.transform = async ({ op, value }) => {
    const t = await timeline();
    const g = await geom(t);
    const items = await selected(t, { type: ['video', 'generator', ''] });
    let n = 0;
    for (const it of items) {
        const b = await itemBox(it, g);
        let set = null;
        switch (op) {
            case 'fit': { const z = Math.min(g.W / b.bw, g.H / b.bh); set = { ZoomX: z, ZoomY: z, Pan: 0, Tilt: 0 }; break; }
            case 'fill': { const z = Math.max(g.W / b.bw, g.H / b.bh); set = { ZoomX: z, ZoomY: z, Pan: 0, Tilt: 0 }; break; }
            case 'reset': set = { ZoomX: 1, ZoomY: 1, Pan: 0, Tilt: 0, RotationAngle: 0, AnchorPointX: 0, AnchorPointY: 0, Pitch: 0, Yaw: 0, FlipX: false, FlipY: false, CropLeft: 0, CropRight: 0, CropTop: 0, CropBottom: 0 }; break;
            case 'flipH': set = { FlipX: !b.props.FlipX }; break;
            case 'flipV': set = { FlipY: !b.props.FlipY }; break;
            case 'scale': { const z = Math.max(0.01, b.zx * value); set = { ZoomX: z, ZoomY: Math.max(0.01, b.zy * value) }; break; }
            case 'zoom': set = { ZoomX: value, ZoomY: value }; break;
            case 'rotate': set = { RotationAngle: ((+b.props.RotationAngle || 0) + value + 540) % 360 - 180 }; break;
            case 'nudge': set = { Pan: (+b.props.Pan || 0) + (value[0] || 0) / b.kx, Tilt: (+b.props.Tilt || 0) + (value[1] || 0) / b.ky }; break;
            case 'opacity': set = { Opacity: value }; break;
            case 'composite': set = { CompositeMode: await constant(value, 0) }; break;
        }
        if (set && await setProps(it, set)) n++;
    }
    return { done: n };
};

api.layout = async ({ kind, gap }) => {
    const t = await timeline();
    const g = await geom(t);
    let items = await selected(t, { type: ['video', 'generator', ''] });
    // top track first, then by start
    const meta = [];
    for (const it of items) meta.push({ it, tr: await trackOf(it), st: await it.GetStart() });
    meta.sort((a, b) => (b.tr.index - a.tr.index) || (a.st - b.st));
    items = meta.map(m => m.it);
    const gp = (gap || 0) / 100 * g.W;
    const cells = {
        split2v: [[0, 0, .5, 1], [.5, 0, .5, 1]],
        split2h: [[0, 0, 1, .5], [0, .5, 1, .5]],
        split3: [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]],
        grid4: [[0, 0, .5, .5], [.5, 0, .5, .5], [0, .5, .5, .5], [.5, .5, .5, .5]],
        pipTR: [[.62, .05, .33, .33]], pipTL: [[.05, .05, .33, .33]],
        pipBR: [[.62, .62, .33, .33]], pipBL: [[.05, .62, .33, .33]]
    }[kind];
    if (!cells) throw new Error('Unknown layout');
    let n = 0;
    for (let i = 0; i < items.length && i < cells.length; i++) {
        const it = items[i];
        const [cx, cy, cw, chh] = cells[i];
        const W = cw * g.W - gp, Hh = chh * g.H - gp;
        const b = await itemBox(it, g);
        // fill the cell, crop the overflow
        const z = Math.max(W / b.bw, Hh / b.bh);
        const dw = b.bw * z, dh = b.bh * z;
        const ox = Math.max(0, (dw - W) / 2) / (z * b.kc), oy = Math.max(0, (dh - Hh) / 2) / (z * b.kc);
        const px = (cx + cw / 2) * g.W - g.W / 2, py = g.H / 2 - (cy + chh / 2) * g.H;
        const set = {
            ZoomX: z, ZoomY: z,
            Pan: px / b.kx, Tilt: py / b.ky,
            CropLeft: ox, CropRight: ox, CropTop: oy, CropBottom: oy
        };
        if (await setProps(it, set)) n++;
    }
    return { done: n, used: Math.min(items.length, cells.length), needed: cells.length };
};

const TRANSFORM_KEYS = ['Pan', 'Tilt', 'ZoomX', 'ZoomY', 'RotationAngle', 'AnchorPointX', 'AnchorPointY', 'Pitch', 'Yaw', 'FlipX', 'FlipY',
    'CropLeft', 'CropRight', 'CropTop', 'CropBottom', 'CropSoftness', 'Opacity', 'CompositeMode'];
api.copyTransform = async () => {
    const t = await timeline();
    const [it] = await selected(t, { fallbackCurrent: true });
    const p = await getProps(it, TRANSFORM_KEYS);
    const out = {};
    for (const k of TRANSFORM_KEYS) if (p[k] !== undefined && p[k] !== null) out[k] = p[k];
    return { props: out, name: await it.GetName() };
};
api.pasteTransform = async ({ props }) => {
    const t = await timeline();
    const items = await selected(t);
    let n = 0;
    for (const it of items) if (await setProps(it, props)) n++;
    return { done: n };
};

// ---------- Beats
api.audioSource = async () => {
    const t = await timeline();
    const g = await geom(t);
    const items = await selected(t, { message: 'Select a clip with audio on the timeline.' });
    // prefer audio items
    let pick = null;
    for (const it of items) { if ((await it.GetType()) === 'audio') { pick = it; break; } }
    if (!pick) pick = items[0];
    const mpi = await pick.GetMediaPoolItem();
    if (!mpi) throw new Error('The selected item has no source media (titles/generators have no audio).');
    const file = await mpi.GetClipProperty('File Path');
    if (!file) throw new Error('Could not find the media file for this clip.');
    let speed = 100;
    try { const sp = await pick.GetSpeed(); if (sp && sp.Percentage) speed = +sp.Percentage; } catch (e) { /* */ }
    let srcStart = null, srcEnd = null;
    try { srcStart = await pick.GetSourceStartTime(); srcEnd = await pick.GetSourceEndTime(); } catch (e) { /* */ }
    if (srcStart == null || isNaN(srcStart)) {
        const clipFps = parseFloat(await mpi.GetClipProperty('FPS')) || g.fps;
        srcStart = (await pick.GetSourceStartFrame()) / clipFps;
        srcEnd = (await pick.GetSourceEndFrame()) / clipFps;
    }
    const start = await pick.GetStart();
    const end = await pick.GetEnd();
    return {
        file, name: await pick.GetName(), uid: await pick.GetUniqueId(),
        type: await pick.GetType(), start, end, srcStart: +srcStart, srcEnd: +srcEnd,
        speed, fps: g.fps, tlStart: g.start
    };
};

api.playhead = async () => {
    const t = await timeline();
    const g = await geom(t);
    return { frame: await playhead(t, g), fps: g.fps, start: g.start };
};

const BEAT_TAG = 'hermitecut-beat';
const LEGACY_BEAT_TAG = 'editkit-beat'; // markers made by the pre-release build
api.addBeatMarkers = async ({ frames, color, name, target, uid }) => {
    // frames: absolute timeline frame numbers
    const t = await timeline();
    const g = await geom(t);
    let item = null;
    if (target === 'clip' && uid) {
        for (const it of await selected(t, { required: false })) if ((await it.GetUniqueId()) === uid) item = it;
        if (!item) throw new Error('Keep the analysed clip selected to add clip markers.');
    }
    let n = 0;
    const existing = item ? (await item.GetMarkers()) || {} : (await t.GetMarkers()) || {};
    let itemStart = 0, itemSrc = 0;
    if (item) { itemStart = await item.GetStart(); itemSrc = await item.GetLeftOffset(); }
    for (const f of frames) {
        const fid = item ? Math.round(f - itemStart + itemSrc) : Math.round(f - g.start);
        if (fid < 0 || existing[fid] !== undefined) continue;
        const ok = await (item || t).AddMarker(fid, color || 'Lavender', name || 'Beat', '', 1, BEAT_TAG);
        if (ok) n++;
    }
    return { added: n };
};

api.clearBeatMarkers = async () => {
    const t = await timeline();
    let n = 0;
    const del = async (obj) => {
        for (let i = 0; i < 20000; i++) {
            let ok = false;
            try { ok = (await obj.DeleteMarkerByCustomData(BEAT_TAG)) || (await obj.DeleteMarkerByCustomData(LEGACY_BEAT_TAG)); } catch (e) { ok = false; }
            if (!ok) break;
            n++;
        }
    };
    await del(t);
    for (const it of await selected(t, { required: false })) await del(it);
    return { removed: n };
};

// ---------- Captions
const LANGS = {
    auto: 'AUTO_CAPTION_AUTO', en: 'AUTO_CAPTION_ENGLISH', es: 'AUTO_CAPTION_SPANISH', fr: 'AUTO_CAPTION_FRENCH',
    pt: 'AUTO_CAPTION_PORTUGUESE', de: 'AUTO_CAPTION_GERMAN', it: 'AUTO_CAPTION_ITALIAN', nl: 'AUTO_CAPTION_DUTCH',
    ja: 'AUTO_CAPTION_JAPANESE', ko: 'AUTO_CAPTION_KOREAN', zh: 'AUTO_CAPTION_MANDARIN_SIMPLIFIED',
    'zh-tw': 'AUTO_CAPTION_MANDARIN_TRADITIONAL', hi: 'AUTO_CAPTION_HINDI', ru: 'AUTO_CAPTION_RUSSIAN',
    tr: 'AUTO_CAPTION_TURKISH', pl: 'AUTO_CAPTION_POLISH', id: 'AUTO_CAPTION_INDONESIAN', vi: 'AUTO_CAPTION_VIETNAMESE',
    th: 'AUTO_CAPTION_THAI', sv: 'AUTO_CAPTION_SWEDISH', da: 'AUTO_CAPTION_DANISH', no: 'AUTO_CAPTION_NORWEGIAN',
    fi: 'AUTO_CAPTION_FINNISH', ro: 'AUTO_CAPTION_ROMANIAN', ms: 'AUTO_CAPTION_MALAY', ta: 'AUTO_CAPTION_TAMIL',
    ar: 'AUTO_CAPTION_ARABIC', uk: 'AUTO_CAPTION_UKRAINIAN', el: 'AUTO_CAPTION_GREEK', he: 'AUTO_CAPTION_HEBREW',
    cs: 'AUTO_CAPTION_CZECH', hu: 'AUTO_CAPTION_HUNGARIAN', sw: 'AUTO_CAPTION_SWAHILI', ur: 'AUTO_CAPTION_URDU',
    fa: 'AUTO_CAPTION_PERSIAN', tl: 'AUTO_CAPTION_TAGALOG', yue: 'AUTO_CAPTION_CANTONESE'
};
const EXTENDED = new Set(['ar', 'uk', 'el', 'he', 'cs', 'hu', 'sw', 'ur', 'fa', 'tl', 'yue']);

api.createCaptions = async ({ lang, preset, charsPerLine, lines, gap }) => {
    const t = await timeline();
    const s = {};
    const L = LANGS[lang || 'auto'];
    const lv = L ? await constant(L, undefined) : undefined;
    if (lv !== undefined) s.language = lv;
    if (EXTENDED.has(lang)) s.extendedLanguageSupport = true;
    const pv = await constant(preset === 'netflix' ? 'AUTO_CAPTION_NETFLIX' : 'AUTO_CAPTION_SUBTITLE_DEFAULT', undefined);
    if (pv !== undefined) s.captionPreset = pv;
    if (charsPerLine) s.charsPerLine = Math.max(1, Math.min(60, charsPerLine | 0));
    const lb = await constant(lines === 2 ? 'AUTO_CAPTION_LINE_DOUBLE' : 'AUTO_CAPTION_LINE_SINGLE', undefined);
    if (lb !== undefined) s.lineBreak = lb;
    if (gap != null) s.gap = Math.max(0, Math.min(10, gap | 0));
    const ok = await t.CreateSubtitlesFromAudio(clean(s));
    if (!ok) throw new Error('Resolve could not create subtitles. Check that the timeline has audio, and for extended languages that the language pack is installed (Preferences > Speech).');
    return { ok: true };
};
api.captionStatus = async () => {
    const p = await project();
    if (!has(p, 'GetCreateSubtitlesFromAudioStatus')) return null;
    return await p.GetCreateSubtitlesFromAudioStatus();
};
api.importSubtitles = async ({ file }) => {
    const p = await project();
    const mp = await p.GetMediaPool();
    const items = arr(await mp.ImportMedia([file]));
    if (!items.length) throw new Error('Resolve could not import that subtitle file.');
    const appended = arr(await mp.AppendToTimeline([{ mediaPoolItem: items[0] }]));
    return { imported: items.length, appended: appended.length };
};

// ---------- Actions
const COLORS_MARK = ['Blue', 'Cyan', 'Green', 'Yellow', 'Red', 'Pink', 'Purple', 'Fuchsia', 'Rose', 'Lavender', 'Sky', 'Mint', 'Lemon', 'Sand', 'Cocoa', 'Cream'];
const CLIP_COLORS = ['Orange', 'Apricot', 'Yellow', 'Lime', 'Olive', 'Green', 'Teal', 'Navy', 'Blue', 'Purple', 'Violet', 'Pink', 'Tan', 'Beige', 'Brown', 'Chocolate'];

async function eachSelected(fn, opts) {
    const t = await timeline();
    const items = await selected(t, opts);
    let n = 0;
    for (const it of items) { try { if (await fn(it, t)) n++; } catch (e) { H.log('quick: ' + e.message); } }
    return { done: n, of: items.length };
}

api.quick = async ({ id, arg }) => {
    const r = await R();
    switch (id) {
        // --- markers
        case 'marker': {
            const t = await timeline(); const g = await geom(t);
            const f = (await playhead(t, g)) - g.start;
            const ok = await t.AddMarker(f, arg || 'Blue', 'Marker', '', 1);
            if (!ok) throw new Error('A marker already exists at the playhead.');
            return { msg: 'Marker added at ' + (await t.GetCurrentTimecode()) };
        }
        case 'markerClips': {
            const t = await timeline(); const g = await geom(t);
            let n = 0;
            for (const it of await selected(t)) if (await t.AddMarker((await it.GetStart()) - g.start, arg || 'Green', await it.GetName(), '', 1)) n++;
            return { msg: n + ' marker(s) at clip starts' };
        }
        case 'clearMarkers': {
            const t = await timeline();
            await t.DeleteMarkersByColor('All');
            return { msg: 'Timeline markers cleared' };
        }
        case 'clearClipMarkers': {
            const res = await eachSelected(async (it) => it.DeleteMarkersByColor('All'));
            return { msg: 'Markers cleared on ' + res.done + ' clip(s)' };
        }
        // --- speed / timing
        case 'speed': {
            const res = await eachSelected(async (it) => it.SetSpeed({ Percentage: +arg, RippleTimeline: false }), { type: ['video', 'audio', ''] });
            return { msg: 'Speed ' + arg + '% on ' + res.done + ' clip(s)' };
        }
        case 'fadeIn': case 'fadeOut': case 'fadeBoth': case 'fadeNone': {
            const fr = +arg || 12;
            const res = await eachSelected(async (it) => {
                const cur = (await it.GetFades()) || {};
                const v = { FadeIn: cur.FadeIn || 0, FadeOut: cur.FadeOut || 0 };
                if (id === 'fadeIn' || id === 'fadeBoth') v.FadeIn = fr;
                if (id === 'fadeOut' || id === 'fadeBoth') v.FadeOut = fr;
                if (id === 'fadeNone') { v.FadeIn = 0; v.FadeOut = 0; }
                return it.SetFades(v);
            });
            return { msg: 'Fades updated on ' + res.done + ' clip(s)' };
        }
        case 'dissolveIn': case 'dissolveOut': {
            const res = await eachSelected(async (it) => !!(await it.AddTransition(clean({
                type: 'Cross Dissolve', category: 'simple', position: id === 'dissolveIn' ? 'start' : 'end',
                alignment: 'center', duration: +arg || undefined
            }))));
            return { msg: 'Cross dissolve added to ' + res.done + ' clip(s)' };
        }
        case 'dipIn': case 'dipOut': {
            const res = await eachSelected(async (it) => !!(await it.AddTransition({
                type: 'Dip To Color Dissolve', category: 'simple', position: id === 'dipIn' ? 'start' : 'end', alignment: 'center'
            })));
            return { msg: 'Dip to color added to ' + res.done + ' clip(s)' };
        }
        case 'rippleDelete': case 'delete': {
            const t = await timeline();
            const items = await selected(t);
            if (!(await t.DeleteClips(items, id === 'rippleDelete'))) throw new Error('Resolve refused to delete the selection (locked track?).');
            return { msg: items.length + ' clip(s) deleted' };
        }
        case 'deleteGaps': {
            const t = await timeline();
            if (!(await t.DeleteGaps())) throw new Error('No gaps were removed.');
            return { msg: 'Gaps closed' };
        }
        case 'removeSilence': {
            const res = await eachSelected(async (it) => it.RippleDeleteSilence({ threshold: +arg || -40, preHead: 2, postTail: 4 }), { type: ['audio'], message: 'Select audio clips (the audio part of a clip) first.' });
            return { msg: 'Silence removed on ' + res.done + ' clip(s)' };
        }
        // --- clip state
        case 'toggleEnable': {
            const res = await eachSelected(async (it) => it.SetClipEnabled(!(await it.GetClipEnabled())));
            return { msg: 'Toggled ' + res.done + ' clip(s)' };
        }
        case 'link': case 'unlink': {
            const t = await timeline();
            const items = await selected(t);
            await t.SetClipsLinked(items, id === 'link');
            return { msg: (id === 'link' ? 'Linked ' : 'Unlinked ') + items.length + ' clip(s)' };
        }
        case 'compound': {
            const t = await timeline();
            const it = await t.CreateCompoundClip(await selected(t), { name: 'Compound Clip' });
            if (!it) throw new Error('Could not create a compound clip from this selection.');
            return { msg: 'Compound clip created' };
        }
        case 'fusionClip': {
            const t = await timeline();
            const it = await t.CreateFusionClip(await selected(t));
            if (!it) throw new Error('Could not create a Fusion clip from this selection.');
            return { msg: 'Fusion clip created' };
        }
        case 'clipColor': {
            const res = await eachSelected(async (it) => arg === 'none' ? it.ClearClipColor() : it.SetClipColor(arg));
            return { msg: 'Clip color on ' + res.done + ' clip(s)' };
        }
        case 'flag': {
            const res = await eachSelected(async (it) => it.AddFlag(arg || 'Red'));
            return { msg: 'Flagged ' + res.done + ' clip(s)' };
        }
        case 'clearFlags': {
            const res = await eachSelected(async (it) => it.ClearFlags('All'));
            return { msg: 'Flags cleared on ' + res.done + ' clip(s)' };
        }
        // --- insert
        case 'textPlus': case 'title': case 'solid': case 'adjustment': case 'fusionComp': {
            const t = await timeline();
            let it = null;
            if (id === 'textPlus') it = await t.InsertFusionTitleIntoTimeline('Text+');
            if (id === 'title') it = await t.InsertTitleIntoTimeline('Text');
            if (id === 'solid') it = await t.InsertGeneratorIntoTimeline('Solid Color');
            if (id === 'adjustment') {
                it = await t.InsertGeneratorIntoTimeline('Adjustment Clip');
                if (!it) it = await t.InsertFusionGeneratorIntoTimeline('Adjustment Clip');
            }
            if (id === 'fusionComp') it = await t.InsertFusionCompositionIntoTimeline();
            if (!it) throw new Error('Resolve could not insert it here (check the playhead and that a track is free).');
            return { msg: 'Inserted at playhead' };
        }
        // --- audio
        case 'normalize': {
            const t = await timeline();
            const items = await selected(t, { type: ['audio', 'video', ''] });
            const modes = arr(await t.GetNormalizeAudioModes());
            const mode = modes.find(m => /YouTube|EBU|ITU/i.test(m)) || modes[0];
            const ok = await t.NormalizeAudioLevel(items, clean({ normalizationMode: mode, targetLoudness: +arg || -14, setLevelMode: await constant('NORMALIZE_AUDIO_SET_LEVEL_INDEPENDENT', undefined) }));
            if (!ok) throw new Error('Normalize failed for this selection.');
            return { msg: 'Normalized to ' + (arg || -14) + ' LUFS (' + mode + ')' };
        }
        case 'voiceIsolation': {
            const res = await eachSelected(async (it) => it.SetVoiceIsolationState({ isEnabled: true, amount: +arg || 80 }), { type: ['audio'], message: 'Select audio clips first.' });
            return { msg: 'Voice isolation on ' + res.done + ' clip(s)' };
        }
        case 'volume': {
            const res = await eachSelected(async (it) => setProps(it, { AudioVolume: +arg }), { type: ['audio'], message: 'Select audio clips first.' });
            return { msg: 'Volume ' + arg + ' dB on ' + res.done + ' clip(s)' };
        }
        // --- color / AI
        case 'autoColor': {
            const res = await eachSelected(async (it) => it.ApplyAutoColor(), { type: ['video'] });
            return { msg: 'Auto color on ' + res.done + ' clip(s)' };
        }
        case 'stabilize': {
            const res = await eachSelected(async (it) => it.Stabilize(), { type: ['video'] });
            return { msg: 'Stabilized ' + res.done + ' clip(s)' };
        }
        case 'smartReframe': {
            const res = await eachSelected(async (it) => it.SmartReframe(), { type: ['video'] });
            return { msg: 'Smart Reframe on ' + res.done + ' clip(s)' };
        }
        case 'grabStill': {
            const t = await timeline();
            if (!(await t.GrabStill())) throw new Error('Could not grab a still here.');
            return { msg: 'Still grabbed to the Gallery' };
        }
        case 'sceneCuts': {
            const t = await timeline();
            if (!(await t.DetectSceneCuts())) throw new Error('Scene cut detection failed (works on single-clip timelines).');
            return { msg: 'Scene cut detection started' };
        }
        // --- timeline
        case 'addTrack': {
            const t = await timeline();
            const ok = arg === 'audio' ? await t.AddTrack('audio', 'stereo') : await t.AddTrack('video');
            if (!ok) throw new Error('Could not add a track.');
            return { msg: 'Added ' + (arg || 'video') + ' track' };
        }
        case 'deleteEmptyTracks': {
            const t = await timeline(); let n = 0;
            for (const ty of ['video', 'audio']) {
                for (let i = await t.GetTrackCount(ty); i >= 1; i--) {
                    if ((await t.GetTrackCount(ty)) <= 1) break;
                    if (!arr(await t.GetItemListInTrack(ty, i)).length && await t.DeleteTrack(ty, i)) n++;
                }
            }
            return { msg: n + ' empty track(s) removed' };
        }
        case 'lockAll': case 'unlockAll': {
            const t = await timeline();
            for (const ty of ['video', 'audio']) for (let i = 1; i <= await t.GetTrackCount(ty); i++) await t.SetTrackLock(ty, i, id === 'lockAll');
            return { msg: id === 'lockAll' ? 'All tracks locked' : 'All tracks unlocked' };
        }
        case 'duplicateTimeline': {
            const t = await timeline();
            const nt = await t.DuplicateTimeline((await t.GetName()) + ' copy ' + new Date().toTimeString().slice(0, 5).replace(':', ''));
            if (!nt) throw new Error('Could not duplicate the timeline.');
            return { msg: 'Duplicated timeline' };
        }
        case 'goStart': case 'goEnd': {
            const t = await timeline(); const g = await geom(t);
            const f = id === 'goStart' ? g.start : await t.GetEndFrame();
            await t.SetCurrentTimecode(framesToTc(f, g.fps, g.df));
            return { msg: 'Playhead moved' };
        }
        case 'nudgePlayhead': {
            const t = await timeline(); const g = await geom(t);
            const f = Math.max(g.start, (await playhead(t, g)) + (+arg || 0));
            await t.SetCurrentTimecode(framesToTc(f, g.fps, g.df));
            return { msg: 'Playhead ' + (arg > 0 ? '+' : '') + arg + 'f' };
        }
        case 'nextMarker': case 'prevMarker': {
            const t = await timeline(); const g = await geom(t);
            const ph = (await playhead(t, g)) - g.start;
            const ks = Object.keys((await t.GetMarkers()) || {}).map(Number).sort((a, b) => a - b);
            const k = id === 'nextMarker' ? ks.find(x => x > ph) : ks.reverse().find(x => x < ph);
            if (k === undefined) throw new Error('No more markers that way.');
            await t.SetCurrentTimecode(framesToTc(k + g.start, g.fps, g.df));
            return { msg: 'Jumped to marker' };
        }
        case 'markInOutSelection': {
            const t = await timeline(); const g = await geom(t);
            const items = await selected(t);
            let a = Infinity, b = -Infinity;
            for (const it of items) { a = Math.min(a, await it.GetStart()); b = Math.max(b, await it.GetEnd()); }
            await t.SetMarkInOut(a - g.start, b - g.start - 1);
            return { msg: 'In/Out set around selection' };
        }
        case 'clearInOut': { const t = await timeline(); await t.ClearMarkInOut(); return { msg: 'In/Out cleared' }; }
        case 'save': {
            const pm = await r.GetProjectManager();
            if (!(await pm.SaveProject())) throw new Error('Project could not be saved.');
            return { msg: 'Project saved' };
        }
        case 'page': { await r.OpenPage(arg); return { msg: 'Opened ' + arg + ' page' }; }
        default:
            throw new Error('Unknown action ' + id);
    }
};

// ---------- Delivery
api.renderPresets = async () => {
    const p = await project();
    const fn = has(p, 'GetRenderPresetList') ? 'GetRenderPresetList' : 'GetRenderPresets';
    return arr(await p[fn]());
};
api.queueRender = async ({ preset, dir, name, start, inOut }) => {
    const p = await project();
    const t = await timeline();
    if (preset && !(await p.LoadRenderPreset(preset))) throw new Error('Could not load render preset "' + preset + '".');
    const s = {};
    if (dir) s.TargetDir = dir;
    if (name) s.CustomName = name;
    if (!inOut) s.SelectAllFrames = true;
    if (Object.keys(s).length) await p.SetRenderSettings(s);
    const job = await p.AddRenderJob();
    if (!job) throw new Error('Could not add the render job (check the render settings).');
    if (start) await p.StartRendering([job]);
    return { job, started: !!start, timeline: await t.GetName() };
};
api.exportStill = async ({ file }) => {
    const p = await project();
    if (!(await p.ExportCurrentFrameAsStill(file))) throw new Error('Export failed. Open the Color page once, then try again.');
    return { file };
};
api.exportTimeline = async ({ file, kind }) => {
    const t = await timeline();
    const map = { fcpxml: 'EXPORT_FCPXML_1_10', xml: 'EXPORT_FCP_7_XML', edl: 'EXPORT_EDL', otio: 'EXPORT_OTIO', csv: 'EXPORT_TEXT_CSV', drt: 'EXPORT_DRT' };
    const ty = await constant(map[kind] || 'EXPORT_FCPXML_1_10', undefined);
    const st = await constant('EXPORT_NONE', undefined);
    if (ty === undefined) throw new Error('This export type is not available.');
    if (!(await t.Export(file, ty, st))) throw new Error('Timeline export failed.');
    return { file };
};
api.desktopPath = async ({ name }) => path.join(os.homedir(), 'Desktop', name || '');

require('./studio.js').register(api, {
    get H() { return H; }, R, project, timeline, selected, runLua, voidCall, arr, has, clean, geom, playhead,
    framesToTc, tcToFrames, compsForItem, trackOf, LUA, sleep
});

module.exports = {
    init(h) { H = h; },
    api,
    _test: { tcToFrames, framesToTc }
};
