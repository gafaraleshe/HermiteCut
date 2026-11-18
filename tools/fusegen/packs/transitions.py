"""HermiteCut transitions.

MainInput1 is the outgoing clip (A) and MainInput2 the incoming clip (B).
Hidden controls: Raw (linear progress), Prog (shaped by Curve) and Peak
(0 at both ends, 1 in the middle). At the first frame the output is exactly A,
at the last frame exactly B. Most transitions carry Direction, Curve, Blur,
Glow and Flash controls.
"""
from .common import (Build, Inp, slider, combo, TRANSITION_CURVES, transition_curve, clamp01, PI,
                     jitter, chance, wobble, src, conn, xf, merge, dissolve, bc, blur, dblur, glow,
                     solid, noise, rect, ellipse, plate, rgb_split, gain,
                     EDGES_CANVAS, EDGES_WRAP, EDGES_MIRROR, DIRECTIONS, dir_x, dir_y, dir_angle)

PROG = 'Controls.Prog'
PEAK = 'Controls.Peak'


def transition(name, family, blurb, curve=1, directions=None, direction=0, blur_=None, glow_=None,
               flash_=None, strength=None, styles=None):
    b = Build('Transitions', name, family, blurb, styles=styles)
    src(b, 'SrcA')
    src(b, 'SrcB')
    b.begin('Motion')
    if directions:
        b.control('Direction', combo('Direction', directions, direction))
    b.control('Curve', combo('Curve', TRANSITION_CURVES, curve))
    b.end()
    b.hidden('Raw', clamp01('(time - comp.RenderStart) / max(1, comp.RenderEnd - comp.RenderStart)'))
    b.hidden('Prog', transition_curve())
    p = 'max(0, min(1, Controls.Prog))'
    b.hidden('Peak', f'4*{p}*(1 - {p})')
    b.begin('Look')
    if strength is not None:
        b.control('Strength', slider('Strength', 0, 2, strength, minA=0, maxA=10))
    if blur_ is not None:
        b.control('Blur', slider('Blur', 0, 2, blur_, minA=0, maxA=10))
    if glow_ is not None:
        b.control('Glow', slider('Glow', 0, 2, glow_, minA=0, maxA=10))
    if flash_ is not None:
        b.control('Flash', slider('Flash', 0, 2, flash_, minA=0, maxA=10))
    return b


def cut(soft):
    """A -> B switch at the middle, softened over `soft` of the progress."""
    return clamp01(f'({PROG} - 0.5)/{soft} + 0.5')


def finish(b, comp, linear=False, zoom=False, seed=False, flash_colour=True):
    """Shared look chain: directional / zoom blur, glow and flash, all at Peak."""
    out = comp
    if 'Blur' in b.ctrl_ui and linear:
        out = dblur(b, 'Streak', out, 0, f'0.3*Controls.Blur*{PEAK}', angle=dir_angle())
    if 'Blur' in b.ctrl_ui and zoom:
        out = dblur(b, 'ZoomStreak', out, 3, f'0.35*Controls.Blur*{PEAK}')
    if 'Glow' in b.ctrl_ui:
        out = glow(b, 'Bloom', out, blend=f'min(1, Controls.Glow*{PEAK})', gain_=2.5, threshold=0.5, size=20)
    if 'Flash' in b.ctrl_ui:
        out = bc(b, 'Expose', out, Gain=f'1 + 2.5*Controls.Flash*{PEAK}^3')
        if flash_colour:
            b.colour('FlashColour', 'Flash colour', (1, 1, 1))
            out = merge(b, 'Wash', out, 'FlashColour', blend=f'min(1, 0.85*Controls.Flash*{PEAK}^5)')
    if seed:
        b.control('Seed', slider('Seed', 0, 100, 0, integer=True, minA=0, maxA=100000))
    else:
        b.control('Seed', slider('Seed', 0, 100, 0, integer=True), expose=False)
    b.end()
    b.finish(out)


def pair_move(b, a_center=None, b_center=None, a_size=None, b_size=None, a_angle=None, b_angle=None,
              edges=EDGES_MIRROR, shutter=True):
    mb = '360*min(1, Controls.Blur)' if 'Blur' in b.ctrl_ui else True
    ta = xf(b, 'MoveA', 'SrcA', center=a_center, size=a_size, angle=a_angle, edges=edges,
            mblur=mb if shutter else False)
    tb = xf(b, 'MoveB', 'SrcB', center=b_center, size=b_size, angle=b_angle, edges=edges,
            mblur=mb if shutter else False)
    return ta, tb


