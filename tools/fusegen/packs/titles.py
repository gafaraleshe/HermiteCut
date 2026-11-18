"""HermiteCut titles.

Every title has the same Inspector groups: Text, Colour, Title Styling,
Film Look and Animation. Text fields are Text+ tools; one colour picker drives
every line, so a style change is one click. The in and out animation runs from
the title's two ends (Animation -> In / Out frames), so trimming the title in
the timeline keeps the animation intact.
"""
from .common import (Build, Inp, slider, combo, checkbox, TRANSITION_CURVES, transition_curve, clamp01,
                     jitter, conn, xf, merge, bc, blur, glow, solid, rect, EDGES_CANVAS)

ANIMS = ['Fade', 'Rise', 'Blur', 'Scale', 'Track', 'Slide']
FONT_SANS = ('Arial', 'Bold')
FONT_SANS_REG = ('Arial', 'Regular')
FONT_SERIF = ('Georgia', 'Regular')
FONT_SERIF_IT = ('Georgia', 'Italic')
FONT_MONO = ('Courier New', 'Bold')
FONT_IMPACT = ('Impact', 'Regular')


class Title:
    def __init__(self, name, blurb, family='Credits', anim=1, in_frames=18, out_frames=12, curve=4,
                 text_rgb=(1, 1, 1), accent_rgb=(0.725, 0.675, 1.0), grain=0.0, flicker=0.0, jitter_=0.0,
                 glow_=None, shadow=0.35, tracking=1.0):
        self.b = b = Build('Titles', name, family, blurb)
        self.lines = []       # (tool, field label)
        self.fonts = []       # (tool, label)
        self.extras = []      # (key, ui) look controls added by the style
        self.anim, self.in_frames, self.out_frames, self.curve = anim, in_frames, out_frames, curve
        self.text_rgb, self.accent_rgb = text_rgb, accent_rgb
        self.grain, self.flicker, self.jitter, self.glow, self.shadow = grain, flicker, jitter_, glow_, shadow
        self.tracking = tracking
        self.colour_tools = {}
        # colour holders first so the text tools can read them
        for key, rgb in (('TextColour', text_rgb), ('AccentColour', accent_rgb)):
            b.add(key, 'Background', {'UseFrameFormatSettings': Inp(1), 'Width': Inp(1920), 'Height': Inp(1080),
                                      'TopLeftRed': Inp(rgb[0]), 'TopLeftGreen': Inp(rgb[1]),
                                      'TopLeftBlue': Inp(rgb[2]), 'TopLeftAlpha': Inp(1)})

    def text(self, key, field, default, font, size, center, colour='TextColour', left=False, tracking=0.0,
             expose_font=None):
        """One Text+ line. `tracking` is added to the shared Tracking control."""
        b = self.b
        track_anim = '0.8*(1 - Controls.Vis)*iif(Controls.InStyle == 4, 1, 0)'
        inp = {
            'Width': Inp(1920), 'Height': Inp(1080), 'UseFrameFormatSettings': Inp(1),
            'StyledText': Inp(default), 'Font': Inp(font[0]), 'Style': Inp(font[1]), 'Size': Inp(size),
            'Center': Inp([center[0], center[1]]),
            'CharacterSpacing': Inp(expr=f'Controls.Tracking + {tracking} + {track_anim}'),
            'Red1': Inp(expr=f'{colour}.TopLeftRed'), 'Green1': Inp(expr=f'{colour}.TopLeftGreen'),
            'Blue1': Inp(expr=f'{colour}.TopLeftBlue'),
        }
        if left:
            inp['HorizontalLeftCenterRight'] = Inp(-1)
        b.add(key, 'TextPlus', inp)
        self.lines.append((key, field))
        if expose_font:
            self.fonts.append((key, expose_font))
        return key

    def layers(self, *tools):
        cur = tools[0]
        for i, t in enumerate(tools[1:]):
            cur = merge(self.b, f'Stack{i + 1}', cur, t)
        return cur

    def build(self, art, look_extra=None):
        """`art`: the merged text (and any panels). Adds the shared look and
        animation chain and lays out the Inspector."""
        b = self.b
        # --- timing (hidden)
        pin = clamp01('(time - comp.RenderStart) / max(1, Controls.InFrames)')
        pout = clamp01('(comp.RenderEnd - time) / max(1, Controls.OutFrames)')
        b.hidden('Raw', f'min({pin}, {pout})')
        b.hidden('Vis', transition_curve('Controls.Raw', 'Controls.Curve'))
        inv = '(1 - Controls.Vis)'
        on = lambda i: f'iif(Controls.InStyle == {i}, 1, 0)'  # noqa: E731

        # --- look chain
        cur = art
        if self.shadow is not None:
            sh_soft = blur(b, 'ShadowSoft', cur, 6)
            sh_dark = bc(b, 'ShadowDark', sh_soft, Gain=0)
            sh_move = xf(b, 'ShadowMove', sh_dark, center=('0.5 + 0.002', '0.5 - 0.003'), edges=EDGES_CANVAS)
            clear0 = solid(b, 'ShadowBase', (0, 0, 0), 0)
            sh = merge(b, 'ShadowFade', clear0, sh_move, blend='Controls.Shadow')
            cur = merge(b, 'ShadowUnder', sh, cur)
        if self.glow is not None:
            cur = glow(b, 'Neon', cur, blend='min(1, Controls.GlowAmt)', gain_='1 + 2*Controls.GlowAmt',
                       threshold=0.05, size='Controls.GlowSize')
        if look_extra:
            cur = look_extra(cur)
        grain = b.add('Grain', 'FilmGrain', {'Input': conn(cur), 'Blend': Inp(expr='Controls.GrainAmt')})
        weave = xf(b, 'Weave', grain, center=(f'0.5 + 0.0015*Controls.Jitter*{jitter(0)}',
                                              f'0.5 + 0.0015*Controls.Jitter*{jitter(1)}'), edges=EDGES_CANVAS)
        place = xf(b, 'Place', weave, center=(0.5, 0.5), size=1, edges=EDGES_CANVAS)
        anim = xf(b, 'Animate', place,
                  center=(f'0.5 - 0.08*{inv}*{on(5)}', f'0.5 - 0.05*{inv}*{on(1)}'),
                  size=f'max(0, 1 - 0.18*{inv}*{on(3)})', edges=EDGES_CANVAS,
                  mblur='iif(Controls.InStyle == 5, 180, 0)')
        soft = blur(b, 'Reveal', anim, f'Controls.Softness + 30*max(0, {inv})*{on(2)}')
        clear = solid(b, 'Clear', (0, 0, 0), 0)
        flick = f'(1 - Controls.Flicker*0.5*(1 + {jitter(2)})*iif(Controls.Vis < 0.999, 1, 0.25))'
        out = merge(b, 'Opacity', clear, soft, blend=f'{clamp01("Controls.Vis")} * {flick}')

        # --- Inspector
        b.begin('Text')
        for key, field in self.lines:
            if field:
                b.expose(key + 'Text', key, 'StyledText', name=field)
        for i, (key, lab) in enumerate(self.fonts):
            b.expose(key + 'Font', key, 'Font', name=lab, ControlGroup=200 + i)
            b.expose(key + 'Style', key, 'Style', ControlGroup=200 + i, doc=False)
        b.end()
        b.begin('Colour')
        b.colour('TextColour', 'Text colour', self.text_rgb, tool='TextColour')
        b.colour('AccentColour', 'Accent colour', self.accent_rgb, tool='AccentColour')
        b.end()
        b.begin('Title Styling')
        b.expose('Size', 'Place', 'Size', name='Size', default=1)
        b.expose('Position', 'Place', 'Center', name='Position')
        b.control('Tracking', slider('Tracking', 0.5, 3, self.tracking, minA=0, maxA=10))
        b.control('Shadow', slider('Shadow', 0, 1, self.shadow or 0), expose=self.shadow is not None)
        if self.glow is not None:
            b.control('GlowAmt', slider('Glow', 0, 2, self.glow), name='Glow')
            b.control('GlowSize', slider('Glow size', 1, 60, 14))
        for key, ui in self.extras:
            b.control(key, ui)
        b.end()
        b.begin('Film Look')
        b.control('GrainAmt', slider('Grain', 0, 1, self.grain), name='Grain')
        b.control('Flicker', slider('Flicker', 0, 1, self.flicker))
        b.control('Jitter', slider('Jitter', 0, 4, self.jitter))
        b.control('Softness', slider('Softness', 0, 10, 0))
        b.end()
        b.begin('Animation')
        b.control('InStyle', combo('Style', ANIMS, self.anim), name='Style')
        b.control('InFrames', slider('In (frames)', 0, 60, self.in_frames, integer=True, minA=0, maxA=600),
                  name='In (frames)')
        b.control('OutFrames', slider('Out (frames)', 0, 60, self.out_frames, integer=True, minA=0, maxA=600),
                  name='Out (frames)')
        b.control('Curve', combo('Curve', TRANSITION_CURVES, self.curve))
        b.control('Seed', slider('Seed', 0, 100, 0, integer=True, minA=0, maxA=100000))
        b.end()
        b.finish(out)
        return b


