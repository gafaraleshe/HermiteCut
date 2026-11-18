#!/usr/bin/env python3
"""Test every HermiteCut template inside DaVinci Resolve and render thumbnails.

Run on the machine with Resolve open, after:

    python tools/dev/preflight.py            # everything OK?
    python tools/fusegen/build_pack.py       # build/HermiteCut.drfx
    python tools/fusegen/install_pack.py     # then restart Resolve

then:

    python tools/dev/test_pack.py --make-clips          # all templates
    python tools/dev/test_pack.py --only "Whip*"        # some of them
    python tools/dev/test_pack.py --kind transitions

What it does
------------
- Works only in a scratch project (default "HermiteCut Pack Test"). If another
  project is open it is saved first, then the scratch project is opened or
  created. No other project is touched.
- Imports the test clips (CLIP_A/B/C.mp4; --make-clips makes them with ffmpeg)
  and builds small timelines at 640x360, 25 fps, so frame grabs are quick.
- **Effects:** applies each effect to a trimmed 100-frame clip. For Apply at
  Post, Pre, Both and Whole it checks that frames inside the window change and
  frames outside it are identical to the clip without the effect.
- **Transitions:** puts each one on a cut between two clips with handles
  (20 frames, centred). It checks that frames before and after are untouched,
  that the first frame is the outgoing clip and the last the incoming clip, and
  that the middle changes.
- **Titles:** inserts each title, checks that it is hidden at both ends and
  visible in the middle, and that editing its first text field changes the
  picture.
- Saves a 320x180 thumbnail per template to build/thumbs/<Kind>/<Name>.png.
  Run build_pack.py again afterwards to put them in the pack.
- Writes build/pack-test/report.md and results.json, plus the frames of any
  failed check in build/pack-test/frames/.

Exit code 0 means every template passed.
"""
import argparse
import datetime
import fnmatch
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
sys.path.insert(0, HERE)
import frametools as ft  # noqa: E402
from preflight import scripting_module  # noqa: E402

BUILD = os.path.join(ROOT, 'build')
OUT = os.path.join(BUILD, 'pack-test')
IDENT = 1.0        # mean abs difference (0-255) treated as "identical"
CHANGE = 0.6       # mean abs difference treated as "visibly changed"
CLIP_FRAMES = 100  # each test clip on the timeline: source frames 25..124
TR_DURATION = 20


# ---------------------------------------------------------------- helpers
def log(*a):
    print(*a, flush=True)


def call(obj, name, *args):
    """Call a Resolve API method if it exists; None if it doesn't or fails."""
    fn = getattr(obj, name, None)
    if fn is None:
        return None
    try:
        return fn(*args)
    except Exception as e:  # noqa: BLE001
        log('    %s failed: %s' % (name, e))
        return None


def make_clips(folder):
    os.makedirs(folder, exist_ok=True)
    font = ''
    for f in (r'C:\Windows\Fonts\arial.ttf', '/System/Library/Fonts/Supplemental/Arial.ttf',
              '/Library/Fonts/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'):
        if os.path.exists(f):
            font = ":fontfile='%s'" % f.replace('\\', '/').replace(':', '\\:')
            break
    for i, (name, colour) in enumerate((('A', '0xE4572E'), ('B', '0x29B6F6'), ('C', '0x66BB6A'))):
        out = os.path.join(folder, 'CLIP_%s.mp4' % name)
        if os.path.exists(out):
            continue
        graph = ("[0][1]overlay=x='mod(t*420\\,1680)':y=420,drawtext=text='CLIP %s   %%{frame_num}':x=80:y=80:"
                 "fontsize=96:fontcolor=white%s[v]" % (name, font))
        cmd = ['ffmpeg', '-y', '-loglevel', 'error',
               '-f', 'lavfi', '-i', 'color=c=0x16161c:s=1920x1080:r=25:d=6',
               '-f', 'lavfi', '-i', 'color=c=%s:s=240x240:r=25:d=6' % colour,
               '-f', 'lavfi', '-i', 'sine=frequency=%d:sample_rate=48000:duration=6' % (330 + i * 110),
               '-filter_complex', graph, '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'veryfast',
               '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', out]
        subprocess.run(cmd, check=True)
        log('wrote', out)