DX, DY = dir_x(), dir_y()


# =============================================================== Motion
def motion():
    F = 'Motion'

    def whip(name, blurb, dist, curve=2, blur_=1.0, glow_=0.0, flash_=0.0, zoom=0.0, family=F):
        b = transition(name, family, blurb, curve=curve, directions=DIRECTIONS, blur_=blur_,
                       glow_=glow_, flash_=flash_)
        b.control('Distance', slider('Distance', 0, 1.5, dist))
        d = 'Controls.Distance'
        size_a = f'1 + {zoom}*{PEAK}' if zoom else None
        ta, tb = pair_move(b, a_center=(f'0.5 + {DX}*{PROG}*{d}', f'0.5 + {DY}*{PROG}*{d}'),
                           b_center=(f'0.5 - {DX}*(1 - {PROG})*{d}', f'0.5 - {DY}*(1 - {PROG})*{d}'),
                           a_size=size_a, b_size=size_a)
        comp = dissolve(b, 'Cut', ta, tb, cut(0.08))
        finish(b, comp, linear=True)

    whip('Whip', 'A fast whip pan from one shot into the next.', 0.6)
    whip('Hyper Slide', 'An exaggerated slide with a zoom bump and heavy blur.', 1.0, blur_=1.3, glow_=0.25,
         zoom=0.35)
    whip('Swish Glow', 'A whip that blooms with light on the cut.', 0.6, blur_=1.0, glow_=0.9, flash_=0.3,
         family='Light')

    b = transition('Slide', F, 'A clean push: the new shot pushes the old one out.', curve=1,
                   directions=DIRECTIONS, blur_=0.3)
    ta, tb = pair_move(b, a_center=(f'0.5 + {DX}*{PROG}', f'0.5 + {DY}*{PROG}'),
                       b_center=(f'0.5 - {DX}*(1 - {PROG})', f'0.5 - {DY}*(1 - {PROG})'), edges=EDGES_CANVAS)
    comp = merge(b, 'Push', ta, tb)
    finish(b, comp, linear=True)

    b = transition('Split Slide', F, 'Top and bottom halves slide apart in opposite directions.', curve=1,
                   directions=['Left', 'Right'], blur_=0.4)
    sx = 'iif(Controls.Direction == 0, -1, 1)'
    mb = '360*min(1, Controls.Blur)'
    at = xf(b, 'TopA', 'SrcA', center=(f'0.5 + {sx}*{PROG}', '0.5'), edges=EDGES_CANVAS, mblur=mb)
    ab = xf(b, 'BottomA', 'SrcA', center=(f'0.5 - {sx}*{PROG}', '0.5'), edges=EDGES_CANVAS, mblur=mb)
    bt = xf(b, 'TopB', 'SrcB', center=(f'0.5 - {sx}*(1 - {PROG})', '0.5'), edges=EDGES_CANVAS, mblur=mb)
    bb = xf(b, 'BottomB', 'SrcB', center=(f'0.5 + {sx}*(1 - {PROG})', '0.5'), edges=EDGES_CANVAS, mblur=mb)
    top = merge(b, 'Top', at, bt)
    bottom = merge(b, 'Bottom', ab, bb)
    half = plate(b, 'TopHalf', '0', '0.5')
    comp = merge(b, 'Split', bottom, top, mask=half)
    finish(b, comp)

    b = transition('Spin 360', F, 'A full spin with motion blur from one shot to the next.', curve=2,
                   directions=['Clockwise', 'Anticlockwise'], blur_=1.0, glow_=0.0)
    sg = 'iif(Controls.Direction == 0, -1, 1)'
    size = f'1 + 0.4*{PEAK}'
    ta, tb = pair_move(b, a_angle=f'{sg}*180*{PROG}', b_angle=f'-{sg}*180*(1 - {PROG})',
                       a_size=size, b_size=size)
    comp = dissolve(b, 'Cut', ta, tb, cut(0.1))
    finish(b, comp)

    b = transition('Scale In', F, 'Zoom through the outgoing shot into the next.', curve=2, blur_=1.0)
    b.control('Zoom', slider('Zoom', 0, 4, 1.5))
    ta, tb = pair_move(b, a_size=f'1 + Controls.Zoom*{PROG}', b_size=f'1 + Controls.Zoom*(1 - {PROG})')
    comp = dissolve(b, 'Cut', ta, tb, cut(0.1))
    finish(b, comp, zoom=True)

    b = transition('Scale Out', F, 'Pull back out of the outgoing shot into the next.', curve=2, blur_=1.0)
    b.control('Zoom', slider('Zoom', 0, 4, 1.5))
    ta, tb = pair_move(b, a_size=f'1 / (1 + Controls.Zoom*{PROG})',
                       b_size=f'1 / (1 + Controls.Zoom*(1 - {PROG}))')
    comp = dissolve(b, 'Cut', ta, tb, cut(0.1))
    finish(b, comp, zoom=True)

    b = transition('Grid', F, 'Both shots tile into a grid and back out.', curve=1, blur_=0.5)
    b.control('Tiles', slider('Tiles', 1, 6, 2, minA=0, maxA=20))
    size = f'1 / (1 + Controls.Tiles*{PEAK})'
    ta, tb = pair_move(b, a_size=size, b_size=size, edges=EDGES_WRAP)
    comp = dissolve(b, 'Cut', ta, tb, cut(0.06))
    finish(b, comp)

    b = transition('Shake', F, 'A rough camera shake across the cut.', curve=1, strength=1.0, blur_=0.6)
    comp = dissolve(b, 'Mix', 'SrcA', 'SrcB', cut(0.5))
    amt = f'Controls.Strength*{PEAK}'
    t = xf(b, 'Shake', comp, center=(f'0.5 + 0.05*{amt}*{jitter(0)}', f'0.5 + 0.05*{amt}*{jitter(1)}'),
           angle=f'3*{amt}*{jitter(2)}', size=f'1 + 0.08*{amt}', edges=EDGES_MIRROR,
           mblur='360*min(1, Controls.Blur)')
    finish(b, t, seed=True)


