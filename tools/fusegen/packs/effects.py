"""HermiteCut effects: flashes, shakes, blurs, motion, glitch, film and light.

Every effect shares *Apply at* (Post / Pre / Both / Whole), *Frames*, *Curve*,
*Strength* and *Seed* (see common.py). The Motion family also carries the seven
Hermite Motion presets (Slide In x4, Pop In, Ken Burns, Fade Move), rebuilt on
the shared timing so they work on trimmed clips: Slide has a Side control
instead of four separate macros.
"""
from .common import (Build, Inp, FuID, slider, checkbox, combo, multibutton,
                     EFFECT_CURVES, effect_raw, effect_curve, CLIP_PROGRESS, AMT, ENV, PI,
                     wobble, jitter, chance, src, conn, xf, merge, bc, gain, blur, dblur,
                     glow, solid, noise, ellipse, rect, rgb_split, RECT_HEIGHT_IN_FRAME_HEIGHTS,
                     EDGES_CANVAS, EDGES_WRAP, EDGES_MIRROR, clamp01)


def effect(name, family, blurb, mode=0, frames=8, curve=2, strength=1.0, strength_max=2.0,
           styles=None, tags=None):
    b = Build('Effects', name, family, blurb, styles=styles, tags=tags)
    src(b)
    b.begin('Timing')
    b.control('Mode', multibutton('Apply at', ['Post', 'Pre', 'Both', 'Whole'], mode))
    b.control('Frames', slider('Frames', 1, 48, frames, integer=True, minA=1, maxA=600))
    b.control('Curve', combo('Curve', EFFECT_CURVES, curve))
    b.end()
    b.hidden('Raw', effect_raw())
    b.hidden('Env', effect_curve())
    b.begin('Look')
    b.control('Strength', slider('Strength', 0, strength_max, strength, minA=0, maxA=10))
    return b


def done(b, out, seed=True):
    if seed:
        b.control('Seed', slider('Seed', 0, 100, 0, integer=True, minA=0, maxA=100000))
    else:
        b.control('Seed', slider('Seed', 0, 100, 0, integer=True), expose=False)
    b.end()
    b.finish(out)


# =============================================================== Flashes
def flash_family():
    F = 'Flashes'

    b = effect('Flash', F, 'A clean white flash that burns out of the cut.', frames=8)
    over = bc(b, 'Expose', 'SrcA', Gain=f'1 + 2.5*{AMT}', Saturation=f'1 - 0.4*min(1, {AMT})')
    white = b.colour('FlashColour', 'Colour', (1, 1, 1))
    out = merge(b, 'Wash', over, 'FlashColour', blend=f'min(1, 0.75*{AMT})')
    done(b, out, seed=False)

    b = effect('Glow Flash', F, 'Blooming highlights that flare and settle.', frames=10)
    g = glow(b, 'Bloom', 'SrcA', blend=f'min(1, {AMT})', gain_='1 + 3*Controls.Strength',
             threshold='Controls.Threshold', size='Controls.Size')
    b.control('Threshold', slider('Threshold', 0, 1, 0.45))
    b.control('Size', slider('Glow size', 1, 60, 18))
    out = bc(b, 'Expose', g, Gain=f'1 + 0.9*{AMT}')
    done(b, out, seed=False)

    b = effect('Frame Flash', F, 'A single hard white frame on the cut.', frames=1, curve=0, strength=1.0)
    b.colour('FlashColour', 'Colour', (1, 1, 1))
    out = merge(b, 'Wash', 'SrcA', 'FlashColour', blend=f'min(1, {AMT})')
    done(b, out, seed=False)

    b = effect('Colour Flash', F, 'A tinted screen flash in any colour.', frames=10)
    b.colour('FlashColour', 'Colour', (1, 0.25, 0.55))
    sc = merge(b, 'Tint', 'SrcA', 'FlashColour', mode='Screen', blend=f'min(1, 0.85*{AMT})')
    out = bc(b, 'Expose', sc, Gain=f'1 + 0.8*{AMT}')
    done(b, out, seed=False)

    b = effect('Exposure Pop', F, 'An exposure and contrast punch with a small scale pop.', frames=8)
    e = bc(b, 'Expose', 'SrcA', Gain=f'1 + 1.2*{AMT}', Contrast=f'0.25*{AMT}',
           Saturation=f'1 + 0.35*{AMT}')
    out = xf(b, 'Pop', e, size=f'1 + 0.05*{AMT}', edges=EDGES_MIRROR)
    done(b, out, seed=False)

    b = effect('Strobe', F, 'Flickering white frames, on and off at a set rate.', frames=16, curve=0)
    b.control('Rate', slider('Rate (frames)', 1, 8, 2, integer=True, minA=1, maxA=60))
    b.colour('FlashColour', 'Colour', (1, 1, 1))
    k = 'floor((time - comp.RenderStart) / max(1, Controls.Rate))'
    on = f'iif({k} - 2*floor({k}/2) < 0.5, 1, 0)'
    out = merge(b, 'Wash', 'SrcA', 'FlashColour', blend=f'min(1, {AMT} * {on})')
    done(b, out, seed=False)


