"""Shared building blocks for the HermiteCut template packs.

Every template is built with a `Build` object: it holds the macro's tools, the
user controls on the `Controls` holder, and the order in which inputs appear in
Resolve's Inspector. The pack scripts (effects.py, timefx.py, transitions.py,
titles.py) call the helpers below, and build_pack.py writes and zips the result.

Timing model (see docs/RESOLVE_API_NOTES.md, "Timing inside effects"):

- Effects get the shared controls *Apply at* (Post / Pre / Both / Whole),
  *Frames*, *Curve*, *Strength* and *Seed*. Two hidden controls on `Controls`
  do the maths once per frame:
    Raw = 1 at the clip edge, falling to 0 after `Frames` frames (0 elsewhere);
          1 everywhere for Whole.
    Env = Raw shaped by the Curve.
  Every effect scales its look by `Controls.Strength * Controls.Env`, so the
  clip is untouched outside the window.
- Transitions get *Curve*. Hidden controls:
    Raw  = linear progress through the overlap, 0 -> 1;
    Prog = Raw shaped by the Curve;
    Peak = 4 * Prog * (1 - Prog): 0 at both ends, 1 in the middle.
- Titles animate in and out with *In* / *Out* frames from the title's ends.

Time is always measured from comp.RenderStart / comp.RenderEnd, never from 0.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from fuse import (Ordered, T, FuID, Tool, Inp, Macro, II, IO,  # noqa: E402,F401
                  slider, checkbox, combo, multibutton, label)

CATEGORY = 'HermiteCut'
TEMPLATES = []          # every Build registered by the pack scripts, in order

T0 = 'comp.RenderStart'
T1 = 'comp.RenderEnd'
PI = '3.14159265'


def clamp01(x):
    return f'max(0, min(1, {x}))'


# ---------------------------------------------------------------- curves
EFFECT_CURVES = ['Linear', 'Smooth', 'Ease Out', 'Ease In', 'Snap', 'Overshoot']
TRANSITION_CURVES = ['Linear', 'Smooth', 'Fast', 'Ease In', 'Ease Out', 'Overshoot']


def effect_curve(e='Controls.Raw', sel='Controls.Curve'):
    """Shape an envelope that is 1 at the clip edge and 0 inside the clip.
    'Ease Out' changes fast at the edge and settles; 'Overshoot' dips below 0
    before settling, for pops and springy moves."""
    return (f'iif({sel} == 0, {e}, '
            f'iif({sel} == 1, {e}*{e}*(3 - 2*{e}), '
            f'iif({sel} == 2, {e}^3, '
            f'iif({sel} == 3, 1 - (1 - {e})^3, '
            f'iif({sel} == 4, {e}^6, '
            f'2.70158*{e}^3 - 1.70158*{e}^2)))))')


def transition_curve(r='Controls.Raw', sel='Controls.Curve'):
    """Shape linear progress 0 -> 1."""
    return (f'iif({sel} == 0, {r}, '
            f'iif({sel} == 1, iif({r} < 0.5, 4*{r}^3, 1 - (2 - 2*{r})^3/2), '
            f'iif({sel} == 2, iif({r} < 0.5, 16*{r}^5, 1 - (2 - 2*{r})^5/2), '
            f'iif({sel} == 3, {r}^3, '
            f'iif({sel} == 4, 1 - (1 - {r})^3, '
            f'1 + 2.70158*({r} - 1)^3 + 1.70158*({r} - 1)^2)))))')


def effect_raw(mode='Controls.Mode', frames='Controls.Frames'):
    f = f'max(1, {frames})'
    post = clamp01(f'1 - (time - {T0}) / {f}')
    pre = clamp01(f'1 - ({T1} - time) / {f}')
    return (f'iif({mode} == 0, {post}, iif({mode} == 1, {pre}, '
            f'iif({mode} == 2, max({post}, {pre}), 1)))')


CLIP_PROGRESS = clamp01(f'(time - {T0}) / max(1, {T1} - {T0})')

ENV = 'Controls.Env'
AMT = '(Controls.Strength * Controls.Env)'


# ---------------------------------------------------------------- noise
_PRIMES = [1.37, 2.71, 3.93, 5.17, 6.61, 7.43, 8.29, 9.77, 11.3, 12.7, 13.1, 14.9]


def wobble(i, speed='Controls.Speed', base=0.31):
    """Smooth pseudo-random motion in about -1..1, different for each i and Seed."""
    p = _PRIMES[i % len(_PRIMES)]
    f1, f2, f3 = base * (1 + 0.37 * i), base * (2.13 + 0.29 * i), base * (4.71 + 0.53 * i)
    return (f'(0.55*sin(time*{f1:.4f}*{speed} + Controls.Seed*{p} + {i * 1.7:.2f}) + '
            f'0.30*sin(time*{f2:.4f}*{speed} + Controls.Seed*{p * 1.9:.3f} + {i * 2.3 + 0.9:.2f}) + '
            f'0.15*sin(time*{f3:.4f}*{speed} + Controls.Seed*{p * 3.1:.3f} + {i * 0.7 + 2.1:.2f}))')


def jitter(i, hold='1'):
    """Per-frame random value in -1..1 that changes every `hold` frames."""
    p = _PRIMES[i % len(_PRIMES)]
    k = f'floor(time / max(1, {hold}))'
    h = f'(sin(({k} + Controls.Seed*{p} + {i * 31.7:.1f}) * 12.9898) * 43758.5453)'
    return f'(2*({h} - floor({h})) - 1)'


def chance(i, threshold, hold='1'):
    """1 on roughly (1 - threshold) of frames, otherwise 0."""
    return f'iif({jitter(i, hold)} > {threshold}*2 - 1, 1, 0)'


# ---------------------------------------------------------------- the builder
class Build:
    """One template under construction."""

    def __init__(self, kind, name, family, blurb, styles=None, tags=None):
        assert kind in ('Effects', 'Transitions', 'Titles')
        self.kind, self.name, self.family, self.blurb = kind, name, family, blurb
        self.styles = styles or []
        self.tags = tags or []
        self.tools = Ordered()
        self.ctrl_ui = Ordered()       # UserControls on the Controls holder
        self.ctrl_inputs = Ordered()   # values / expressions of those controls
        self.exposed = []              # [(key, InstanceInput)] in Inspector order
        self.groups = []               # [(label key, first index)] open groups
        self.outputs = None
        self.exempt = []               # 'Tool.Input' patterns the checker skips
        self.defaults = {}             # control key -> default, for the manifest
        self.controls_doc = []         # Inspector names, for the manifest
        self._x = 0
        self._cg = 0
        self.add('Controls', 'AlphaDivide', {}, passthrough=True, CtrlWShown=False, pos=(0, -66))
        TEMPLATES.append(self)

    # --- ids
    @property
    def macro_name(self):
        return 'HC' + ''.join(ch for ch in self.name.title() if ch.isalnum())

    @property
    def script_id(self):
        return f'Fusion/{self.kind}/{CATEGORY}/{self.name}'

    # --- tools
    def add(self, name, typ, inputs=None, pos=None, **extra):
        if name in self.tools:
            raise ValueError(f'{self.name}: duplicate tool {name}')
        if pos is None:
            pos = (self._x, 0)
            self._x += 110
        self.tools[name] = Tool(typ, Ordered(inputs or {}), pos=pos, **extra)
        return name

    def set(self, tool, inp, value):
        self.tools[tool].body['Inputs'][inp] = value

    # --- controls on the holder
    def control(self, key, ui, value=None, expr=None, expose=True, name=None):
        ui = dict(ui)
        if expr is not None:
            ui['IC_Visible'] = False
        self.ctrl_ui[key] = ui
        self.tools['Controls'].body['UserControls'] = self.ctrl_ui
        default = ui.get('INP_Default', value if value is not None else 0)
        self.ctrl_inputs[key] = Inp(value if value is not None else (default if expr is None else 0), expr=expr)
        self.tools['Controls'].body['Inputs'] = self.ctrl_inputs
        if expose and expr is None:
            self.expose(key, 'Controls', key, name=name or ui['LINKS_Name'], default=default)
            self.defaults[key] = default
        return f'Controls.{key}'

    def hidden(self, key, expr):
        return self.control(key, slider(key, 0, 1), expr=expr, expose=False)

    def expose(self, key, srcop, src, name=None, default=None, doc=True, **extra):
        self.exposed.append((key, II(srcop, src, name=name, default=default, **extra)))
        if doc and name:
            self.controls_doc.append(name)

    def colour(self, key, label_, rgb, tool=None):
        """A colour picker. Adds a Background tool holding the colour (or uses
        `tool`, which must have TopLeftRed/Green/Blue inputs) and exposes it.
        Returns (r, g, b) expressions."""
        tool = tool or self.add(key, 'Background', {
            'UseFrameFormatSettings': Inp(1), 'Width': Inp(1920), 'Height': Inp(1080),
            'TopLeftRed': Inp(rgb[0]), 'TopLeftGreen': Inp(rgb[1]),
            'TopLeftBlue': Inp(rgb[2]), 'TopLeftAlpha': Inp(1)})
        self._cg += 1
        cg = 100 + self._cg
        self.expose(key + 'R', tool, 'TopLeftRed', name=label_, default=rgb[0], ControlGroup=cg)
        self.expose(key + 'G', tool, 'TopLeftGreen', default=rgb[1], ControlGroup=cg, doc=False)
        self.expose(key + 'B', tool, 'TopLeftBlue', default=rgb[2], ControlGroup=cg, doc=False)
        return (f'{tool}.TopLeftRed', f'{tool}.TopLeftGreen', f'{tool}.TopLeftBlue')

    # --- Inspector groups
    def begin(self, title):
        key = 'Grp' + ''.join(ch for ch in title if ch.isalnum())
        ui = label(title, group=1)
        ui['INP_Default'] = 1
        self.ctrl_ui[key] = ui
        self.tools['Controls'].body['UserControls'] = self.ctrl_ui
        self.exposed.append((key, II('Controls', key, name=title)))
        self.groups.append((key, len(self.exposed)))

    def end(self):
        key, first = self.groups.pop()
        n = len(self.exposed) - first
        if n <= 0:     # empty group: drop the label
            self.exposed = [e for e in self.exposed if e[0] != key]
            del self.ctrl_ui[key]
        else:
            self.ctrl_ui[key]['LBLC_NumInputs'] = n

    # --- finish
    def finish(self, out):
        assert not self.groups, f'{self.name}: unclosed group'
        self.outputs = {'MainOutput1': IO(out)}

    def macro(self):
        inputs = Ordered()
        if self.kind == 'Effects':
            inputs['MainInput1'] = II('SrcA', 'Input')
        elif self.kind == 'Transitions':
            inputs['MainInput1'] = II('SrcA', 'Input')
            inputs['MainInput2'] = II('SrcB', 'Input')
        for key, ii in self.exposed:
            inputs[key] = ii
        return Macro(self.macro_name, self.tools, inputs, self.outputs)

    def manifest(self):
        return {
            'id': self.script_id, 'kind': self.kind[:-1].lower(), 'name': self.name,
            'family': self.family, 'blurb': self.blurb, 'styles': self.styles,
            'controls': self.controls_doc, 'defaults': self.defaults, 'tags': self.tags,
        }


# ---------------------------------------------------------------- tool helpers
def src(b, name='SrcA'):
    """A pass-through entry point (Fusion's Pipe Router). The macro's main
    input lands here so several tools can read the clip."""
    return b.add(name, 'PipeRouter', {})


def conn(tool, out='Output'):
    return Inp(srcop=tool, src=out)


def num(v):
    """A plain value, or an expression if v is a string."""
    return Inp(expr=v) if isinstance(v, str) else Inp(v)


def xf(b, name, source, center=None, size=None, angle=None, edges=None, mblur=False, **more):
    inp = {'Input': conn(source)}
    if center is not None:
        inp['Center'] = Inp(expr=f'Point({center[0]}, {center[1]})') if any(
            isinstance(c, str) for c in center) else Inp([center[0], center[1]])
    if size is not None:
        inp['Size'] = num(size)
    if angle is not None:
        inp['Angle'] = num(angle)
    if edges is not None:
        inp['Edges'] = Inp(edges)
    if mblur:
        inp['MotionBlur'] = Inp(1)
        inp['Quality'] = Inp(4)
        inp['ShutterAngle'] = num(mblur) if not isinstance(mblur, bool) else Inp(180)
    for k, v in more.items():
        inp[k] = num(v)
    return b.add(name, 'Transform', inp)


EDGES_CANVAS, EDGES_WRAP, EDGES_DUPLICATE, EDGES_MIRROR = 0, 1, 2, 3

# Mask units. EllipseMask Width and Height are both in frame widths (its
# default is a circle). RectangleMask appears to measure Width in frame widths
# and Height in frame heights (its default matches the frame's aspect). The
# Letterbox test in tools/dev/test_pack.py measures this; if it reports the
# other result, set this to False and rebuild.
RECT_HEIGHT_IN_FRAME_HEIGHTS = True


def time_tap(b, name, source, delay, blend_frames=True):
    """The clip `delay` frames late (fractional delays blend two frames).
    Uses TimeStretcher's SourceTime, which may change every frame, rather
    than TimeSpeed's Delay, which is meant to stay constant."""
    return b.add(name, 'TimeStretcher', {'Input': conn(source),
                                         'SourceTime': Inp(expr=f'time - ({delay})'),
                                         'InterpolateBetweenFrames': Inp(1 if blend_frames else 0)})


def merge(b, name, bg, fg, mode='Normal', blend=None, additive=False, mask=None, **more):
    inp = {'Background': conn(bg), 'Foreground': conn(fg)}
    if mode != 'Normal':
        inp['ApplyMode'] = Inp(FuID(mode))
    if additive:
        inp['Gain'] = Inp(0)
    if blend is not None:
        inp['Blend'] = num(blend)
    if mask is not None:
        inp['EffectMask'] = conn(mask, 'Mask' if b.tools[mask].typ.endswith('Mask') else 'Output')
    for k, v in more.items():
        inp[k] = num(v)
    return b.add(name, 'Merge', inp)


def dissolve(b, name, a, bb, mix):
    return b.add(name, 'Dissolve', {'Background': conn(a), 'Foreground': conn(bb), 'Mix': num(mix)})


def bc(b, name, source, mask=None, **vals):
    """Brightness / Contrast on colour only. Alpha is set explicitly because
    Fusion's manual and saved files disagree on whether it is on by default."""
    inp = {'Input': conn(source), 'Alpha': Inp(0)}
    for k, v in vals.items():
        inp[k] = num(v)
    if mask is not None:
        inp['EffectMask'] = conn(mask, 'Mask' if b.tools[mask].typ.endswith('Mask') else 'Output')
    return b.add(name, 'BrightnessContrast', inp)


def gain(b, name, source, r=1, g=1, bl=1, a=1, **more):
    inp = {'Input': conn(source), 'GainRed': num(r), 'GainGreen': num(g),
           'GainBlue': num(bl), 'GainAlpha': num(a)}
    for k, v in more.items():
        inp[k] = num(v)
    return b.add(name, 'ColorGain', inp)


def blur(b, name, source, size, **more):
    inp = {'Input': conn(source), 'XBlurSize': num(size)}
    for k, v in more.items():
        inp[k] = num(v)
    return b.add(name, 'Blur', inp)


def dblur(b, name, source, kind, length, angle=None, center=None, **more):
    """kind: 0 Linear, 1 Radial, 2 Centred, 3 Zoom."""
    inp = {'Input': conn(source), 'Type': Inp(kind), 'Length': num(length)}
    if angle is not None:
        inp['Angle'] = num(angle)
    if center is not None:
        inp['Center'] = Inp([center[0], center[1]])
    for k, v in more.items():
        inp[k] = num(v)
    return b.add(name, 'DirectionalBlur', inp)


def glow(b, name, source, blend, gain_=2.0, threshold=0.6, size=12):
    return b.add(name, 'SoftGlow', {'Input': conn(source), 'Threshold': num(threshold),
                                    'Gain': num(gain_), 'XGlowSize': num(size), 'Blend': num(blend)})


def solid(b, name, rgb=(1, 1, 1), alpha=1):
    return b.add(name, 'Background', {
        'UseFrameFormatSettings': Inp(1), 'Width': Inp(1920), 'Height': Inp(1080),
        'TopLeftRed': num(rgb[0]), 'TopLeftGreen': num(rgb[1]), 'TopLeftBlue': num(rgb[2]),
        'TopLeftAlpha': num(alpha)})


def noise(b, name, detail=2.0, contrast=1.6, brightness=0.0, scale=1.5, seethe_rate=0.15, center=None, angle=None):
    inp = {'UseFrameFormatSettings': Inp(1), 'Width': Inp(1920), 'Height': Inp(1080),
           'Detail': num(detail), 'Contrast': num(contrast), 'Brightness': num(brightness),
           'XScale': num(scale), 'SeetheRate': num(seethe_rate)}
    if center is not None:
        inp['Center'] = Inp(expr=f'Point({center[0]}, {center[1]})')
    if angle is not None:
        inp['Angle'] = num(angle)
    return b.add(name, 'FastNoise', inp)


def ellipse(b, name, w, h, soft, invert=False, center=None):
    inp = {'Width': num(w), 'Height': num(h), 'SoftEdge': num(soft)}
    if invert:
        inp['Invert'] = Inp(1)
    if center is not None:
        inp['Center'] = Inp(expr=f'Point({center[0]}, {center[1]})') if any(
            isinstance(c, str) for c in center) else Inp([center[0], center[1]])
    return b.add(name, 'EllipseMask', inp)


def rect(b, name, w, h, soft=0.0, invert=False, center=None, corner=None):
    inp = {'Width': num(w), 'Height': num(h), 'SoftEdge': num(soft)}
    if invert:
        inp['Invert'] = Inp(1)
    if corner is not None:
        inp['CornerRadius'] = num(corner)
    if center is not None:
        inp['Center'] = Inp(expr=f'Point({center[0]}, {center[1]})') if any(
            isinstance(c, str) for c in center) else Inp([center[0], center[1]])
    return b.add(name, 'RectangleMask', inp)


def plate(b, name, dx, dy, soft=None):
    """An opaque full-frame matte shifted by (dx, dy) frame widths/heights.
    Used as an effect mask for wipes, blades and splits: it stays exact at any
    aspect ratio because Transform offsets are relative to the frame."""
    s = solid(b, name + 'Fill', (1, 1, 1), 1)
    t = xf(b, name, s, center=(f'0.5 + {dx}', f'0.5 + {dy}'), edges=EDGES_CANVAS)
    if soft is not None:
        return blur(b, name + 'Soft', t, soft)
    return t


def rgb_split(b, prefix, source, dx, dy, edges=EDGES_MIRROR):
    """Split red and blue away from green by (dx, dy) and add them back up.
    With dx = dy = 0 the result equals the source."""
    r = gain(b, prefix + 'R', source, 1, 0, 0, 1 / 3)
    g = gain(b, prefix + 'G', source, 0, 1, 0, 1 / 3)
    bl = gain(b, prefix + 'B', source, 0, 0, 1, 1 / 3)
    rx = xf(b, prefix + 'RShift', r, center=(f'0.5 - ({dx})', f'0.5 - ({dy})'), edges=edges)
    bx = xf(b, prefix + 'BShift', bl, center=(f'0.5 + ({dx})', f'0.5 + ({dy})'), edges=edges)
    m1 = merge(b, prefix + 'AddR', g, rx, additive=True)
    return merge(b, prefix + 'AddB', m1, bx, additive=True)


DIRECTIONS = ['Left', 'Right', 'Up', 'Down']


def dir_x(sel='Controls.Direction'):
    return f'iif({sel} == 0, -1, iif({sel} == 1, 1, 0))'


def dir_y(sel='Controls.Direction'):
    return f'iif({sel} == 2, 1, iif({sel} == 3, -1, 0))'


def dir_angle(sel='Controls.Direction'):
    """DirectionalBlur angle for the direction of travel."""
    return f'iif({sel} < 2, 0, 90)'