def credits():
    # Clean: a bottom-left block, sans serif, rising in.
    t = Title('Credit Clean', 'A tidy bottom-left music-video credit.', anim=1)
    a = t.text('Artist', 'Artist', 'ARTIST NAME', FONT_SANS, 0.062, (0.075, 0.27), left=True, tracking=0.05,
               expose_font='Font')
    s = t.text('Song', 'Song', '"SONG TITLE"', FONT_SANS_REG, 0.036, (0.075, 0.205), left=True,
               expose_font='Detail font')
    d = t.text('Directed', 'Directed By', 'DIRECTED BY YOUR NAME', FONT_SANS_REG, 0.02, (0.075, 0.152),
               colour='AccentColour', left=True, tracking=0.6)
    c = t.text('Credit', 'Credit', 'PRODUCED BY NAME', FONT_SANS_REG, 0.02, (0.075, 0.124),
               colour='AccentColour', left=True, tracking=0.6)
    t.build(t.layers(a, s, d, c))

    # Blur: centred, blur-and-track reveal.
    t = Title('Credit Blur', 'A centred credit that resolves out of a blur.', anim=2, in_frames=24,
              out_frames=16, curve=1, tracking=1.1)
    a = t.text('Artist', 'Artist', 'ARTIST NAME', FONT_SANS, 0.075, (0.5, 0.56), tracking=0.15,
               expose_font='Font')
    s = t.text('Song', 'Song', 'Song Title', FONT_SERIF_IT, 0.045, (0.5, 0.47), expose_font='Detail font')
    d = t.text('Directed', 'Directed By', 'DIRECTED BY YOUR NAME', FONT_SANS_REG, 0.018, (0.5, 0.385),
               tracking=0.8)
    c = t.text('Credit', 'Credit', 'PRODUCED BY NAME', FONT_SANS_REG, 0.018, (0.5, 0.355), tracking=0.8)
    t.build(t.layers(a, s, d, c))

    # Distressed: typewriter type, grain, flicker and gate jitter.
    t = Title('Credit Distressed', 'Worn typewriter credit with grain, flicker and jitter.', anim=0,
              in_frames=10, out_frames=10, curve=0, grain=0.85, flicker=0.35, jitter_=1.5, shadow=None,
              text_rgb=(0.94, 0.92, 0.86), accent_rgb=(0.85, 0.2, 0.15))
    a = t.text('Artist', 'Artist', 'ARTIST NAME', FONT_MONO, 0.07, (0.5, 0.56), expose_font='Font')
    s = t.text('Song', 'Song', 'SONG TITLE', FONT_MONO, 0.04, (0.5, 0.47), colour='AccentColour',
               expose_font='Detail font')
    d = t.text('Directed', 'Directed By', 'directed by your name', FONT_MONO, 0.022, (0.5, 0.39))
    c = t.text('Credit', 'Credit', 'produced by name', FONT_MONO, 0.022, (0.5, 0.355))
    t.build(t.layers(a, s, d, c), look_extra=lambda cur: blur(t.b, 'Ink', cur, 0.6))

    # Glass: a frosted panel behind a left-aligned block.
    t = Title('Credit Glass', 'Frosted glass panel with a soft glow.', anim=5, in_frames=20, out_frames=14,
              curve=4, glow_=0.25)
    t.extras.append(('PanelAmt', slider('Panel', 0, 1, 0.16)))
    pm = rect(t.b, 'PanelShape', 0.42, 0.155, soft=0.004, center=(0.255, 0.2), corner=0.12)
    panel = solid(t.b, 'Panel', ('TextColour.TopLeftRed', 'TextColour.TopLeftGreen', 'TextColour.TopLeftBlue'),
                  'Controls.PanelAmt')
    t.b.set('Panel', 'EffectMask', Inp(srcop=pm, src='Mask'))
    a = t.text('Artist', 'Artist', 'ARTIST NAME', FONT_SANS, 0.05, (0.075, 0.24), left=True, expose_font='Font')
    s = t.text('Song', 'Song', 'Song Title', FONT_SERIF_IT, 0.034, (0.075, 0.19), left=True,
               expose_font='Detail font')
    d = t.text('Directed', 'Directed By', 'DIRECTED BY YOUR NAME', FONT_SANS_REG, 0.016, (0.075, 0.15),
               colour='AccentColour', left=True, tracking=0.6)
    c = t.text('Credit', 'Credit', 'PRODUCED BY NAME', FONT_SANS_REG, 0.016, (0.075, 0.127),
               colour='AccentColour', left=True, tracking=0.6)
    t.build(t.layers(panel, a, s, d, c))

    # Neon: glowing tubes that flicker on.
    t = Title('Credit Neon', 'Neon-tube credit that flickers on.', anim=0, in_frames=14, out_frames=10, curve=0,
              glow_=0.9, flicker=0.6, shadow=None, text_rgb=(1.0, 0.35, 0.75), accent_rgb=(0.35, 0.85, 1.0))
    a = t.text('Artist', 'Artist', 'ARTIST NAME', FONT_SANS, 0.07, (0.5, 0.56), tracking=0.1, expose_font='Font')
    s = t.text('Song', 'Song', 'Song Title', FONT_SERIF_IT, 0.045, (0.5, 0.465), colour='AccentColour',
               expose_font='Detail font')
    d = t.text('Directed', 'Directed By', 'DIRECTED BY YOUR NAME', FONT_SANS_REG, 0.02, (0.5, 0.385), tracking=0.8)
    c = t.text('Credit', 'Credit', 'PRODUCED BY NAME', FONT_SANS_REG, 0.02, (0.5, 0.352), tracking=0.8)
    t.build(t.layers(a, s, d, c))

    # Bold: one huge artist name with the details tucked underneath.
    t = Title('Credit Bold', 'A huge artist name with the details underneath.', anim=3, in_frames=14,
              out_frames=10, curve=5)
    a = t.text('Artist', 'Artist', 'ARTIST', FONT_IMPACT, 0.16, (0.5, 0.55), expose_font='Font')
    s = t.text('Song', 'Song', '"SONG TITLE"', FONT_SANS, 0.04, (0.5, 0.4), colour='AccentColour',
               expose_font='Detail font')
    d = t.text('Directed', 'Directed By', 'DIRECTED BY YOUR NAME', FONT_SANS_REG, 0.018, (0.5, 0.33), tracking=0.8)
    c = t.text('Credit', 'Credit', 'PRODUCED BY NAME', FONT_SANS_REG, 0.018, (0.5, 0.3), tracking=0.8)
    t.build(t.layers(a, s, d, c))