# =============================================================== Light
def light():
    F = 'Light'

    b = transition('Lens Flare', F, 'A warm flare sweeps across and carries the cut.', curve=1,
                   directions=['Left', 'Right'], strength=1.0, glow_=0.6)
    comp = dissolve(b, 'Mix', 'SrcA', 'SrcB', cut(0.35))
    r, g, bl = b.colour('FlareColour', 'Flare colour', (1.0, 0.82, 0.6))
    sx = 'iif(Controls.Direction == 0, -1, 1)'
    fx = f'0.5 + {sx}*(1.3*{PROG} - 0.65)'
    core = ellipse(b, 'Core', 0.5, 0.5, 0.35, center=(fx, '0.62'))
    body = solid(b, 'CoreFill', (r, g, bl))
    b.set('CoreFill', 'EffectMask', Inp(srcop='Core', src='Mask'))
    streak = ellipse(b, 'Streak', 1.8, 0.03, 0.04, center=(fx, '0.62'))
    line = solid(b, 'StreakFill', (r, g, bl))
    b.set('StreakFill', 'EffectMask', Inp(srcop='Streak', src='Mask'))
    flare = merge(b, 'Flare', body, line, mode='Screen')
    out = merge(b, 'Sweep', comp, flare, mode='Screen', blend=f'min(1, Controls.Strength*{PEAK})')
    finish(b, out)

    b = transition('Light Wipe', F, 'A soft wipe led by a bright band of light.', curve=1,
                   directions=['Left', 'Right'], strength=1.0, glow_=0.5)
    s = 0.1
    edge = f'iif(Controls.Direction == 1, {-s} + {1 + 2 * s}*{PROG}, {1 + s} - {1 + 2 * s}*{PROG})'
    dx = f'iif(Controls.Direction == 1, {edge} - 1, {edge})'
    m = plate(b, 'Reveal', dx, '0', soft=30)
    comp = merge(b, 'Wipe', 'SrcA', 'SrcB', mask=m)
    band = b.add('Band', 'RectangleMask', {'Width': Inp(0.1), 'Height': Inp(4), 'SoftEdge': Inp(0.06),
                                           'Center': Inp(expr=f'Point({edge}, 0.5)')})
    out = bc(b, 'Light', comp, mask=band, Gain=f'1 + 2.5*Controls.Strength*{PEAK}')
    b.exempt.append('Band.*')
    finish(b, out)

    b = transition('Exposure Flash', F, 'Blow out to white on the cut and come back.', curve=1, flash_=1.0,
                   glow_=0.4)
    comp = dissolve(b, 'Mix', 'SrcA', 'SrcB', cut(0.25))
    finish(b, comp)

    b = transition('Film Burn', F, 'A hot film burn flares over the cut.', curve=1, strength=1.0)
    comp = dissolve(b, 'Mix', 'SrcA', 'SrcB', cut(0.3))
    n = noise(b, 'Burn', detail=3.0, contrast=2.6, brightness=-0.3, scale=1.1, seethe_rate=0.15,
              center=(f'0.5 + 0.3*{wobble(0, speed="1", base=0.05)}', '0.5'))
    r, g, bl = b.colour('BurnColour', 'Burn colour', (1.0, 0.42, 0.08))
    tint = gain(b, 'Tint', n, f'2*{r}', f'2*{g}', f'2*{bl}', 1)
    heat = blur(b, 'Heat', tint, 6)
    hot = bc(b, 'Expose', comp, Gain=f'1 + 0.8*Controls.Strength*{PEAK}')
    out = merge(b, 'Flare', hot, heat, mode='Screen', blend=f'min(1, 1.3*Controls.Strength*{PEAK})')
    finish(b, out, seed=True)

    b = transition('Light Leak', F, 'A soft wash of warm light across the cut.', curve=1, strength=1.0)
    comp = dissolve(b, 'Mix', 'SrcA', 'SrcB', cut(0.5))
    n = noise(b, 'Leak', detail=0.5, contrast=1.4, brightness=-0.05, scale=0.35, seethe_rate=0.06,
              center=(f'0.5 + 0.4*{wobble(1, speed="1", base=0.04)}', '0.55'))
    r, g, bl = b.colour('LeakColour', 'Leak colour', (1.0, 0.45, 0.35))
    tint = gain(b, 'Tint', n, f'1.7*{r}', f'1.7*{g}', f'1.7*{bl}', 1)
    soft = blur(b, 'Diffuse', tint, 40)
    out = merge(b, 'Wash', comp, soft, mode='Screen', blend=f'min(1, 1.2*Controls.Strength*{PEAK})')
    finish(b, out, seed=True)

    b = transition('Luma Fade', F, 'The new shot appears through its brightest areas first.', curve=1,
                   glow_=0.0)
    b.control('Softness', slider('Softness', 0.01, 0.6, 0.2))
    low = f'(1.1 - (1.4 + Controls.Softness)*{PROG})'
    key = b.add('Key', 'LumaKeyer', {'Input': conn('SrcB'), 'Low': Inp(expr=low),
                                     'High': Inp(expr=f'{low} + Controls.Softness')})
    comp = merge(b, 'Reveal', 'SrcA', key)
    b.exempt.append('Key.*')
    finish(b, comp)


