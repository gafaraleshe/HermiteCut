// HermiteCut 2 — Resolve actions for the new modules: templates (effects,
// time FX, transitions, titles, Grid Reveal), Sound, Library, Captions+,
// Shorts and Setup. Registered onto the adapter's `api` by adapter.js.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const ASSETS = require('../../core/lib/assets.js');

// The Rust engine (crates/hc-node, loaded by core/lib/engine.ts) when this
// build ships it; the JavaScript implementations otherwise. Both give the
// same results (core/lib/engine.test.ts).
let ENGINE = null;
let engineInfo = () => ({ engine: 'js', version: null, reason: 'engine.js is not in this build' });
try {
    const E = require('../../core/lib/engine.js');
    ENGINE = E.engine();
    engineInfo = E.engineInfo;
} catch (e) { /* an older or dev build without the compiled engine */ }

function register(api, h) {
    const res = (...p) => path.join(h.H.resourcesDir || '', ...p);
    const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };

    // ------------------------------------------------------------ catalogue
    api.engineInfo = async () => engineInfo();
    api.catalogue = async () => {
        if (ENGINE) return ENGINE.catalogue(res());
        const m = readJson(res('HermiteCut-manifest.json'), { templates: [] });
        const sfx = readJson(res('sfx', 'sfx.json'), { sounds: [] });
        return { templates: m.templates, version: m.version, sounds: sfx.sounds, sfxDir: res('sfx') };
    };

    // ------------------------------------------------------------ templates
    api.applyEffect = async ({ id, values }) => {
        const t = await h.timeline();
        const items = await h.selected(t, { type: ['video', ''] });
        let done = 0; const errors = [];
        for (const it of items) {
            try {
                if (!h.has(it, 'AddEffect')) throw new Error('This Resolve version cannot add effects from scripts (needs 20+).');
                if (!(await it.AddEffect('fusion', id))) throw new Error('Resolve refused the effect. Is the template pack installed (Setup) and Resolve restarted?');
                if (values && Object.keys(values).length) {
                    const comps = await h.compsForItem(it, false);
                    const comp = comps[comps.length - 1];
                    if (comp) await h.runLua(comp, h.LUA.setTemplateInputs('Mode', values)).catch(() => 0);
                }
                done++;
            } catch (e) { errors.push(e.message); }
        }
        if (!done) throw new Error(errors[0] || 'Nothing was applied.');
        return { done, msg: 'Applied to ' + done + ' clip(s)' };
    };

    api.removeEffects = async () => {
        const t = await h.timeline();
        const items = await h.selected(t);
        let n = 0;
        for (const it of items) {
            if (!h.has(it, 'GetEffects')) continue;
            const effects = h.arr(await it.GetEffects()).filter(e => /HermiteCut/i.test(String(e && (e.name || e.id || e))));
            if (effects.length && await it.DeleteEffects(effects)) n += effects.length;
        }
        return { removed: n, msg: n ? 'Removed ' + n + ' HermiteCut effect(s)' : 'No HermiteCut effects on the selection' };
    };

    api.addTransition = async ({ name, id, frames, position }) => {
        const t = await h.timeline();
        const items = await h.selected(t, { type: ['video', ''] });
        const types = [name, 'HermiteCut/' + name, id].filter(Boolean);
        let done = 0;
        for (const it of items) {
            for (const type of types) {
                const opts = h.clean({ type, category: 'fusion', position: position || 'end', alignment: 'center', duration: frames || 20 });
                if (await it.AddTransition(opts).catch(() => false)) { done++; break; }
            }
        }
        if (!done) throw new Error('No transition added. Select the clip before a cut, and trim clips so they have handles.');
        return { done, msg: 'Transition added to ' + done + ' cut(s)' };
    };

    // Titles insert with ripple on V1 at the playhead, so insert past the end
    // of the timeline and move the title into place on a free track.
    api.insertTitle = async ({ name, at, values, frames, startFrame }) => {
        const t = await h.timeline();
        const g = await h.geom(t);
        let target = await h.playhead(t, g);
        if (at === 'frame' && typeof startFrame === 'number') target = startFrame;
        if (at === 'clip') {
            const sel = await h.selected(t, { required: false });
            if (sel.length) target = await sel[0].GetStart();
        }
        const end = await t.GetEndFrame();
        await t.SetCurrentTimecode(h.framesToTc(end + g.fps * 2, g.fps, g.df));
        const item = await t.InsertFusionTitleIntoTimeline(name);
        if (!item) throw new Error('Resolve could not insert "' + name + '". Is the template pack installed?');
        let track = Math.max(2, (await t.GetTrackCount('video')) + 1);
        if (h.has(t, 'AddTrack')) await h.voidCall(() => t.AddTrack('video'));
        if (h.has(item, 'SetPosition')) await h.voidCall(() => item.SetPosition({ trackIndex: track, startFrame: target }));
        if (frames && h.has(item, 'SetRightOffset')) await h.voidCall(() => item.SetRightOffset(Math.max(0, 150 - frames)));
        if (values && Object.keys(values).length) {
            const comps = await h.compsForItem(item, false);
            if (comps[0]) await h.runLua(comps[0], h.LUA.setTemplateInputs('InStyle', values)).catch(() => 0);
        }
        await t.SetCurrentTimecode(h.framesToTc(target, g.fps, g.df));
        return { msg: name + ' added on V' + track };
    };

    // ------------------------------------------------------------ sound
    async function bin(mp, name) {
        const root = await mp.GetRootFolder();
        for (const f of h.arr(await root.GetSubFolderList())) if ((await f.GetName()) === name) return f;
        return mp.AddSubFolder(root, name);
    }
    async function importFile(p, file, binName) {
        const mp = await p.GetMediaPool();
        const folder = await bin(mp, binName);
        if (folder) await mp.SetCurrentFolder(folder);
        const items = h.arr(await mp.ImportMedia([file]));
        if (!items.length) throw new Error('Resolve could not import ' + path.basename(file) + '.');
        return { mp, item: items[0] };
    }
    async function positions(t, g, where) {
        if (where === 'markers') {
            const m = (await t.GetMarkers()) || {};
            const s = await t.GetStartFrame();
            return Object.keys(m).map(k => s + Number(k));
        }
        if (where === 'cuts') {
            const items = await h.selected(t, { message: 'Select the clips whose cuts should get the sound.' });
            const out = new Set();
            for (const it of items) { out.add(await it.GetStart()); out.add(await it.GetEnd()); }
            return [...out].sort((a, b) => a - b);
        }
        return [await h.playhead(t, g)];
    }
    async function freeAudioTrack(t) {
        const n = await t.GetTrackCount('audio');
        for (let i = 1; i <= n; i++) if (!h.arr(await t.GetItemListInTrack('audio', i)).length) return i;
        await h.voidCall(() => t.AddTrack('audio', 'stereo'));
        return n + 1;
    }
    api.placeAudio = async ({ file, where, offset }) => {
        const p = await h.project();
        const t = await h.timeline();
        const g = await h.geom(t);
        const at = (await positions(t, g, where)).map(f => f + Math.round(offset || 0));
        if (!at.length) throw new Error(where === 'markers' ? 'The timeline has no markers.' : 'Nothing to place the sound at.');
        const { mp, item } = await importFile(p, file, 'HermiteCut SFX');
        const track = await freeAudioTrack(t);
        const placed = h.arr(await mp.AppendToTimeline(at.map(f => ({ mediaPoolItem: item, trackIndex: track, recordFrame: f, mediaType: 2 }))));
        return { placed: placed.length, msg: path.basename(file, path.extname(file)) + ' placed ' + placed.length + '× on A' + track };
    };

    // ------------------------------------------------------------ library
    const cacheDir = () => path.join(os.tmpdir(), 'hermitecut-asset-cache');
    api.libraryIndex = async ({ folders }) => (ENGINE ? ENGINE.libraryIndex(folders || []) : ASSETS.index(folders || []));
    api.libraryClearCache = async () => {
        if (ENGINE) ENGINE.libraryClearCache(cacheDir()); else ASSETS.clearCache(cacheDir());
        return { msg: 'Cache cleared' };
    };
    api.libraryUse = async ({ item, action }) => {
        const file = ENGINE ? ENGINE.libraryMaterialise(item, cacheDir()) : ASSETS.materialise(item, cacheDir());
        const p = await h.project();
        if (item.type === 'audio') return api.placeAudio({ file, where: action || 'playhead' });
        if (item.type === 'lut') {
            const t = await h.timeline();
            const items = await h.selected(t);
            let n = 0;
            for (const it of items) if (await it.SetLUT(1, file)) n++;
            if (!n) throw new Error('Resolve could not apply the LUT (it must be in a folder Resolve can read).');
            return { msg: 'LUT applied to ' + n + ' clip(s)' };
        }
        if (item.type === 'drfx') {
            const dest = path.join(templatesDir(), path.basename(file));
            fs.copyFileSync(file, dest);
            return { msg: 'Installed ' + path.basename(file) + '. Restart Resolve to use it.' };
        }
        if (item.type === 'drt') {
            const mp = await p.GetMediaPool();
            if (!(await mp.ImportTimelineFromFile(file))) throw new Error('Resolve could not import the timeline.');
            return { msg: 'Timeline imported' };
        }
        // video / image overlays: on a free track above, Screen blend
        const t = await h.timeline();
        const g = await h.geom(t);
        const { mp, item: mpi } = await importFile(p, file, 'HermiteCut Library');
        const track = (await t.GetTrackCount('video')) + 1;
        await h.voidCall(() => t.AddTrack('video'));
        const placed = h.arr(await mp.AppendToTimeline([{ mediaPoolItem: mpi, trackIndex: track, recordFrame: await h.playhead(t, g), mediaType: 1 }]));
        if (placed[0] && action !== 'normal') await h.voidCall(() => placed[0].SetProperty('CompositeMode', 5));
        return { msg: path.basename(file) + ' placed on V' + track };
    };

    // ------------------------------------------------------------ Captions+
    // Turns the timeline's subtitle track (from Captions or an .srt) into
    // animated per-phrase Caption titles of at most ~5 s each.
    api.captionsPlus = async ({ title, maxSeconds }) => {
        const t = await h.timeline();
        const g = await h.geom(t);
        const subs = h.arr(await t.GetItemListInTrack('subtitle', 1));
        if (!subs.length) throw new Error('No subtitles yet. Create captions first (Captions tool), then run Captions+.');
        const limit = Math.min(150, Math.round((maxSeconds || 5) * g.fps));
        let n = 0;
        for (const s of subs) {
            const text = String(await s.GetName() || '').trim();
            if (!text) continue;
            const start = await s.GetStart();
            const dur = Math.min(limit, (await s.GetEnd()) - start);
            await api.insertTitle({ name: title || 'Caption', at: 'frame', values: { LineText: text }, frames: dur, startFrame: start })
                .catch(() => 0);
            n++;
        }
        return { msg: n + ' animated caption(s) added' };
    };

    // ------------------------------------------------------------ Shorts
    api.shortsDuplicate = async ({ reframe }) => {
        const p = await h.project();
        const t = await h.timeline();
        const name = (await t.GetName()) + ' 9x16';
        const dup = await t.DuplicateTimeline(name);
        if (!dup) throw new Error('Resolve could not duplicate the timeline.');
        await p.SetCurrentTimeline(dup);
        await dup.SetSetting('useCustomSettings', '1');
        await dup.SetSetting('timelineResolutionWidth', '1080');
        await dup.SetSetting('timelineResolutionHeight', '1920');
        await dup.SetSetting('timelineInputResMismatchBehavior', 'scaleToCrop');
        let n = 0;
        if (reframe) {
            const tracks = await dup.GetTrackCount('video');
            for (let i = 1; i <= tracks; i++) for (const it of h.arr(await dup.GetItemListInTrack('video', i))) {
                if (h.has(it, 'SmartReframe') && await it.SmartReframe().catch(() => false)) n++;
            }
        }
        return { msg: 'Created "' + name + '" at 1080×1920' + (reframe ? ', Smart Reframe on ' + n + ' clip(s)' : '') };
    };
    api.smartReframe = async () => {
        const t = await h.timeline();
        let n = 0;
        for (const it of await h.selected(t)) if (await it.SmartReframe().catch(() => false)) n++;
        if (!n) throw new Error('Smart Reframe needs Resolve Studio.');
        return { msg: 'Smart Reframe on ' + n + ' clip(s)' };
    };

    // ------------------------------------------------------------ Setup
    function supportDirs() {
        if (process.platform === 'win32') {
            const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
            const pd = process.env.PROGRAMDATA || 'C:\\ProgramData';
            return {
                templates: path.join(appdata, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Fusion', 'Templates'),
                scripts: path.join(appdata, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Fusion', 'Scripts', 'Utility'),
                plugins: path.join(pd, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Workflow Integration Plugins'),
                sample: path.join(pd, 'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Developer', 'Workflow Integrations', 'Examples', 'SamplePlugin', 'WorkflowIntegration.node'),
                fonts: path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Fonts')
            };
        }
        const lib = path.join(os.homedir(), 'Library', 'Application Support', 'Blackmagic Design', 'DaVinci Resolve');
        return {
            templates: path.join(lib, 'Fusion', 'Templates'),
            scripts: path.join(lib, 'Fusion', 'Scripts', 'Utility'),
            plugins: '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins',
            sample: '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node',
            fonts: path.join(os.homedir(), 'Library', 'Fonts')
        };
    }
    function templatesDir() { const d = supportDirs().templates; fs.mkdirSync(d, { recursive: true }); return d; }

    api.setupStatus = async () => {
        const d = supportDirs();
        let scripting = false, version = '';
        try { const r = await h.R(); version = await r.GetVersionString(); scripting = true; } catch (e) { /* */ }
        return {
            mode: h.H.mode ? h.H.mode() : 'standalone',
            resolve: version, scripting,
            templates: fs.existsSync(path.join(d.templates, 'HermiteCut.drfx')),
            launcher: fs.existsSync(path.join(d.scripts, 'HermiteCut.lua')),
            plugin: fs.existsSync(path.join(d.plugins, 'com.hermitelabs.cut', 'main.js')),
            fonts: ['archivo.woff2', 'outfit.woff2', 'montserrat.woff2'].every(f => fs.existsSync(path.join(d.fonts, 'HermiteCut-' + f))),
            paths: d
        };
    };
    api.installTemplates = async () => {
        const src = res('HermiteCut.drfx');
        if (!fs.existsSync(src)) throw new Error('The template pack is missing from this install.');
        fs.copyFileSync(src, path.join(templatesDir(), 'HermiteCut.drfx'));
        return { msg: 'Templates installed. Restart Resolve to load them.' };
    };
    api.installLauncher = async () => {
        const d = supportDirs().scripts;
        fs.mkdirSync(d, { recursive: true });
        fs.copyFileSync(res('launcher', 'HermiteCut.lua'), path.join(d, 'HermiteCut.lua'));
        return { msg: 'Added Workspace → Scripts → HermiteCut' };
    };
    api.installFonts = async () => {
        const d = supportDirs().fonts;
        fs.mkdirSync(d, { recursive: true });
        for (const f of ['archivo.woff2', 'outfit.woff2', 'montserrat.woff2']) {
            const s = res('fonts', f);
            if (fs.existsSync(s)) fs.copyFileSync(s, path.join(d, 'HermiteCut-' + f));
        }
        return { msg: 'Fonts copied. Titles can now use Archivo, Outfit and Montserrat.' };
    };
    // The plugin folder is machine-wide, so this asks for administrator rights.
    api.installPlugin = async () => {
        const d = supportDirs();
        const src = res('plugin', 'com.hermitelabs.cut');
        if (!fs.existsSync(src)) throw new Error('The Resolve panel is missing from this install.');
        if (!fs.existsSync(d.sample)) throw new Error('DaVinci Resolve Studio was not found. The Resolve panel needs Studio 19 or newer; the app works with the free version.');
        const dest = path.join(d.plugins, 'com.hermitelabs.cut');
        const legacy = path.join(d.plugins, 'com.gaffystudios.editkit.resolve');
        await new Promise((resolve, reject) => {
            if (process.platform === 'win32') {
                const ps = `Remove-Item -Recurse -Force '${legacy}' -ErrorAction SilentlyContinue; ` +
                    `New-Item -ItemType Directory -Force '${dest}' | Out-Null; Copy-Item -Recurse -Force '${src}\\*' '${dest}'; ` +
                    `Copy-Item -Force '${d.sample}' '${dest}'`;
                execFile('powershell', ['-NoProfile', '-Command',
                    `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-Command',"${ps.replace(/"/g, '`"')}"`],
                (err) => err ? reject(new Error('Installation was cancelled or failed.')) : resolve());
            } else {
                const sh = `rm -rf '${legacy}'; mkdir -p '${dest}' && cp -R '${src}/.' '${dest}/' && cp '${d.sample}' '${dest}/'`;
                execFile('osascript', ['-e', `do shell script "${sh.replace(/"/g, '\\"')}" with administrator privileges`],
                    (err) => err ? reject(new Error('Installation was cancelled or failed.')) : resolve());
            }
        });
        return { msg: 'Resolve panel installed. Restart Resolve, then Workspace → Workflow Integrations → HermiteCut.' };
    };
}

module.exports = { register };