# =============================================================== Shakes
def shake_family():
    F = 'Shakes'

    def shaker(name, blurb, dx, dy, ang, size, frames=12, curve=2, speed=1.0, mode=0, strength=1.0):
        b = effect(name, F, blurb, mode=mode, frames=frames, curve=curve, strength=strength)
        b.control('Speed', slider('Speed', 0.1, 4, speed, minA=0, maxA=20))
        t = xf(b, 'Shake', 'SrcA', center=(f'0.5 + {AMT}*{dx}', f'0.5 + {AMT}*{dy}'),
               angle=f'{AMT}*{ang}', size=f'1 + abs({AMT})*{size}', edges=EDGES_MIRROR, mblur=True)
        b.expose('MotionBlur', 'Shake', 'MotionBlur', name='Motion blur', default=1)
        done(b, t)

    shaker('Twitch', 'Sharp random jolts, a few frames at a time.',
           f'0.025*{jitter(0)}', f'0.025*{jitter(1)}', f'2.5*{jitter(2)}', 0.06, frames=6)
    shaker('XY Shake', 'Smooth camera shake on both axes.',
           f'0.035*{wobble(0, base=2.1)}', f'0.035*{wobble(1, base=2.1)}', f'1.2*{wobble(2, base=1.4)}', 0.07)
    shaker('Vertical Shake', 'A bass-hit bounce, up and down only.',
           '0', f'0.05*{wobble(3, base=3.4)}', '0', 0.08, frames=10)
    shaker('Zoom Shake', 'Pulsing zoom with a little drift.',
           f'0.012*{wobble(4, base=2.0)}', f'0.012*{wobble(5, base=2.0)}', '0', 0.0, frames=12)
    shaker('Earthquake', 'Violent, per-frame shake with rotation.',
           f'0.06*{jitter(6)}', f'0.06*{jitter(7)}', f'4*{jitter(8)}', 0.14, frames=20, curve=1)
    shaker('Handheld', 'Slow, organic drift, like a camera on the shoulder.',
           f'0.012*{wobble(9, base=0.35)}', f'0.012*{wobble(10, base=0.35)}', f'0.6*{wobble(11, base=0.25)}',
           0.03, mode=3, curve=0, strength=1.0)


def fix_zoom_shake(templates):
    """Give Zoom Shake its size pulse (the generic shaker only scales with |amount|)."""
    for b in templates:
        if b.name == 'Zoom Shake':
            b.set('Shake', 'Size', Inp(expr=f'1 + {AMT}*(0.09 + 0.07*{wobble(6, base=2.6)})'))