# =============================================================== Glitch
def glitchy():
    F = 'Glitch'

    b = transition('Chromatic Split', F, 'The picture splits into red, green and blue across the cut.',
                   curve=2, directions=DIRECTIONS, strength=1.0, blur_=0.6, glow_=0.0)
    comp = dissolve(b, 'Cut', 'SrcA', 'SrcB', cut(0.1))
    amt = f'Controls.Strength*{PEAK}'
    z = xf(b, 'Bump', comp, size=f'1 + 0.08*{amt}', edges=EDGES_MIRROR)
    sp = rgb_split(b, 'Split', z, f'0.05*{amt}*({DX})', f'0.05*{amt}*({DY})')
    finish(b, sp, linear=True)

    b = transition('Glitch', F, 'Torn digital slices and colour shifts carry the cut.', curve=0, strength=1.0)
    comp = dissolve(b, 'Cut', 'SrcA', 'SrcB', cut(0.06))
    cur = comp
    amt = f'Controls.Strength*{PEAK}'
    for i in range(6):
        on = chance(20 + i, 0.3, '2')
        sh = xf(b, f'Slice{i}', comp, center=(f'0.5 + 0.12*{amt}*{on}*{jitter(30 + i, "2")}', '0.5'),
                edges=EDGES_WRAP)
        m = rect(b, f'Band{i}', 3, f'0.02 + 0.1*abs({jitter(40 + i, "2")})',
                 center=('0.5', f'0.5 + 0.48*{jitter(50 + i, "2")}'))
        cur = merge(b, f'Tear{i}', cur, sh, mask=m)
    out = rgb_split(b, 'Split', cur, f'0.03*{amt}*{jitter(60)}', '0')
    finish(b, out, seed=True)

    b = transition('Negative', F, 'Inverted frames flicker over the cut.', curve=1, strength=1.0)
    comp = dissolve(b, 'Cut', 'SrcA', 'SrcB', cut(0.08))
    white = solid(b, 'White', (1, 1, 1))
    flick = 'iif(floor(time) - 2*floor(time/2) < 0.5, 1, 0.55)'
    out = merge(b, 'Invert', comp, white, mode='Difference',
                blend=f'min(1, Controls.Strength) * iif({PEAK} > 0.35, {flick}, 0)')
    finish(b, out)

    b = transition('Displace', F, 'The picture warps through a liquid ripple into the next.', curve=1,
                   strength=1.0, glow_=0.0)
    comp = dissolve(b, 'Mix', 'SrcA', 'SrcB', cut(0.4))
    n = noise(b, 'Ripple', detail=2.0, contrast=1.5, brightness=0, scale=2.5, seethe_rate=0.3)
    warp = b.add('Warp', 'Displace', {'Input': conn(comp), 'Foreground': conn(n), 'Type': Inp(0),
                                      'RefractionStrength': Inp(expr=f'0.12*Controls.Strength*{PEAK}')})
    finish(b, warp, seed=True)


