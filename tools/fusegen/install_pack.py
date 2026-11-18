#!/usr/bin/env python3
"""Install (or remove) build/HermiteCut.drfx in Resolve's Fusion Templates folder.

    python tools/fusegen/install_pack.py               # install or update
    python tools/fusegen/install_pack.py --remove-dev  # also delete old dev packs
    python tools/fusegen/install_pack.py --uninstall   # remove HermiteCut.drfx

Resolve only scans templates at start-up, so restart it afterwards.
Old dev packs ("EditKit Dev.drfx", "HermiteCut Dev.drfx") are only removed
with --remove-dev, and the script lists them first.
"""
import argparse
import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'dev'))
from preflight import TEMPLATES  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
PACK = os.path.join(ROOT, 'build', 'HermiteCut.drfx')
DEV_PACKS = ['EditKit Dev.drfx', 'HermiteCut Dev.drfx']


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--remove-dev', action='store_true', help='delete old dev packs from the Templates folder')
    ap.add_argument('--uninstall', action='store_true', help='remove HermiteCut.drfx instead of installing it')
    ap.add_argument('--pack', default=PACK)
    args = ap.parse_args(argv)

    os.makedirs(TEMPLATES, exist_ok=True)
    target = os.path.join(TEMPLATES, 'HermiteCut.drfx')
    if args.uninstall:
        if os.path.exists(target):
            os.remove(target)
            print('Removed', target)
        else:
            print('Not installed:', target)
    else:
        if not os.path.exists(args.pack):
            raise SystemExit('No pack at %s. Run tools/fusegen/build_pack.py first.' % args.pack)
        shutil.copyfile(args.pack, target)
        print('Installed', target)

    if args.remove_dev:
        for name in DEV_PACKS:
            p = os.path.join(TEMPLATES, name)
            if os.path.exists(p):
                os.remove(p)
                print('Removed old dev pack', p)
    else:
        left = [n for n in DEV_PACKS if os.path.exists(os.path.join(TEMPLATES, n))]
        if left:
            print('Old dev packs still installed: %s (remove with --remove-dev)' % ', '.join(left))
    print('Restart DaVinci Resolve to load the change.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