# =============================================================== Blurs
def blur_family():
    F = 'Blurs'

    b = effect('Defocus', F, 'A soft lens defocus that pulls back into focus.', frames=12, curve=1)
    b.control('Size', slider('Blur size', 1, 80, 30))
    d = b.add('Lens', 'Defocus', {'Input': conn('SrcA'),
                                  'XDefocusSize': Inp(expr=f'Controls.Size * {AMT}'),
                                  'BloomLevel': Inp(expr=f'0.3 * min(1, {AMT})'),
                                  'BloomThreshold': Inp(0.8)})
    done(b, d, seed=False)

    b = effect('Zoom Blur', F, 'A radial zoom streak from the centre.', frames=10)
    b.control('Length', slider('Length', 0, 1, 0.35))
    z = dblur(b, 'Streak', 'SrcA', 3, f'Controls.Length * {AMT}')
    b.expose('Center', 'Streak', 'Center', name='Centre')
    out = xf(b, 'Push', z, size=f'1 + 0.08*{AMT}', edges=EDGES_MIRROR)
    done(b, out, seed=False)

    b = effect('Whip Blur', F, 'A directional whip with motion streaks.', frames=8, curve=2)
    b.control('Direction', combo('Direction', ['Left', 'Right', 'Up', 'Down'], 0))
    b.control('Length', slider('Length', 0, 1, 0.4))
    dx = 'iif(Controls.Direction == 0, -1, iif(Controls.Direction == 1, 1, 0))'
    dy = 'iif(Controls.Direction == 2, 1, iif(Controls.Direction == 3, -1, 0))'
    t = xf(b, 'Whip', 'SrcA', center=(f'0.5 - {dx}*0.25*{AMT}', f'0.5 - {dy}*0.25*{AMT}'),
           edges=EDGES_MIRROR, mblur=True)
    out = dblur(b, 'Streak', t, 0, f'Controls.Length * {AMT}', angle='iif(Controls.Direction < 2, 0, 90)')
    done(b, out, seed=False)

    b = effect('Glow Blur', F, 'A dreamy blurred glow over the picture.', frames=14, curve=1)
    b.control('Size', slider('Blur size', 1, 80, 25))
    soft = blur(b, 'Soft', 'SrcA', f'Controls.Size * min(1, {AMT})')
    out = merge(b, 'Dream', 'SrcA', soft, mode='Screen', blend=f'min(1, 0.8*{AMT})')
    done(b, out, seed=False)