class Session:
    def __init__(self, args):
        self.args = args
        dvr = scripting_module()
        self.resolve = dvr.scriptapp('Resolve')
        if not self.resolve:
            raise SystemExit('Cannot reach Resolve. Run tools/dev/preflight.py.')
        self.pm = self.resolve.GetProjectManager()
        self.open_project(args.project)
        self.mp = self.project.GetMediaPool()
        self.clips = self.import_clips(args.media)
        os.makedirs(OUT, exist_ok=True)
        self.frame_path = os.path.join(OUT, '_frame.png')

    # --- project and media
    def open_project(self, name):
        cur = self.pm.GetCurrentProject()
        if cur and cur.GetName() == name:
            self.project = cur
        else:
            if cur:
                log('Saving the open project "%s" before switching to "%s".' % (cur.GetName(), name))
                self.pm.SaveProject()
            self.project = self.pm.LoadProject(name)
            if not self.project:
                self.project = self.pm.CreateProject(name)
                if not self.project:
                    raise SystemExit('Could not open or create the project "%s".' % name)
                w, h = self.args.size.split('x')
                for k, v in (('timelineFrameRate', '25'), ('timelineResolutionWidth', w),
                             ('timelineResolutionHeight', h)):
                    self.project.SetSetting(k, v)
        log('Project:', self.project.GetName())
        self.resolve.OpenPage('color')
        self.resolve.OpenPage('edit')

    def import_clips(self, folder):
        want = {'CLIP_%s.mp4' % n: os.path.join(folder, 'CLIP_%s.mp4' % n) for n in 'ABC'}
        have = {c.GetName(): c for c in (self.mp.GetRootFolder().GetClipList() or [])}
        missing = [p for n, p in want.items() if n not in have]
        if missing:
            for p in missing:
                if not os.path.exists(p):
                    raise SystemExit('Missing %s. Run with --make-clips, or tools/dev/make_test_clips.sh.' % p)
            for c in self.mp.ImportMedia(missing) or []:
                have[c.GetName()] = c
        return {n[5]: have[n] for n in want}

    # --- timelines
    def timeline(self, title):
        stamp = datetime.datetime.now().strftime('%H%M%S')
        tl = self.mp.CreateEmptyTimeline('HC %s %s' % (title, stamp))
        if not tl:
            raise SystemExit('Could not create a timeline.')
        self.project.SetCurrentTimeline(tl)
        return tl

    def place(self, tl, letter, offset):
        start = tl.GetStartFrame()
        items = self.mp.AppendToTimeline([{
            'mediaPoolItem': self.clips[letter], 'startFrame': 25, 'endFrame': 25 + CLIP_FRAMES - 1,
            'mediaType': 1, 'trackIndex': 1, 'recordFrame': start + offset}])
        if not items:
            raise SystemExit('AppendToTimeline failed.')
        return items[0]

    def clear(self, tl):
        items = []
        for track in range(1, int(tl.GetTrackCount('video') or 1) + 1):
            items += tl.GetItemListInTrack('video', track) or []
        if items:
            tl.DeleteClips(items, False)

    def grab(self, tl, offset):
        return ft.grab(self.project, tl, offset, self.frame_path)

    def save_frame(self, png, name, label):
        folder = os.path.join(OUT, 'frames')
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, '%s - %s.png' % (name, label)), 'wb') as fh:
            fh.write(png)

    def thumb(self, kind, name, png):
        if self.args.no_thumbs:
            return
        folder = os.path.join(BUILD, 'thumbs', kind)
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, name + '.png'), 'wb') as fh:
            fh.write(ft.thumbnail(png, 320, 180))


