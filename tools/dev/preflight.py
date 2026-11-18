#!/usr/bin/env python3
"""Pre-flight checks before building and testing the template pack in Resolve
(AGENTS.md section 9, "Before step 6"). Run it on the machine with Resolve:

    python tools/dev/preflight.py

It checks, in order:

1. Python 3.8 or newer (for tools/fusegen and the frame checks).
2. ffmpeg on PATH (for the test clips).
3. fuscript exists where Resolve installs it.
4. The bridge works: fuscript runs a one-line Lua script and Resolve answers
   with its version. This needs Resolve open and Preferences -> System ->
   General -> External scripting using: Local.
5. A project is open, and which one. Tests run in a scratch project.
6. Resolve's Python scripting module loads (tools/dev/test_pack.py uses it).
7. What is already in the Fusion Templates folder (old dev packs to remove).

Nothing is changed. Exit code 0 means everything needed is in place.
"""
import os
import platform
import shutil
import subprocess
import sys
import tempfile

WIN = platform.system() == 'Windows'
MAC = platform.system() == 'Darwin'

if WIN:
    RESOLVE_DIR = r'C:\Program Files\Blackmagic Design\DaVinci Resolve'
    FUSCRIPT = os.path.join(RESOLVE_DIR, 'fuscript.exe')
    SCRIPT_LIB = os.path.join(RESOLVE_DIR, 'fusionscript.dll')
    SCRIPT_API = os.path.join(os.environ.get('PROGRAMDATA', r'C:\ProgramData'),
                              'Blackmagic Design', 'DaVinci Resolve', 'Support', 'Developer', 'Scripting')
    TEMPLATES = os.path.join(os.environ.get('APPDATA', ''), 'Blackmagic Design', 'DaVinci Resolve', 'Support',
                             'Fusion', 'Templates')
elif MAC:
    APP = '/Applications/DaVinci Resolve/DaVinci Resolve.app'
    FUSCRIPT = APP + '/Contents/Libraries/Fusion/fuscript'
    SCRIPT_LIB = APP + '/Contents/Libraries/Fusion/fusionscript.so'
    SCRIPT_API = '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting'
    TEMPLATES = os.path.expanduser('~/Library/Application Support/Blackmagic Design/DaVinci Resolve/'
                                   'Fusion/Templates')
else:
    FUSCRIPT = '/opt/resolve/libs/Fusion/fuscript'
    SCRIPT_LIB = '/opt/resolve/libs/Fusion/fusionscript.so'
    SCRIPT_API = '/opt/resolve/Developer/Scripting'
    TEMPLATES = os.path.expanduser('~/.local/share/DaVinciResolve/Fusion/Templates')

CHECK_LUA = r'''
local r = Resolve()
if not r then print("NO_RESOLVE") return end
print("VERSION " .. tostring(r:GetVersionString()))
local ok, product = pcall(function() return r:GetProductName() end)
if ok and product then print("PRODUCT " .. tostring(product)) end
local pm = r:GetProjectManager()
local p = pm and pm:GetCurrentProject()
print("PROJECT " .. (p and p:GetName() or "<none>"))
local t = p and p:GetCurrentTimeline()
print("TIMELINE " .. (t and t:GetName() or "<none>"))
'''


def scripting_module():
    """Import DaVinciResolveScript the way Resolve's README describes."""
    os.environ.setdefault('RESOLVE_SCRIPT_API', SCRIPT_API)
    os.environ.setdefault('RESOLVE_SCRIPT_LIB', SCRIPT_LIB)
    mod = os.path.join(os.environ['RESOLVE_SCRIPT_API'], 'Modules')
    if mod not in sys.path:
        sys.path.append(mod)
    import DaVinciResolveScript  # noqa: E402
    return DaVinciResolveScript


def main():
    ok = True

    def report(good, what, hint=''):
        nonlocal ok
        print(('  OK   ' if good else '  FAIL ') + what + (('\n         ' + hint) if hint and not good else ''))
        ok = ok and good

    print('HermiteCut pre-flight')
    report(sys.version_info >= (3, 8), 'Python %d.%d' % sys.version_info[:2], 'Install Python 3.8 or newer.')
    ff = shutil.which('ffmpeg')
    report(bool(ff), 'ffmpeg ' + (ff or 'not found'),
           'Install ffmpeg and add it to PATH (only needed to make the test clips).')
    report(os.path.exists(FUSCRIPT), 'fuscript at ' + FUSCRIPT, 'Is DaVinci Resolve installed in the default place?')

    if os.path.exists(FUSCRIPT):
        path = os.path.join(tempfile.gettempdir(), 'hermitecut-check.lua')
        with open(path, 'w') as fh:
            fh.write(CHECK_LUA)
        try:
            out = subprocess.run([FUSCRIPT, '-l', 'lua', path], capture_output=True, text=True, timeout=60).stdout
        except subprocess.TimeoutExpired:
            out = ''
        lines = dict(line.split(' ', 1) for line in out.splitlines() if ' ' in line)
        version = lines.get('VERSION', '')
        report(bool(version), 'Bridge: Resolve %s %s' % (lines.get('PRODUCT', ''), version),
               'Open Resolve, then set Preferences > System > General > External scripting using: Local, '
               'and restart Resolve.')
        if version:
            report(version.split('.')[0] in ('20', '21', '22'), 'Resolve version %s is 20 or newer' % version,
                   'The template pack and its API notes target Resolve 21.x.')
            project = lines.get('PROJECT', '<none>')
            report(project != '<none>', 'Open project: %s (timeline: %s)' % (project, lines.get('TIMELINE')),
                   'Open a scratch project. Never test in a client project.')

    try:
        dvr = scripting_module()
        resolve = dvr.scriptapp('Resolve')
        report(resolve is not None, 'Python scripting module loads and reaches Resolve',
               'Check External scripting is Local and that Resolve is running.')
    except Exception as e:  # noqa: BLE001
        report(False, 'Python scripting module: %s' % e,
               'Set RESOLVE_SCRIPT_API and RESOLVE_SCRIPT_LIB as described in Resolve\'s scripting README.')

    if os.path.isdir(TEMPLATES):
        packs = sorted(f for f in os.listdir(TEMPLATES) if f.lower().endswith('.drfx'))
        print('  INFO Templates folder: ' + TEMPLATES)
        for f in packs:
            note = '  <- old dev pack, remove with install_pack.py --remove-dev' if 'Dev' in f else ''
            print('         ' + f + note)
    else:
        print('  INFO Templates folder does not exist yet: ' + TEMPLATES)

    print('\nAll set.' if ok else '\nFix the items marked FAIL, then run this again.')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