# =============================================================== Motion
def motion_family():
    F = 'Motion'
    side_dx = 'iif(Controls.Side == 0, -1, iif(Controls.Side == 1, 1, 0))'
    side_dy = 'iif(Controls.Side == 2, 1, iif(Controls.Side == 3, -1, 0))'

    b = effect('Zoom Punch', F, 'Punch in on the cut and settle.', frames=10)
    b.control('Zoom', slider('Zoom', 0, 1, 0.3))
    out = xf(b, 'Punch', 'SrcA', size=f'1 + Controls.Zoom*{AMT}', edges=EDGES_MIRROR, mblur=True)
    b.expose('Center', 'Punch', 'Center', name='Centre')
    done(b, out, seed=False)

    b = effect('Zoom Out', F, 'Start pulled back with mirrored edges, then fill the frame.', frames=12, curve=1)
    b.control('Zoom', slider('Zoom', 0, 1, 0.35))
    out = xf(b, 'Pull', 'SrcA', size=f'1 / (1 + Controls.Zoom*abs({AMT}))', edges=EDGES_MIRROR, mblur=True)
    done(b, out, seed=False)

    b = effect('Slide', F, 'Slide in from a side (Post) or out to it (Pre). Hermite Motion\'s Slide In.',
               frames=18, styles=['Left', 'Right', 'Top', 'Bottom'], tags=['hermite-motion'])
    b.control('Side', combo('Side', ['Left', 'Right', 'Top', 'Bottom'], 0))
    b.control('Distance', slider('Distance', 0, 1.5, 1.0))
    out = xf(b, 'Move', 'SrcA', center=(f'0.5 + {side_dx}*Controls.Distance*{AMT}',
                                        f'0.5 + {side_dy}*Controls.Distance*{AMT}'),
             edges=EDGES_CANVAS, mblur=True)
    b.expose('MotionBlur', 'Move', 'MotionBlur', name='Motion blur', default=1)
    done(b, out, seed=False)

    b = effect('Spin', F, 'A full spin into (or out of) the shot.', frames=14, curve=2)
    b.control('Turns', slider('Turns', -3, 3, 1))
    out = xf(b, 'Turn', 'SrcA', angle=f'360*Controls.Turns*{AMT}', size=f'1 + 0.25*abs({AMT})',
             edges=EDGES_MIRROR, mblur=True)
    done(b, out, seed=False)

    b = effect('Pop', F, 'Scale up from nothing with an overshoot. Hermite Motion\'s Pop In.',
               frames=15, curve=5, tags=['hermite-motion'])
    out = xf(b, 'Scale', 'SrcA', size=f'max(0, 1 - {AMT})', edges=EDGES_CANVAS, mblur=True)
    b.expose('Center', 'Scale', 'Center', name='Centre')
    done(b, out, seed=False)

    b = effect('Bounce', F, 'Drop in from above and bounce to rest.', frames=24, curve=0)
    b.control('Height', slider('Height', 0, 1, 0.5))
    p = '(1 - Controls.Raw)'
    bounce = f'abs(cos({p}*{PI}*3.5)) * (1 - {p})^2'
    out = xf(b, 'Drop', 'SrcA', center=('0.5', f'0.5 + Controls.Height*Controls.Strength*{bounce}'),
             edges=EDGES_CANVAS, mblur=True)
    done(b, out, seed=False)

    # Smooth Zoom and Ken Burns: Whole runs across the clip; Post / Pre settle in the window.
    prog = f'iif(Controls.Mode == 3, {CLIP_PROGRESS}, {ENV})'
    b = effect('Smooth Zoom', F, 'A slow, eased push across the whole clip.', mode=3, frames=24, curve=1)
    b.control('Zoom', slider('Zoom', 0, 0.5, 0.12))
    eased = f'(({prog})*({prog})*(3 - 2*({prog})))'
    out = xf(b, 'Push', 'SrcA', size=f'1 + Controls.Zoom*Controls.Strength*{eased}', edges=EDGES_MIRROR)
    b.expose('Center', 'Push', 'Center', name='Centre')
    done(b, out, seed=False)

    b = effect('Ken Burns', F, 'A slow pan and zoom across the clip. Hermite Motion\'s Ken Burns.',
               mode=3, frames=48, curve=0, tags=['hermite-motion'])
    b.control('Zoom', slider('Zoom', 0, 0.5, 0.12))
    b.control('Side', combo('Pan towards', ['Left', 'Right', 'Top', 'Bottom'], 1))
    b.control('Pan', slider('Pan', 0, 0.2, 0.04))
    out = xf(b, 'Drift', 'SrcA',
             center=(f'0.5 + {side_dx}*Controls.Pan*Controls.Strength*{prog}',
                     f'0.5 + {side_dy}*Controls.Pan*Controls.Strength*{prog}'),
             size=f'1 + Controls.Zoom*Controls.Strength*{prog}', edges=EDGES_MIRROR)
    done(b, out, seed=False)

    b = effect('Fade Move', F, 'Fade in while rising into place. Hermite Motion\'s Fade Move.',
               frames=16, curve=2, tags=['hermite-motion'])
    b.control('Rise', slider('Rise', 0, 0.3, 0.06))
    t = xf(b, 'Rise', 'SrcA', center=('0.5', f'0.5 - Controls.Rise*{AMT}'), edges=EDGES_CANVAS)
    clear = solid(b, 'Clear', (0, 0, 0), 0)
    out = merge(b, 'Fade', clear, t, blend=f'1 - min(1, {AMT})')
    b.exempt.append('Fade.Blend')   # 1 = untouched here, by design
    done(b, out, seed=False)