def others():
    t = Title('Lower Third', 'Name and role with an accent bar.', family='Lower Thirds', anim=5, in_frames=16,
              out_frames=12)
    bar_m = t.b.add('BarShape', 'RectangleMask', {'Width': Inp(0.005), 'SoftEdge': Inp(0),
                                                  'Height': Inp(expr=f'0.075*{clamp01("Controls.Vis*1.4")}'),
                                                  'Center': Inp([0.062, 0.155])})
    bar = solid(t.b, 'Bar', ('AccentColour.TopLeftRed', 'AccentColour.TopLeftGreen', 'AccentColour.TopLeftBlue'))
    t.b.set('Bar', 'EffectMask', Inp(srcop=bar_m, src='Mask'))
    n = t.text('Name', 'Name', 'YOUR NAME', FONT_SANS, 0.045, (0.075, 0.17), left=True, expose_font='Font')
    r = t.text('Role', 'Role', 'Director of Photography', FONT_SANS_REG, 0.026, (0.075, 0.125), left=True,
               expose_font='Detail font')
    t.build(t.layers(bar, n, r))

    t = Title('Social Handle', 'Your @handle on a pill that pops in.', family='Social', anim=3, in_frames=12,
              out_frames=10, curve=5, text_rgb=(1, 1, 1), accent_rgb=(0.08, 0.08, 0.1))
    t.extras.append(('PanelAmt', slider('Panel', 0, 1, 0.75)))
    pm = rect(t.b, 'PillShape', 0.3, 0.062, soft=0.002, center=(0.5, 0.125), corner=1)
    pill = solid(t.b, 'Pill', ('AccentColour.TopLeftRed', 'AccentColour.TopLeftGreen', 'AccentColour.TopLeftBlue'),
                 'Controls.PanelAmt')
    t.b.set('Pill', 'EffectMask', Inp(srcop=pm, src='Mask'))
    k = t.text('Kicker', 'Label', 'FOLLOW', FONT_SANS_REG, 0.018, (0.5, 0.18), tracking=1.2)
    h = t.text('Handle', 'Handle', '@yourhandle', FONT_SANS, 0.04, (0.5, 0.115), expose_font='Font')
    t.build(t.layers(pill, k, h))

    t = Title('Subscribe Pop', 'A subscribe button that pops in and out.', family='Social', anim=3,
              in_frames=10, out_frames=8, curve=5, text_rgb=(1, 1, 1), accent_rgb=(0.9, 0.12, 0.12), shadow=0.25)
    pm = rect(t.b, 'ButtonShape', 0.24, 0.07, soft=0.002, center=(0.5, 0.15), corner=0.4)
    button = solid(t.b, 'Button', ('AccentColour.TopLeftRed', 'AccentColour.TopLeftGreen',
                                   'AccentColour.TopLeftBlue'))
    t.b.set('Button', 'EffectMask', Inp(srcop=pm, src='Mask'))
    w = t.text('Word', 'Text', 'SUBSCRIBE', FONT_SANS, 0.036, (0.5, 0.14), tracking=0.15, expose_font='Font')
    t.build(t.layers(button, w))

    t = Title('Cinematic Title', 'Wide-tracked film title with a subtitle line.', family='Cinematic', anim=4,
              in_frames=30, out_frames=20, curve=1, tracking=1.6, grain=0.25)
    m = t.text('Main', 'Title', 'THE TITLE', FONT_SERIF, 0.075, (0.5, 0.52), expose_font='Font')
    s = t.text('Sub', 'Subtitle', 'A FILM BY YOUR NAME', FONT_SANS_REG, 0.02, (0.5, 0.44), tracking=0.6,
               colour='AccentColour', expose_font='Detail font')
    t.build(t.layers(m, s))

    t = Title('Neon Location', 'Place, date and time in neon, flickering on.', family='Cinematic', anim=0,
              in_frames=14, out_frames=10, curve=0, glow_=0.8, flicker=0.6, shadow=None,
              text_rgb=(0.35, 0.95, 1.0), accent_rgb=(1.0, 0.35, 0.75))
    p = t.text('Location', 'Location', 'LOS ANGELES, CA', FONT_SANS, 0.05, (0.075, 0.2), left=True, tracking=0.1,
               expose_font='Font')
    d = t.text('When', 'Date / time', '18.11.2026 · 23:41', FONT_MONO, 0.024, (0.075, 0.145), left=True,
               colour='AccentColour', expose_font='Detail font')
    t.build(t.layers(p, d))

    t = Title('Caption', 'A bold one-line caption that pops on. Used by Captions+.', family='Captions', anim=3,
              in_frames=4, out_frames=3, curve=5, shadow=0.6)
    w = t.text('Line', 'Caption', 'YOUR CAPTION HERE', FONT_SANS, 0.05, (0.5, 0.2), expose_font='Font')
    t.build(w)


def build():
    credits()
    others()