def find_macro(comp, key):
    """The tool in `comp` that has the macro input `key`."""
    if not comp:
        return None
    tools = comp.GetToolList(False) or {}
    for tool in (tools.values() if hasattr(tools, 'values') else tools):
        try:
            if tool.GetInput(key) is not None:
                return tool
        except Exception:  # noqa: BLE001
            pass
    return None


def effect_comp(item):
    effects = call(item, 'GetEffects') or []
    if hasattr(effects, 'values'):
        effects = list(effects.values())
    for e in reversed(list(effects)):
        comp = call(e, 'GetFusionComp')
        if comp:
            return comp
    n = call(item, 'GetFusionCompCount') or 0
    return call(item, 'GetFusionCompByIndex', n) if n else None


# ---------------------------------------------------------------- tests
def test_effects(s, templates):
    results = []
    tl = s.timeline('Effects')
    item = s.place(tl, 'A', 0)
    base = {f: s.grab(tl, f) for f in (0, 1, 2, 3, 5, 12, 20, 30, 50, 70, 79, 86, 94, 96, 97, 98, 99)}

    def frame(f):
        return s.grab(tl, f)

    for t in templates:
        name, F = t['name'], int(t['defaults'].get('Frames', 8))
        mode0 = int(t['defaults'].get('Mode', 0))
        r = {'name': name, 'kind': 'effect', 'checks': [], 'ok': True}
        log('Effect: %s' % name)
        s.clear(tl)
        item = s.place(tl, 'A', 0)
        if not call(item, 'AddEffect', 'fusion', t['id']):
            r.update(ok=False, error='AddEffect failed: is the pack installed and Resolve restarted?')
            results.append(r)
            continue
        macro = find_macro(effect_comp(item), 'Mode')
        if not macro:
            r['checks'].append(('controls', 'not reachable: only the default Apply at was tested', None))

        def check(label, inside, outside):
            if macro:
                macro.SetInput('Mode', label[1])
            got_in = 0.0
            for f in inside:
                d = ft.mean_diff(frame(f), base[f])
                got_in = max(got_in, d)
            worst_out, worst_f = 0.0, None
            for f in outside:
                png = frame(f)
                d = ft.mean_diff(png, base[f])
                if d > worst_out:
                    worst_out, worst_f = d, f
                    if d > IDENT:
                        s.save_frame(png, name, '%s outside f%d' % (label[0], f))
            ok = got_in >= CHANGE and worst_out <= IDENT
            r['checks'].append((label[0], 'inside %.2f, outside %.2f%s' % (
                got_in, worst_out, '' if worst_f is None else ' (f%d)' % worst_f), ok))
            r['ok'] = r['ok'] and ok

        pin = [f for f in (0, 1, 2, 3, 5) if f < F] or [0]
        pre = [f for f in (99, 98, 97, 96, 94) if f > 99 - F] or [99]
        modes = [(('Post', 0), pin, [f for f in (12, 20, 30, 50) if f >= F + 2]),
                 (('Pre', 1), pre, [f for f in (50, 70, 79, 86) if f <= 97 - F]),
                 (('Both', 2), pin[:1] + pre[:1], [50]),
                 (('Whole', 3), [20, 50, 79], [])]
        if not macro:
            modes = [m for m in modes if m[0][1] == mode0]
        for label, inside, outside in modes:
            check(label, inside, outside)
        if name == 'Letterbox' and macro:
            macro.SetInput('Mode', 3)
            top, bottom = ft.black_bars(frame(50))
            w, h = (int(v) for v in s.args.size.split('x'))
            want = max(0.0, (1 - (w / float(h)) / 2.39) / 2)
            ok = abs(top - want) < 0.02 and abs(bottom - want) < 0.02
            hint = '' if ok else (' - wrong size: flip RECT_HEIGHT_IN_FRAME_HEIGHTS in '
                                  'tools/fusegen/packs/common.py, rebuild and test again')
            r['checks'].append(('2.39 bars', 'top %.3f, bottom %.3f, expected %.3f%s' % (top, bottom, want, hint), ok))
            r['ok'] = r['ok'] and ok
        if macro:
            if mode0 == 3:
                macro.SetInput('Mode', 3)
                s.thumb('Effects', name, frame(50))
            else:
                macro.SetInput('Mode', 0)
                s.thumb('Effects', name, frame(min(F - 1, max(0, round(F * 0.3)))))
        results.append(r)
    s.clear(tl)
    return results


