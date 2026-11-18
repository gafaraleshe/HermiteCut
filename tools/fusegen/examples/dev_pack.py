#!/usr/bin/env python3
"""Build a tiny test pack ("HermiteCut Dev.drfx") with one effect, one transition
and one title. Used to check that templates install, show up in Resolve's
Effects library and render with the right timing.

    python tools/fusegen/examples/dev_pack.py   -> build/HermiteCut Dev.drfx
"""
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from fuse import (Ordered, Tool, Inp, Macro, II, IO, slider, multibutton,  # noqa: E402
                  write_setting)

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
BUILD = os.path.join(ROOT, 'build')
PACK = os.path.join(BUILD, 'devpack')
CATEGORY = 'HermiteCut Dev'

# Progress helpers. Inside an effect, comp time runs over the clip (in the
# clip's SOURCE frame rate); RenderStart is the first frame Resolve renders.
POST = 'max(0, 1 - (time - comp.RenderStart) / Controls.Frames)'   # from clip start
PRE = 'max(0, 1 - (comp.RenderEnd - time) / Controls.Frames)'      # towards clip end

# ---- Effect: flash at the start / end / both ends of a clip
controls = Ordered({
    'Mode': multibutton('Apply at', ['Post (start)', 'Pre (end)', 'Both'], 0),
    'Frames': slider('Frames', 1, 48, 8, integer=True, minA=1, maxA=600),
    'Strength': slider('Strength', 0, 4, 1.5),
})
tools = Ordered({
    'Controls': Tool('AlphaDivide', {'Mode': Inp(0), 'Frames': Inp(8), 'Strength': Inp(1.5)},
                     pos=(0, -40), user_controls=controls, passthrough=True, CtrlWShown=False),
    'Flash': Tool('BrightnessContrast', {
        'Gain': Inp(1.0, expr=f'1 + Controls.Strength * iif(Controls.Mode == 0, {POST}, '
                              f'iif(Controls.Mode == 1, {PRE}, max({POST}, {PRE})))'),
    }, pos=(0, 0)),
})
write_setting(os.path.join(PACK, 'Edit', 'Effects', CATEGORY, 'HC Debug Flash.setting'), Macro(
    'HCDebugFlash', tools,
    Ordered({'MainInput1': II('Flash', 'Input'),
             'Mode': II('Controls', 'Mode', name='Apply at', default=0),
             'Frames': II('Controls', 'Frames', default=8),
             'Strength': II('Controls', 'Strength', default=1.5)}),
    {'MainOutput1': IO('Flash')}))

# ---- Transition: plain dissolve. MainInput1 = outgoing clip, MainInput2 = incoming clip.
tools = Ordered({
    'Dis': Tool('Dissolve', {'Mix': Inp(0.5, expr='(time - comp.RenderStart) / max(1, comp.RenderEnd - comp.RenderStart)')}),
})
write_setting(os.path.join(PACK, 'Edit', 'Transitions', CATEGORY, 'HC Debug Dissolve.setting'), Macro(
    'HCDebugDissolve', tools,
    Ordered({'MainInput1': II('Dis', 'Background'), 'MainInput2': II('Dis', 'Foreground')}),
    {'MainOutput1': IO('Dis')}))

# ---- Title: a Text+ with its text exposed
tools = Ordered({
    'Txt': Tool('TextPlus', {
        'Width': Inp(1920), 'Height': Inp(1080), 'UseFrameFormatSettings': Inp(1),
        'StyledText': Inp('HERMITECUT'), 'Font': Inp('Arial'), 'Style': Inp('Bold'), 'Size': Inp(0.12),
        'Red1': Inp(1), 'Green1': Inp(0.3), 'Blue1': Inp(0.4),
    }),
})
write_setting(os.path.join(PACK, 'Edit', 'Titles', CATEGORY, 'HC Debug Title.setting'), Macro(
    'HCDebugTitle', tools,
    Ordered({'Text': II('Txt', 'StyledText', name='Text')}),
    {'MainOutput1': IO('Txt')}))

# ---- Pack the folder tree as a .drfx (a zip whose paths start at Edit/)
out = os.path.join(BUILD, f'{CATEGORY}.drfx')
if os.path.exists(out):
    os.remove(out)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _dirs, files in os.walk(PACK):
        for f in files:
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, PACK))
print('Built', out)
