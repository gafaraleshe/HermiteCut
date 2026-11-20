#!/usr/bin/env python3
"""Assemble HermiteCut 2 for packaging.

    python scripts/assemble.py            # pack + sounds + plugin + resources

Produces:
  build/HermiteCut.drfx, build/HermiteCut-manifest.json   (tools/fusegen/build_pack.py)
  build/sfx/                                              (tools/sfxgen/sfxgen.py)
  build/plugin/com.hermitelabs.cut/   the Resolve panel: main.js, preload.js, package.json,
                                      manifest.xml, core/, hosts/ (no WorkflowIntegration.node:
                                      Setup copies Resolve's own at install time)
  build/app/                          the standalone app project (electron-builder)
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
IGNORE = shutil.ignore_patterns('WorkflowIntegration.node', 'devtools.flag', '__pycache__', '*.pyc', '.DS_Store', '*.ts')


def run(*args):
    subprocess.check_call([sys.executable] + list(args), cwd=ROOT)


def copytree(src, dst):
    if os.path.exists(dst):
        shutil.rmtree(dst)
    shutil.copytree(src, dst, ignore=IGNORE)


# TypeScript compiled into the app for Electron (CommonJS), with Bun.
TS_ENTRIES = [
    ('lib/engine.ts', 'lib/engine.js'),   # loads the Rust engine
    ('mcp/server.ts', 'mcp/server.js'),   # the local MCP server for Claude
    ('licence/licence.ts', 'licence/licence.js'),  # the Polar licence key
]

# Baked into the build (bun build --define), from the environment. With no
# HC_POLAR_ORGANIZATION_ID, licensing is off and HermiteCut needs no key.
LICENCE_SETTINGS = {
    'HC_POLAR_ORGANIZATION_ID': '',
    'HC_POLAR_API': 'https://api.polar.sh',
    'HC_POLAR_CHECKOUT_URL': 'https://cut.hermitelabs.com/#purchase',
    'HC_POLAR_PORTAL_URL': 'https://cut.hermitelabs.com/#purchase',
    'HC_PRICE': '£30',
}


def compile_engine(core_dir):
    """Compile TS_ENTRIES into <core_dir>. Without Bun the build still works:
    the app uses its JavaScript code instead of the Rust engine, and has no
    MCP server."""
    bun = shutil.which('bun')
    if not bun:
        print('warning: Bun not found, so this build has no Rust engine or MCP server (https://bun.sh)')
        return
    defines = []
    for name, default in LICENCE_SETTINGS.items():
        defines += ['--define', 'process.env.%s=%s' % (name, json.dumps(os.environ.get(name) or default))]
    for src, out in TS_ENTRIES:
        subprocess.check_call([bun, 'build', os.path.join(ROOT, 'core', src),
                               '--target=node', '--format=cjs', *defines,
                               '--outfile', os.path.join(core_dir, out)], cwd=ROOT)
    org = os.environ.get('HC_POLAR_ORGANIZATION_ID')
    print('Licensing:', 'on (Polar organisation %s)' % org if org else 'off (no HC_POLAR_ORGANIZATION_ID)')


def main():
    if '--skip-pack' not in sys.argv:
        run('tools/fusegen/build_pack.py')
    if '--skip-sfx' not in sys.argv:
        run('tools/sfxgen/sfxgen.py')

    # the Resolve panel
    if os.path.exists(PLUGIN):
        shutil.rmtree(PLUGIN)
    os.makedirs(PLUGIN)
    for f in ('main.js', 'shell.js', 'preload.js', 'package.json'):
        shutil.copy(os.path.join(ROOT, 'app', f), PLUGIN)
    shutil.copy(os.path.join(ROOT, 'hosts', 'resolve', 'plugin', 'manifest.xml'), PLUGIN)
    copytree(os.path.join(ROOT, 'core'), os.path.join(PLUGIN, 'core'))
    compile_engine(os.path.join(PLUGIN, 'core'))
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

    # the standalone app project for electron-builder: the panel's code plus
    # build resources; the shared resources go in as extraResources
    APP = os.path.join(BUILD, 'app')
    if os.path.exists(APP):
        shutil.rmtree(APP)
    copytree(PLUGIN, APP)
    os.remove(os.path.join(APP, 'manifest.xml'))
    # The app ships build/app/resources (extraResources). It must be the full
    # set, with the panel, so Setup can install the panel: the panel's own copy
    # above was taken before plugin/ was added.
    copytree(RES, os.path.join(APP, 'resources'))
    copytree(os.path.join(ROOT, 'app', 'build-res'), os.path.join(APP, 'build-res'))

    version = json.load(open(os.path.join(ROOT, 'app', 'package.json')))['version']
    print(f'Assembled HermiteCut {version}: build/plugin/com.hermitelabs.cut and build/resources')


if __name__ == '__main__':
    main()