def test_transitions(s, templates):
    results = []
    tl = s.timeline('Transitions')
    s.place(tl, 'A', 0)
    s.place(tl, 'B', CLIP_FRAMES)
    cut = CLIP_FRAMES
    first, last = cut - TR_DURATION // 2, cut + TR_DURATION // 2 - 1
    probe = [first - 5, first, cut - 5, cut, cut + 5, last, last + 5]
    base = {f: s.grab(tl, f) for f in probe}
    for t in templates:
        name = t['name']
        r = {'name': name, 'kind': 'transition', 'checks': [], 'ok': True}
        log('Transition: %s' % name)
        s.clear(tl)
        a = s.place(tl, 'A', 0)
        s.place(tl, 'B', CLIP_FRAMES)
        used = None
        for typ in (name, 'HermiteCut/' + name, t['id'], 'Fusion/Transitions/HermiteCut/' + name):
            if call(a, 'AddTransition', {'type': typ, 'category': 'fusion', 'position': 'end',
                                         'alignment': 'center', 'duration': TR_DURATION}):
                used = typ
                break
        if not used:
            r.update(ok=False, error='AddTransition failed for every type name tried')
            results.append(r)
            continue
        r['type'] = used
        got = {f: s.grab(tl, f) for f in probe}

        def same(label, f, tol):
            d = ft.mean_diff(got[f], base[f])
            ok = d <= tol
            if not ok:
                s.save_frame(got[f], name, '%s f%d' % (label, f))
            r['checks'].append((label, '%.2f' % d, ok))
            r['ok'] = r['ok'] and ok

        same('before untouched', first - 5, IDENT)
        same('after untouched', last + 5, IDENT)
        same('first frame = outgoing', first, 3.0)
        same('last frame = incoming', last, 3.0)
        mid = max(ft.mean_diff(got[f], base[f]) for f in (cut - 5, cut, cut + 5))
        r['checks'].append(('middle changes', '%.2f' % mid, mid >= CHANGE))
        r['ok'] = r['ok'] and mid >= CHANGE
        s.thumb('Transitions', name, s.grab(tl, cut - 2))
        results.append(r)
    s.clear(tl)
    return results


TEXT_KEYS = ['ArtistText', 'NameText', 'HandleText', 'WordText', 'MainText', 'LocationText', 'LineText']


def test_titles(s, templates):
    results = []
    tl = s.timeline('Titles')
    for t in templates:
        name = t['name']
        r = {'name': name, 'kind': 'title', 'checks': [], 'ok': True}
        log('Title: %s' % name)
        s.clear(tl)
        tl.SetCurrentTimecode(tl.GetStartTimecode())
        item = None
        for typ in (name, 'HermiteCut/' + name):
            item = call(tl, 'InsertFusionTitleIntoTimeline', typ)
            if item:
                r['type'] = typ
                break
        if not item:
            r.update(ok=False, error='InsertFusionTitleIntoTimeline failed')
            results.append(r)
            continue
        n = int(item.GetDuration())
        mid = n // 2
        f0, fm, f1 = (s.grab(tl, f) for f in (0, mid, n - 1))
        lm = ft.mean_luma(fm)
        for label, png in (('hidden at start', f0), ('hidden at end', f1)):
            ok = ft.mean_luma(png) <= lm - 0.3
            if not ok:
                s.save_frame(png, name, label)
            r['checks'].append((label, 'luma %.2f vs middle %.2f' % (ft.mean_luma(png), lm), ok))
            r['ok'] = r['ok'] and ok
        s.thumb('Titles', name, fm)
        macro = find_macro(call(item, 'GetFusionCompByIndex', 1), 'InStyle')
        key = next((k for k in TEXT_KEYS if macro and macro.GetInput(k) is not None), None)
        if key:
            macro.SetInput(key, 'HERMITECUT TEST 0123456789')
            d = ft.mean_diff(s.grab(tl, mid), fm)
            ok = d >= 0.2
            r['checks'].append(('text field %s edits the picture' % key, '%.2f' % d, ok))
            r['ok'] = r['ok'] and ok
        else:
            r['checks'].append(('text field', 'not reachable from the API', None))
        results.append(r)
    s.clear(tl)
    return results


