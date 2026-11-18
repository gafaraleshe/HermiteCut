#!/usr/bin/env python3
"""Build the HermiteCut template pack.

    python tools/fusegen/build_pack.py              # -> build/HermiteCut.drfx
    python tools/fusegen/build_pack.py --no-check   # skip the offline checks

Steps:

1. Run the pack scripts in tools/fusegen/packs/ (effects, time FX,
   transitions, titles). Each one registers its templates.
2. Write every template to build/pack/Edit/<Kind>/HermiteCut/<Name>.setting.
3. Add thumbnails, <Name>.png, from tools/fusegen/thumbs/<Kind>/ (committed)
   or build/thumbs/<Kind>/ (made by tools/dev/test_pack.py in Resolve; newer
   wins).
4. Run the offline checks (check_pack.py). The build fails if any template
   fails.
5. Zip build/pack into build/HermiteCut.drfx and write
   build/HermiteCut-manifest.json: one entry per template with its script id,
   family, blurb, styles and Inspector controls. The app and the website read
   this file.
"""
import argparse
import json
import os
import shutil
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
BUILD = os.path.join(ROOT, 'build')
PACK = os.path.join(BUILD, 'pack')
VERSION = '2.0.0-dev'

from fuse import write_setting  # noqa: E402
from packs import common, effects, timefx, transitions, titles  # noqa: E402
import check_pack  # noqa: E402


def generate():
    del common.TEMPLATES[:]
    effects.build()
    timefx.build()
    transitions.build()
    titles.build()
    names = {}
    for b in common.TEMPLATES:
        key = (b.kind, b.name)
        if key in names:
            raise SystemExit(f'two templates called {b.kind}/{b.name}')
        names[key] = b
    return list(common.TEMPLATES)


def thumb_for(b):
    found = None
    for base in (os.path.join(HERE, 'thumbs'), os.path.join(BUILD, 'thumbs')):
        p = os.path.join(base, b.kind, b.name + '.png')
        if os.path.exists(p) and (found is None or os.path.getmtime(p) >= os.path.getmtime(found)):
            found = p
    return found


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--no-check', action='store_true', help='skip the offline checks')
    ap.add_argument('--out', default=os.path.join(BUILD, f'{common.CATEGORY}.drfx'))
    args = ap.parse_args(argv)

    templates = generate()
    if os.path.isdir(PACK):
        shutil.rmtree(PACK)
    thumbs = 0
    for b in templates:
        folder = os.path.join(PACK, 'Edit', b.kind, common.CATEGORY)
        write_setting(os.path.join(folder, b.name + '.setting'), b.macro())
        t = thumb_for(b)
        if t:
            shutil.copyfile(t, os.path.join(folder, b.name + '.png'))
            thumbs += 1

    if not args.no_check:
        exempts = {b.name: b.exempt for b in templates}
        if not check_pack.check_paths([PACK], exempts):
            raise SystemExit('Offline checks failed: fix the templates above before installing the pack.')

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    if os.path.exists(args.out):
        os.remove(args.out)
    with zipfile.ZipFile(args.out, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _dirs, files in os.walk(PACK):
            for f in sorted(files):
                full = os.path.join(root, f)
                z.write(full, os.path.relpath(full, PACK).replace(os.sep, '/'))

    manifest = {
        'name': 'HermiteCut', 'version': VERSION, 'category': common.CATEGORY,
        'templates': [dict(b.manifest(), thumbnail=bool(thumb_for(b))) for b in templates],
    }
    with open(os.path.join(BUILD, 'HermiteCut-manifest.json'), 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, indent=1, ensure_ascii=False)
        fh.write('\n')

    counts = {}
    for b in templates:
        counts[b.kind] = counts.get(b.kind, 0) + 1
    print('Built', os.path.relpath(args.out, ROOT), '-',
          ', '.join(f'{n} {k.lower()}' for k, n in counts.items()), f'({thumbs} with thumbnails)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
