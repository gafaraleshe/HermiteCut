#!/usr/bin/env python3
"""Assemble HermiteCut 2 for packaging.

    python scripts/assemble.py            # pack + sounds + plugin + resources

Produces:
  build/HermiteCut.drfx, build/HermiteCut-manifest.json   (tools/fusegen/build_pack.py)
  build/sfx/                                              (tools/sfxgen/sfxgen.py)
  build/plugin/com.hermitelabs.cut/   the Resolve panel: main.js, preload.js, package.json,
                                      manifest.xml, core/, hosts/ (no WorkflowIntegration.node:
                                      Setup copies Resolve's own at install time)
  build/resources/                    what the app ships next to itself (extraResources):
                                      HermiteCut.drfx, HermiteCut-manifest.json, sfx/, fonts/,
                                      launcher/HermiteCut.lua, plugin/com.hermitelabs.cut/
The panel also gets the resources inside it, so it works without the app.
"""
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
BUILD = os.path.join(ROOT, 'build')
PLUGIN = os.path.join(BUILD, 'plugin', 'com.hermitelabs.cut')
RES = os.path.join(BUILD, 'resources')
IGNORE = shutil.ignore_patterns('WorkflowIntegration.node', 'devtools.flag', '__pycache__', '*.pyc', '.DS_Store')


def run(*args):
    subprocess.check_call([sys.executable] + list(args), cwd=ROOT)


def copytree(src, dst):
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=IGNORE)


def main():
    if '--skip-pack' not in sys.argv:
        run('tools/fusegen/build_pack.py')
    if '--skip-sfx' not in sys.argv:
        run('tools/sfxgen/sfxgen.py')

    # the Resolve panel
    if os.path.exists(PLUGIN):
        shutil.rmtree(PLUGIN)
    os.makedirs(PLUGIN)
    for f in ('main.js', 'preload.js', 'package.json'):
        shutil.copy(os.path.join(ROOT, 'app', f), PLUGIN)
    shutil.copy(os.path.join(ROOT, 'hosts', 'resolve', 'plugin', 'manifest.xml'), PLUGIN)
    copytree(os.path.join(ROOT, 'core'), os.path.join(PLUGIN, 'core'))
    copytree(os.path.join(ROOT, 'hosts'), os.path.join(PLUGIN, 'hosts'))

    # app resources
    if os.path.exists(RES):
        shutil.rmtree(RES)
    os.makedirs(RES)
    for f in ('HermiteCut.drfx', 'HermiteCut-manifest.json'):
        shutil.copy(os.path.join(BUILD, f), RES)
    copytree(os.path.join(BUILD, 'sfx'), os.path.join(RES, 'sfx'))
    os.makedirs(os.path.join(RES, 'fonts'))
    for f in ('archivo.woff2', 'outfit.woff2', 'montserrat.woff2'):
        shutil.copy(os.path.join(ROOT, 'core', 'ui', 'fonts', f), os.path.join(RES, 'fonts'))
    copytree(os.path.join(ROOT, 'hosts', 'resolve', 'launcher'), os.path.join(RES, 'launcher'))
    # the panel carries its own copy of the resources
    copytree(RES, os.path.join(PLUGIN, 'resources'))
    copytree(PLUGIN, os.path.join(RES, 'plugin', 'com.hermitelabs.cut'))

    version = json.load(open(os.path.join(ROOT, 'app', 'package.json')))['version']
    print(f'Assembled HermiteCut {version}: build/plugin/com.hermitelabs.cut and build/resources')


if __name__ == '__main__':
    main()
