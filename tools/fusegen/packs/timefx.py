"""HermiteCut Time FX: Slow Shutter, Echo, Prism, Stutter and Time Shift.

They are built from TimeStretcher taps (the same clip, a few frames late) mixed
back together. All five share the effect timing controls; they default to
*Whole* so they run across the clip. Every tap's delay scales with the
envelope, so outside the window the taps are the current frame and the clip is
untouched.
"""
from .common import (slider, combo, multibutton, AMT, PI, xf, merge, gain, blur, dblur,
                     time_tap, EDGES_MIRROR)
from .effects import effect, done

F = 'Time FX'
ENV1 = f'min(1, abs({AMT}))'


def tap(b, name, source, delay, blend_frames=True):
    return time_tap(b, name, source, delay, blend_frames)


def slow_shutter():
    b = effect('Slow Shutter', F, 'Real shutter-angle blur: 180, 360, 720 or 1440 degrees.',
               mode=3, frames=24, curve=0, styles=['180°', '360°', '720°', '1440°'])
    b.control('Shutter', multibutton('Shutter', ['180°', '360°', '720°', '1440°'], 2))
    span = (f'iif(Controls.Shutter == 0, 0.5, iif(Controls.Shutter == 1, 1, '
            f'iif(Controls.Shutter == 2, 2, 4))) * {AMT}')
    n = 8
    acc = 'SrcA'
    for i in range(1, n):
        t = tap(b, f'Tap{i}', 'SrcA', f'{span} * {i}/{n - 1}')
        acc = merge(b, f'Avg{i}', acc, t, blend=1 / (i + 1))
    done(b, acc, seed=False)


def echo():
    b = effect('Echo', F, 'Ghost trails behind motion: echoes, glass or stretch.', mode=3, frames=24, curve=0,
               styles=['Echoes', 'Glass', 'Stretch'])
    b.control('Style', combo('Style', ['Echoes', 'Glass', 'Stretch'], 0))
    b.control('Spacing', slider('Spacing (frames)', 1, 12, 3, minA=0.1, maxA=50))
    b.control('Trail', slider('Trail', 0, 1, 0.6))
    glass = 'iif(Controls.Style == 1, 1, 0)'
    stretch = 'iif(Controls.Style == 2, 1, 0)'
    n = 5
    acc = None
    for k in range(n, 0, -1):      # oldest first, so newer echoes sit on top
        t = tap(b, f'Tap{k}', 'SrcA', f'{k}*Controls.Spacing*{ENV1}')
        s = xf(b, f'Shape{k}', t, size=f'1 + {k}*{ENV1}*(0.012*{glass} + 0.045*{stretch})',
               edges=EDGES_MIRROR)
        g = blur(b, f'Frost{k}', s, f'{k}*{ENV1}*(3*{glass} + 0.8*{stretch})')
        acc = g if acc is None else merge(b, f'Stack{k}', acc, g, blend=0.5)
    out = merge(b, 'Echo', acc, 'SrcA', blend=f'1 - 0.75*Controls.Trail*{ENV1}')
    b.exempt.append('Echo.Blend')    # 1 = current frame only
    done(b, out, seed=False)


def prism():
    b = effect('Prism', F, 'Moving detail splits into a colour trail: spectrum or delay.', mode=3, frames=24,
               curve=0, styles=['Spectrum', 'Delay'])
    b.control('Style', combo('Style', ['Spectrum', 'Delay'], 0))
    b.control('Lag', slider('Delay (frames)', 0, 6, 1.5, minA=0, maxA=30))
    b.control('Spread', slider('Spread', 0, 0.03, 0.004))
    b.control('Angle', slider('Angle', -180, 180, 0))
    spec = [(1, 0, 0), (1, 1, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1), (1, 0, 1)]
    dly = [(1, 0, 0), (0, 1, 0), (0, 0, 1), (0, 0, 0), (0, 0, 0), (0, 0, 0)]
    acc = None
    for k in range(6):
        t = tap(b, f'Tap{k}', 'SrcA', f'{k}*Controls.Lag*{ENV1}')
        chans = [f'iif(Controls.Style == 0, {spec[k][c] / 3:.6f}, {dly[k][c]})' for c in range(3)]
        alpha = f'iif(Controls.Style == 0, {1 / 6:.6f}, {1 / 3 if k < 3 else 0:.6f})'
        tint = gain(b, f'Tint{k}', t, *chans, alpha)
        off = f'{k}*Controls.Spread*{ENV1}'
        s = xf(b, f'Offset{k}', tint, center=(f'0.5 - {off}*cos(Controls.Angle*{PI}/180)',
                                             f'0.5 - {off}*sin(Controls.Angle*{PI}/180)'),
               edges=EDGES_MIRROR)
        acc = s if acc is None else merge(b, f'Add{k}', acc, s, additive=True)
    b.exempt.append('Tint*.Gain*')   # the tints add back up to white
    done(b, acc, seed=False)


def stutter():
    b = effect('Stutter', F, 'Held, repeated frames: classic steps or soft trails.', mode=3, frames=24,
               curve=0, styles=['Classic', 'Soft Trails'])
    b.control('Style', combo('Style', ['Classic', 'Soft Trails'], 0))
    b.control('Hold', slider('Hold (frames)', 2, 12, 3, integer=True, minA=2, maxA=60))
    on = f'iif({ENV1} > 0.0001, 1, 0)'
    rel = '(time - comp.RenderStart)'
    held = f'({rel} - floor({rel}/Controls.Hold)*Controls.Hold)'
    hold = tap(b, 'Hold', 'SrcA', f'{held}*{on}', blend_frames=False)
    prev = tap(b, 'Previous', 'SrcA', f'({held} + Controls.Hold)*{on}', blend_frames=False)
    ghost = blur(b, 'Ghost', prev, 4)
    soft = 'iif(Controls.Style == 1, 1, 0)'
    out = merge(b, 'Trails', hold, ghost, mode='Lighten', blend=f'0.45*{soft}*{ENV1}')
    done(b, out, seed=False)


def time_shift():
    b = effect('Time Shift', F, 'Vertical streaks that follow motion: pull up or pull down.', mode=3,
               frames=24, curve=0, styles=['Pull Up', 'Pull Down'])
    b.control('Style', combo('Style', ['Pull Up', 'Pull Down'], 0))
    b.control('Length', slider('Length', 0, 0.5, 0.12))
    b.control('Spacing', slider('Spacing (frames)', 1, 6, 2, minA=0.1, maxA=30))
    b.control('Mix', slider('Mix', 0, 1, 0.85))
    sign = 'iif(Controls.Style == 0, 1, -1)'
    n = 6
    acc = None
    for k in range(1, n + 1):
        t = tap(b, f'Tap{k}', 'SrcA', f'{k}*Controls.Spacing*{ENV1}')
        s = xf(b, f'Lift{k}', t, center=('0.5', f'0.5 + {sign}*Controls.Length*{ENV1}*{k}/{n}'),
               edges=EDGES_MIRROR)
        acc = s if acc is None else merge(b, f'Streak{k}', acc, s, mode='Lighten')
    smear = dblur(b, 'Smear', acc, 0, f'0.4*Controls.Length*{ENV1}', angle=90)
    out = merge(b, 'Shift', 'SrcA', smear, mode='Lighten', blend=f'Controls.Mix*{ENV1}')
    done(b, out, seed=False)


def build():
    slow_shutter()
    echo()
    prism()
    stutter()
    time_shift()