# =============================================================== Glitch
def glitch_family():
    F = 'Glitch'

    b = effect('RGB Split', F, 'Red and blue pull apart from green.', frames=10)
    b.control('Offset', slider('Offset', 0, 0.1, 0.02))
    b.control('Angle', slider('Angle', -180, 180, 0))
    dx = f'Controls.Offset*{AMT}*cos(Controls.Angle*{PI}/180)'
    dy = f'Controls.Offset*{AMT}*sin(Controls.Angle*{PI}/180)'
    out = rgb_split(b, 'Split', 'SrcA', dx, dy)
    done(b, out, seed=False)

    b = effect('Digital Glitch', F, 'Torn horizontal slices and colour shifts.', frames=12, curve=0)
    b.control('Slices', slider('Slice shift', 0, 0.3, 0.08))
    b.control('Hold', slider('Hold (frames)', 1, 6, 2, integer=True, minA=1, maxA=30))
    cur = 'SrcA'
    for i in range(6):
        on = chance(20 + i, 0.35, 'Controls.Hold')
        shift = xf(b, f'Slice{i}', 'SrcA',
                   center=(f'0.5 + Controls.Slices*{AMT}*{on}*{jitter(30 + i, "Controls.Hold")}', '0.5'),
                   edges=EDGES_WRAP)
        m = rect(b, f'Band{i}', 3, f'0.02 + 0.09*abs({jitter(40 + i, "Controls.Hold")})',
                 center=('0.5', f'0.5 + 0.48*{jitter(50 + i, "Controls.Hold")}'))
        cur = merge(b, f'Tear{i}', cur, shift, mask=m)
    split = 'Controls.Slices*0.3*' + AMT + '*' + chance(60, 0.5, 'Controls.Hold')
    out = rgb_split(b, 'Split', cur, split, '0')
    done(b, out)

    b = effect('VHS', F, 'Tape wobble, colour bleed, grain and a tracking band.', mode=3, curve=0, strength=1.0)
    soft = blur(b, 'Bleed', 'SrcA', f'2.5*{AMT}', LockXY=0, YBlurSize=0)
    wob = xf(b, 'Wobble', soft, center=(f'0.5 + 0.0025*{AMT}*{jitter(70)}', '0.5'), edges=EDGES_MIRROR)
    col = bc(b, 'Tape', wob, Saturation=f'1 - 0.25*{AMT}', Contrast=f'-0.08*{AMT}', Gain=f'1 + 0.05*{AMT}')
    sp = rgb_split(b, 'Chroma', col, f'0.004*{AMT}', '0')
    grain = b.add('Grain', 'FilmGrain', {'Input': conn(sp), 'Blend': Inp(expr=f'min(1, 0.8*{AMT})')})
    band_y = f'1.1 - ((time*0.013 + Controls.Seed*0.37) - floor(time*0.013 + Controls.Seed*0.37))*1.2'
    m = rect(b, 'Tracking', 3, 0.03, soft=0.02, center=('0.5', band_y))
    tear = xf(b, 'TrackShift', grain, center=(f'0.5 + 0.01*{AMT}*{jitter(71)}', '0.5'), edges=EDGES_MIRROR)
    lit = bc(b, 'TrackLift', tear, Gain=1.25)
    out = merge(b, 'TrackBand', grain, lit, mask=m, blend=f'min(1, {AMT})')
    done(b, out)

    b = effect('Invert', F, 'A negative hit; can flicker frame to frame.', frames=4, curve=0)
    b.control('Flicker', checkbox('Flicker', 0))
    white = solid(b, 'White', (1, 1, 1))
    fl = 'iif(Controls.Flicker > 0.5, iif(floor(time) - 2*floor(time/2) < 0.5, 1, 0), 1)'
    out = merge(b, 'Negative', 'SrcA', white, mode='Difference', blend=f'min(1, {AMT}) * {fl}')
    done(b, out, seed=False)

    b = effect('Pixelate', F, 'Mosaic blocks that resolve back into the picture.', frames=10, curve=2)
    b.control('Blocks', slider('Block size', 2, 80, 32))
    k = f'(1 + (Controls.Blocks - 1)*min(1, {AMT}))'
    small = xf(b, 'Shrink', 'SrcA', size=f'1 / {k}', FlattenTransform=1)
    out = xf(b, 'Grow', small, size=k, FilterMethod=0, FlattenTransform=1)
    done(b, out, seed=False)