# =============================================================== Blur
def blurry():
    F = 'Blur'

    b = transition('Focus Pull', F, 'Rack out of focus, cut, and pull back into focus.', curve=1, blur_=1.0,
                   glow_=0.2)
    comp = dissolve(b, 'Mix', 'SrcA', 'SrcB', cut(0.5))
    soft = blur(b, 'Rack', comp, f'45*Controls.Blur*{PEAK}')
    z = xf(b, 'Breathe', soft, size=f'1 + 0.03*{PEAK}', edges=EDGES_MIRROR)
    finish(b, z)

    b = transition('Zoom Blur', F, 'A punchy zoom streak through the cut.', curve=2, blur_=1.2, flash_=0.0)
    comp = dissolve(b, 'Cut', 'SrcA', 'SrcB', cut(0.1))
    z = xf(b, 'Punch', comp, size=f'1 + 0.25*{PEAK}', edges=EDGES_MIRROR)
    finish(b, z, zoom=True)


# =============================================================== Shutter
def shutters():
    F = 'Shutter'

    def blades(b, comp, close):
        hor = 'iif(Controls.Direction == 1, 1, 0)'
        ver = f'(1 - {hor})'
        r, g, bl = b.colour('BladeColour', 'Blade colour', (0, 0, 0))
        f1 = solid(b, 'BladeFill1', (r, g, bl))
        f2 = solid(b, 'BladeFill2', (r, g, bl))
        b1 = xf(b, 'Blade1', f1, center=(f'0.5 + {hor}*(-1 + 0.5*{close})', f'0.5 + {ver}*(1 - 0.5*{close})'),
                edges=EDGES_CANVAS)
        b2 = xf(b, 'Blade2', f2, center=(f'0.5 + {hor}*(1 - 0.5*{close})', f'0.5 + {ver}*(-1 + 0.5*{close})'),
                edges=EDGES_CANVAS)
        s1 = blur(b, 'Edge1', b1, 3)
        s2 = blur(b, 'Edge2', b2, 3)
        m1 = merge(b, 'Close1', comp, s1)
        return merge(b, 'Close2', m1, s2)

    b = transition('Shutter Swipe', F, 'Shutter blades snap shut and open on the next shot.', curve=1,
                   directions=['Vertical', 'Horizontal'], flash_=0.25)
    comp = dissolve(b, 'Cut', 'SrcA', 'SrcB', cut(0.02))
    out = blades(b, comp, f'min(1, 1.4*{PEAK})')
    finish(b, out)

    b = transition('Shutter Whip', F, 'A whip pan with a quick shutter blink in the middle.', curve=2,
                   directions=['Vertical', 'Horizontal'], blur_=1.0, flash_=0.2)
    b.control('Distance', slider('Distance', 0, 1.5, 0.6))
    hx = 'iif(Controls.Direction == 1, 1, 0)'
    vy = f'(1 - {hx})'
    d = 'Controls.Distance'
    ta, tb = pair_move(b, a_center=(f'0.5 - {hx}*{PROG}*{d}', f'0.5 + {vy}*{PROG}*{d}'),
                       b_center=(f'0.5 + {hx}*(1 - {PROG})*{d}', f'0.5 - {vy}*(1 - {PROG})*{d}'))
    comp = dissolve(b, 'Cut', ta, tb, cut(0.06))
    streak = dblur(b, 'WhipStreak', comp, 0, f'0.3*Controls.Blur*{PEAK}', angle=f'90*{vy}')
    out = blades(b, streak, f'min(1, max(0, ({PEAK} - 0.55)*4))')
    finish(b, out)


def build():
    motion()
    light()
    glitchy()
    blurry()
    shutters()