def write_report(results, started):
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'results.json'), 'w', encoding='utf-8') as fh:
        json.dump(results, fh, indent=1)
    passed = sum(1 for r in results if r['ok'])
    lines = ['# HermiteCut pack test', '',
             'Run %s, %d of %d templates passed, %.0f s.' % (
                 started.strftime('%Y-%m-%d %H:%M'), passed, len(results),
                 (datetime.datetime.now() - started).total_seconds()), '',
             '| Template | Kind | Result | Checks |', '|---|---|---|---|']
    for r in results:
        checks = '; '.join('%s %s%s' % (c[0], c[1], '' if c[2] is None else (' ✓' if c[2] else ' ✗'))
                           for c in r['checks'])
        if r.get('error'):
            checks = r['error']
        lines.append('| %s | %s | %s | %s |' % (r['name'], r['kind'], 'PASS' if r['ok'] else 'FAIL', checks))
    with open(os.path.join(OUT, 'report.md'), 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')
    return passed


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--project', default='HermiteCut Pack Test', help='scratch project to use or create')
    ap.add_argument('--media', default=os.path.join(BUILD, 'testmedia'))
    ap.add_argument('--make-clips', action='store_true', help='make the test clips with ffmpeg if missing')
    ap.add_argument('--manifest', default=os.path.join(BUILD, 'HermiteCut-manifest.json'))
    ap.add_argument('--only', help='test only templates whose name matches this pattern, e.g. "Whip*"')
    ap.add_argument('--kind', choices=['effects', 'transitions', 'titles'])
    ap.add_argument('--size', default='640x360', help='timeline size for new projects (default 640x360)')
    ap.add_argument('--no-thumbs', action='store_true')
    args = ap.parse_args(argv)

    if args.make_clips:
        make_clips(args.media)
    if not os.path.exists(args.manifest):
        raise SystemExit('No manifest. Run tools/fusegen/build_pack.py first.')
    with open(args.manifest, encoding='utf-8') as fh:
        templates = json.load(fh)['templates']
    if args.only:
        templates = [t for t in templates if fnmatch.fnmatch(t['name'].lower(), args.only.lower())]
    if args.kind:
        templates = [t for t in templates if t['kind'] + 's' == args.kind]
    if not templates:
        raise SystemExit('No templates match.')

    if os.path.isdir(os.path.join(OUT, 'frames')):
        shutil.rmtree(os.path.join(OUT, 'frames'))
    started = datetime.datetime.now()
    s = Session(args)
    results = []
    by_kind = {k: [t for t in templates if t['kind'] == k] for k in ('effect', 'transition', 'title')}
    if by_kind['effect']:
        results += test_effects(s, by_kind['effect'])
    if by_kind['transition']:
        results += test_transitions(s, by_kind['transition'])
    if by_kind['title']:
        results += test_titles(s, by_kind['title'])
    passed = write_report(results, started)
    log('\n%d of %d templates passed. Report: %s' % (passed, len(results), os.path.join(OUT, 'report.md')))
    for r in results:
        if not r['ok']:
            log('  FAIL %s: %s' % (r['name'], r.get('error') or '; '.join(
                '%s %s' % (c[0], c[1]) for c in r['checks'] if c[2] is False)))
    if not args.no_thumbs:
        log('Thumbnails are in build/thumbs/. Run build_pack.py and install_pack.py again to include them.')
    return 0 if passed == len(results) else 1


if __name__ == '__main__':
    sys.exit(main())