# =============================================================== Film and light
def film_family():
    F = 'Film & Light'

    b = effect('Film Burn', F, 'A hot orange burn that flares across the frame.', frames=16, curve=1)
    b.control('Speed', slider('Speed', 0.1, 4, 1))
    n = noise(b, 'Burn', detail=3.0, contrast='2.6', brightness='-0.35', scale=1.2,
              seethe_rate='0.12*Controls.Speed',
              center=(f'0.5 + 0.35*{wobble(0, base=0.05)}', f'0.5 + 0.2*{wobble(1, base=0.04)}'))
    r, g, bl = b.colour('BurnColour', 'Colour', (1.0, 0.42, 0.08))
    tint = gain(b, 'Tint', n, f'2*{r}', f'2*{g}', f'2*{bl}', 1)
    soft = blur(b, 'Heat', tint, 6)
    hot = bc(b, 'Expose', 'SrcA', Gain=f'1 + 0.6*{AMT}')
    out = merge(b, 'Flare', hot, soft, mode='Screen', blend=f'min(1, {AMT})')
    done(b, out)

    b = effect('Slow Film Burn', F, 'A slow, drifting film burn that breathes across the whole clip.',
               mode=3, frames=48, curve=1, strength=0.9)
    b.control('Speed', slider('Speed', 0.05, 2, 0.3))
    b.control('Drift', slider('Drift', 0, 1, 0.5))
    n = noise(b, 'Burn', detail=2.2, contrast='2.2', brightness='-0.42 + 0.12*sin(time*0.02*Controls.Speed)',
              scale=0.55, seethe_rate='0.035*Controls.Speed',
              center=(f'0.5 + 0.45*Controls.Drift*{wobble(7, speed="Controls.Speed", base=0.012)}',
                      f'0.5 + 0.3*Controls.Drift*{wobble(8, speed="Controls.Speed", base=0.009)}'))
    r, g, bl = b.colour('BurnColour', 'Colour', (1.0, 0.36, 0.06))
    tint = gain(b, 'Tint', n, f'2.2*{r}', f'2.2*{g}', f'2.2*{bl}', 1)
    soft = blur(b, 'Heat', tint, 14)
    hot = bc(b, 'Expose', 'SrcA', Gain=f'1 + 0.25*{AMT}')
    out = merge(b, 'Flare', hot, soft, mode='Screen', blend=f'min(1, {AMT})')
    done(b, out)

    b = effect('Light Leak', F, 'A soft drifting leak of warm light.', mode=3, frames=24, curve=1, strength=0.8)
    b.control('Speed', slider('Speed', 0.1, 4, 1))
    n = noise(b, 'Leak', detail=0.5, contrast='1.4', brightness='-0.1', scale=0.35,
              seethe_rate='0.05*Controls.Speed',
              center=(f'0.5 + 0.4*{wobble(2, base=0.03)}', f'0.5 + 0.25*{wobble(3, base=0.025)}'))
    r, g, bl = b.colour('LeakColour', 'Colour', (1.0, 0.45, 0.35))
    tint = gain(b, 'Tint', n, f'1.6*{r}', f'1.6*{g}', f'1.6*{bl}', 1)
    soft = blur(b, 'Diffuse', tint, 40)
    out = merge(b, 'Wash', 'SrcA', soft, mode='Screen', blend=f'min(1, {AMT})')
    done(b, out)

    b = effect('Film Look', F, 'Contrast, warmth, grain and a vignette in one.', mode=3, curve=0, strength=1.0)
    b.control('Warmth', slider('Warmth', -1, 1, 0.4))
    b.control('GrainAmt', slider('Grain', 0, 1, 0.5), name='Grain')
    b.control('Vignette', slider('Vignette', 0, 1, 0.5))
    look = bc(b, 'Grade', 'SrcA', Contrast=f'0.18*{AMT}', Saturation=f'1 - 0.18*{AMT}')
    warm = gain(b, 'Warm', look, f'1 + 0.07*Controls.Warmth*{AMT}', 1,
                f'1 - 0.07*Controls.Warmth*{AMT}', 1)
    grain = b.add('Grain', 'FilmGrain', {'Input': conn(warm),
                                         'Blend': Inp(expr=f'min(1, Controls.GrainAmt*{AMT})')})
    m = ellipse(b, 'Edge', 1.1, 0.64, 0.35, invert=True)   # sizes in frame widths
    out = bc(b, 'Darken', grain, mask=m, Gain=f'1 - 0.55*Controls.Vignette*min(1, {AMT})')
    done(b, out)

    b = effect('Gate Weave', F, 'The gentle frame drift of a film projector.', mode=3, curve=0, strength=1.0)
    t = xf(b, 'Weave', 'SrcA', center=(f'0.5 + {AMT}*0.0025*{wobble(4, speed="1", base=0.9)}',
                                       f'0.5 + {AMT}*0.004*{wobble(5, speed="1", base=1.3)}'),
           angle=f'{AMT}*0.12*{wobble(6, speed="1", base=0.7)}', size=f'1 + 0.012*{AMT}', edges=EDGES_MIRROR)
    out = bc(b, 'Flicker', t, Gain=f'1 + {AMT}*0.025*{jitter(7)}')
    done(b, out)

    b = effect('Vignette Pulse', F, 'The edges darken in a pulse on the beat.', frames=12, curve=2)
    b.control('Size', slider('Size', 0.4, 1.6, 1.0))
    m = b.add('Edge', 'EllipseMask', {'Width': Inp(expr='1.05*Controls.Size'),
                                      'Height': Inp(expr='0.6*Controls.Size'),
                                      'SoftEdge': Inp(0.3), 'Invert': Inp(1)})
    out = bc(b, 'Darken', 'SrcA', mask=m, Gain=f'1 - 0.8*min(1, {AMT})')
    done(b, out, seed=False)

    b = effect('Letterbox', F, 'Cinema bars at 2.39, 2.00, 1.85 or 2.76.', mode=3, frames=16, curve=1)
    b.control('Ratio', combo('Ratio', ['2.39:1', '2.00:1', '1.85:1', '2.76:1'], 0))
    b.control('Frame', combo('Timeline', ['16:9', '17:9 (DCI)', '4:3', '1:1', '9:16'], 0))
    ratio = 'iif(Controls.Ratio == 0, 2.39, iif(Controls.Ratio == 1, 2.0, iif(Controls.Ratio == 2, 1.85, 2.76)))'
    frame = ('iif(Controls.Frame == 0, 16/9, iif(Controls.Frame == 1, 256/135, '
             'iif(Controls.Frame == 2, 4/3, iif(Controls.Frame == 3, 1, 9/16))))')
    # The window's height as a fraction of what the mask measures heights in.
    window = f'min(1, ({frame})/{ratio})' if RECT_HEIGHT_IN_FRAME_HEIGHTS else f'1/{ratio}'
    m = b.add('Window', 'RectangleMask', {'Width': Inp(4), 'Invert': Inp(1), 'SoftEdge': Inp(0),
                                          'Height': Inp(expr=f'3 - (3 - {window})*min(1, {AMT})')})
    out = bc(b, 'Bars', 'SrcA', mask=m, Gain=f'1 - min(1, 1000*{AMT})')
    done(b, out, seed=False)


def build():
    flash_family()
    shake_family()
    blur_family()
    motion_family()
    glitch_family()
    film_family()
    from .common import TEMPLATES
    fix_zoom_shake(TEMPLATES)
