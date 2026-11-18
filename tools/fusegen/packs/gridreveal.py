"""Grid Reveal: the next shot appears cell by cell inside a grid
(docs/reference/grid-reveal.md).

Everything that has to line up is computed per pixel in Fusion Custom tools
from the same numbers (cells across, rows, frame size), so the grid lines sit
exactly on the cell borders at any resolution or aspect ratio, including 9:16:

- `Cells`: the reveal matte. Each cell gets an order value (row, column,
  diagonal, centre out, spiral, random, by brightness) and its own progress,
  then a shape (pop, scale, fade, wipe, shrink, flip) with gap, rounded
  corners and an ease.
- `Flash`: a white flash on each cell while it switches.
- `Lines`: the grid lines (width, major lines, outer border, dashes, draw-on).

Shipped as ten transitions (the looks from the spec) and two effects: Grid
Hand Track, where the subject drives the cells, and Grid Lines, an overlay.
The Custom-tool maths is checked offline by tools/fusegen/test_grid.py.
"""
from .common import (Build, Inp, FuID, slider, combo, checkbox, clamp01, src, conn, xf, merge, bc, blur,
                     glow, solid, rgb_split, time_tap, AMT, ENV, EDGES_MIRROR, TRANSITION_CURVES,
                     transition_curve, effect_raw, effect_curve, EFFECT_CURVES, multibutton)

F = 'Grid Reveal'
ORDERS = ['Row by row', 'Column by column', 'Diagonal', 'Centre out', 'Spiral', 'Random', 'By brightness']
ANIMS = ['Pop', 'Scale', 'Fade', 'Wipe', 'Shrink', 'Flip']
EASES = ['Linear', 'Smooth', 'Overshoot']
DRAW_FROM = ['Corner', 'Centre', 'Edges']

# ---------------------------------------------------------------- Custom-tool expressions
# Inputs used by every Custom tool here:
#   n1 cells across, n2 rows (0 = automatic, square cells), n3 order, n4 progress,
#   n5 spread, n6 animation, n7 gap, n8 active (0 switches the tool off)
#   p1x seed, p1y corner radius, p2x ease, p2y flash window
# Setup: s1 rows, s2 ±180 or ±pi (whatever atan2 would use; not needed now).
ROWS = 'if(n2 > 0, int(n2), max(1, int(n1*h/w + 0.5)))'
CX = 'min(int(x*n1), n1 - 1)'
CY = 'min(int(y*s1), s1 - 1)'

# Order value 0..1 for the cell (i1, i2). y = 0 is the bottom of the frame, so
# "row by row" starts at the top row.
_DX = '(i1 + 0.5 - n1/2)'
_DY = '(i2 + 0.5 - s1/2)'
_RING = f'max(abs({_DX}), abs({_DY}))'
# Diamond angle 0..4 around the centre, no trigonometry needed.
_DA = (f'if({_DY} >= 0, if({_DX} >= 0, {_DY}/({_DX} + {_DY} + 0.000001), 1 - {_DX}/(-{_DX} + {_DY} + 0.000001)), '
       f'if({_DX} < 0, 2 - {_DY}/(-{_DX} - {_DY} + 0.000001), 3 + {_DX}/({_DX} - {_DY} + 0.000001)))')
_LUM = ('(0.2126*getr1b((i1 + 0.5)/n1, (i2 + 0.5)/s1) + 0.7152*getg1b((i1 + 0.5)/n1, (i2 + 0.5)/s1) + '
        '0.0722*getb1b((i1 + 0.5)/n1, (i2 + 0.5)/s1))')
ORDER = (
    f'if(n3 < 0.5, ((s1 - 1 - i2)*n1 + i1)/max(1, n1*s1 - 1), '
    f'if(n3 < 1.5, (i1*s1 + (s1 - 1 - i2))/max(1, n1*s1 - 1), '
    f'if(n3 < 2.5, (i1 + (s1 - 1 - i2))/max(1, n1 + s1 - 2), '
    f'if(n3 < 3.5, sqrt({_DX}*{_DX} + {_DY}*{_DY})/sqrt(n1*n1/4 + s1*s1/4), '
    f'if(n3 < 4.5, ({_RING} - 0.5 + {_DA}/4)/(max(n1, s1)/2), '
    f'if(n3 < 5.5, rands(0, 1, p1x*97 + i1*131 + i2*7919 + 17), '
    f'1 - min(1, max(0, {_LUM}))))))))')
# Progress of this cell, 0..1.
CELL_P = f'min(1, max(0, (n4 - min(1, max(0, {ORDER}))*n5)/max(0.0001, 1 - n5)))'

U = '(x*n1 - i1)'
V = '(y*s1 - i2)'
EASED = 'if(p2x < 0.5, i3, if(p2x < 1.5, i3*i3*(3 - 2*i3), 1 + 2.70158*(i3 - 1)^3 + 1.70158*(i3 - 1)^2))'
# The gap and the corner radius shrink to 0 at both ends, so the first frame is
# exactly A and the last exactly B.
GAP = '(n7*min(1, 4*n4)*min(1, 4*(1 - n4)))'


def _rounded(half):
    """1 inside a rounded square of half-size `half` centred in the cell."""
    r = f'min({half}, p1y*{half}*min(1, 4*n4)*min(1, 4*(1 - n4)))'
    qx = f'max(abs({U} - 0.5) - ({half} - {r}), 0)'
    qy = f'max(abs({V} - 0.5) - ({half} - {r}), 0)'
    return (f'(({half}) > 0)*(abs({U} - 0.5) <= {half})*(abs({V} - 0.5) <= {half})*'
            f'({qx}*{qx} + {qy}*{qy} <= {r}*{r} + 0.0000001)')


CELL_MASK = (
    f'n8*if(n6 < 0.5, (i3 > 0.5)*{_rounded(f"0.5*(1 - {GAP})")}, '
    f'if(n6 < 1.5, {_rounded(f"min(0.5, max(0, {EASED})*0.5)*(1 - {GAP})")}, '
    f'if(n6 < 2.5, min(1, max(0, {EASED}))*{_rounded(f"0.5*(1 - {GAP})")}, '
    f'if(n6 < 3.5, ({U} <= {EASED})*({EASED} > 0)*{_rounded(f"0.5*(1 - {GAP})")}, '
    f'if(n6 < 4.5, 1 - (i3 < 1)*(abs({U} - 0.5) < (1 - min(1, max(0, {EASED})))*0.5 + 0.0001)*'
    f'(abs({V} - 0.5) < (1 - min(1, max(0, {EASED})))*0.5 + 0.0001), '
    f'(i3 >= 0.5)*(abs({U} - 0.5) <= max(0, 2*min(1, {EASED}) - 1)/2)*(abs({V} - 0.5) <= 0.5*(1 - {GAP})))))))')

FLASH_MASK = 'n8*(i3 > 0)*(i3 < p2y)*(1 - i3/max(0.0001, p2y))'

# Lines: n1 cells across, n2 rows, n3 width (px at 1080 high), n4 draw-on 0..1,
# n5 draw from (0 corner, 1 centre, 2 edges), n6 major every N cells (0 off),
# n7 dashes per frame (0 solid), n8 outer border on/off.
LW = '(n3*h/1080)'
_CW = '(w/n1)'
_CH = '(h/s1)'
_VERT = f'(min({U}, 1 - {U})*{_CW} < {LW}/2*if(n6 > 0, if((int(x*n1 + 0.5) % max(1, int(n6))) == 0, 2, 1), 1))'
_HORZ = f'(min({V}, 1 - {V})*{_CH} < {LW}/2*if(n6 > 0, if((int(y*s1 + 0.5) % max(1, int(n6))) == 0, 2, 1), 1))'
_EDGE_V = f'((x*w < {LW}) + ((1 - x)*w < {LW}))'
_EDGE_H = f'((y*h < {LW}) + ((1 - y)*h < {LW}))'
_GROW_V = 'if(n5 < 0.5, y <= n4, if(n5 < 1.5, abs(y - 0.5) <= n4/2, min(y, 1 - y) <= n4/2))'
_GROW_H = 'if(n5 < 0.5, x <= n4, if(n5 < 1.5, abs(x - 0.5) <= n4/2, min(x, 1 - x) <= n4/2))'
_DASH_V = 'if(n7 > 0, (y*n7 - int(y*n7)) < 0.5, 1)'
_DASH_H = 'if(n7 > 0, (x*n7 - int(x*n7)) < 0.5, 1)'
LINE_MASK = (f'min(1, {_VERT}*if(n8 > 0.5, 1, {_EDGE_V} < 1)*{_GROW_V}*{_DASH_V} + '
             f'{_HORZ}*if(n8 > 0.5, 1, {_EDGE_H} < 1)*{_GROW_H}*{_DASH_H})')

COLLAGE = 'get{c}1b({u}, {v})'


def custom(b, name, image, alpha, numbers, points=None, rgb=None, image2=None):
    """A Fusion Custom tool computing `alpha` (and RGB = alpha, or `rgb`)."""
    inp = {'Image1': conn(image)}
    if image2:
        inp['Image2'] = conn(image2)
    for i, v in enumerate(numbers, 1):
        if v is not None:
            inp[f'NumberIn{i}'] = Inp(expr=v) if isinstance(v, str) else Inp(v)
    for i, (px, py) in enumerate(points or [], 1):
        inp[f'PointIn{i}'] = Inp(expr=f'Point({px}, {py})')
    inp['Setup1'] = Inp(ROWS)
    inp['Intermediate1'] = Inp(CX)
    inp['Intermediate2'] = Inp(CY)
    inp['Intermediate3'] = Inp(CELL_P)
    if rgb:
        r, g, bl = rgb
    else:
        r = g = bl = alpha
    inp['RedExpression'] = Inp(r)
    inp['GreenExpression'] = Inp(g)
    inp['BlueExpression'] = Inp(bl)
    inp['AlphaExpression'] = Inp(alpha)
    return b.add(name, 'Custom', inp)


def lines_tool(b, name, image, draw):
    inp = {'Image1': conn(image),
           'NumberIn1': Inp(expr='Controls.Cells'), 'NumberIn2': Inp(expr='Controls.Rows'),
           'NumberIn3': Inp(expr='Controls.LineWidth'), 'NumberIn4': Inp(expr=draw),
           'NumberIn5': Inp(expr='Controls.DrawFrom'), 'NumberIn6': Inp(expr='Controls.Major'),
           'NumberIn7': Inp(expr='Controls.Dashes'), 'NumberIn8': Inp(expr='Controls.Border'),
           'Setup1': Inp(ROWS), 'Intermediate1': Inp(CX), 'Intermediate2': Inp(CY),
           'RedExpression': Inp(LINE_MASK), 'GreenExpression': Inp(LINE_MASK),
           'BlueExpression': Inp(LINE_MASK), 'AlphaExpression': Inp(LINE_MASK)}
    return b.add(name, 'Custom', inp)


# ---------------------------------------------------------------- controls
def grid_controls(b, cells=14, rows=0, order=2, spread=0.75, anim=1, ease=1, gap=0.0, corner=0.0,
                  flash=0.0, lines=1, line_width=3.0, line_opacity=0.8, line_rgb=(1, 1, 1), glow_=0.0,
                  dashes=0, major=0, border=1, draw_from=0, steps=0, seed=True):
    b.begin('Grid')
    b.control('Cells', slider('Cells across', 2, 40, cells, integer=True, minA=1, maxA=200))
    b.control('Rows', slider('Rows (0 = square cells)', 0, 40, rows, integer=True, minA=0, maxA=200))
    b.control('Order', combo('Order', ORDERS, order))
    b.control('Spread', slider('Stagger', 0, 0.98, spread, minA=0, maxA=0.99))
    b.control('Steps', slider('Steps (0 = smooth)', 0, 32, steps, integer=True, minA=0, maxA=200))
    if seed:
        b.control('Seed', slider('Seed', 0, 100, 0, integer=True, minA=0, maxA=100000))
    else:
        b.control('Seed', slider('Seed', 0, 100, 0, integer=True), expose=False)
    b.end()
    b.begin('Cells')
    b.control('Anim', combo('Animation', ANIMS, anim), name='Animation')
    b.control('Ease', combo('Ease', EASES, ease))
    b.control('Gap', slider('Gap', 0, 0.5, gap, minA=0, maxA=0.9))
    b.control('Corner', slider('Rounded corners', 0, 1, corner, minA=0, maxA=1))
    b.control('Feather', slider('Feather', 0, 10, 0, minA=0, maxA=100))
    b.control('FlashAmt', slider('White flash', 0, 1, flash, minA=0, maxA=1), name='White flash')
    b.end()
    b.begin('Lines')
    b.control('ShowLines', checkbox('Show lines', lines), name='Show lines')
    b.control('LineWidth', slider('Width (px at 1080p)', 0.5, 12, line_width, minA=0, maxA=100), name='Width')
    b.control('LineOpacity', slider('Opacity', 0, 1, line_opacity, minA=0, maxA=1), name='Opacity')
    b.colour('LineColour', 'Colour', line_rgb)
    b.control('LineGlow', slider('Glow', 0, 2, glow_, minA=0, maxA=10), name='Glow')
    b.control('Major', slider('Major line every (0 = off)', 0, 8, major, integer=True, minA=0, maxA=100),
              name='Major lines')
    b.control('Dashes', slider('Dashes (0 = solid)', 0, 60, dashes, integer=True, minA=0, maxA=1000))
    b.control('Border', checkbox('Outer border', border), name='Outer border')
    b.control('DrawFrom', combo('Draw on from', DRAW_FROM, draw_from), name='Draw on from')
    b.end()


def progress_expr(raw):
    """Optionally quantised into steps (for beat-synced grids)."""
    return f'iif(Controls.Steps > 0, floor({raw}*Controls.Steps + 0.0001)/Controls.Steps, {raw})'


def cell_inputs(prog, active='1', order='Controls.Order', anim='Controls.Anim'):
    return ['Controls.Cells', 'Controls.Rows', order, prog, 'Controls.Spread', anim, 'Controls.Gap', active]


def cell_points():
    return [('Controls.Seed', 'Controls.Corner'), ('Controls.Ease', '0.35')]


# ---------------------------------------------------------------- transitions
def grid_transition(name, blurb, image='SrcA', collage=False, glitch=False, curve=1, **kw):
    b = Build('Transitions', name, F, blurb, tags=['grid-reveal'])
    src(b, 'SrcA')
    src(b, 'SrcB')
    b.begin('Timing')
    b.control('Curve', combo('Curve', TRANSITION_CURVES, curve))
    b.end()
    b.hidden('Raw', clamp01('(time - comp.RenderStart) / max(1, comp.RenderEnd - comp.RenderStart)'))
    b.hidden('Prog', transition_curve())
    p = 'max(0, min(1, Controls.Prog))'
    b.hidden('Peak', f'4*{p}*(1 - {p})')
    grid_controls(b, **kw)
    prog = progress_expr(p)

    if collage:
        # Phase 1: cells of A become small copies of B. Phase 2: they open into B.
        tile = custom(b, 'Tiles', 'SrcB', '1', cell_inputs('0'), cell_points(),
                      rgb=tuple(COLLAGE.format(c=c, u=U, v=V) for c in 'rgb'))
        m1 = custom(b, 'CellsIn', image, CELL_MASK, cell_inputs(f'min(1, {prog}*1.7)'), cell_points())
        m2 = custom(b, 'CellsOut', image, CELL_MASK,
                    cell_inputs(f'max(0, ({prog} - 0.55)/0.45)', order='5', anim='0'), cell_points())
        step1 = merge(b, 'ToTiles', 'SrcA', tile, mask=m1)
        comp = merge(b, 'Reveal', step1, 'SrcB', mask=m2)
    else:
        m = custom(b, 'Cells', image, CELL_MASK, cell_inputs(prog), cell_points())
        if 'Feather' in b.ctrl_ui:
            m = blur(b, 'Soften', m, 'Controls.Feather')
        comp = merge(b, 'Reveal', 'SrcA', 'SrcB', mask=m)
    fm = custom(b, 'Flash', image, FLASH_MASK, cell_inputs(prog), cell_points())
    white = solid(b, 'White', (1, 1, 1))
    out = merge(b, 'FlashCells', comp, white, mask=fm, blend=f'Controls.FlashAmt*iif(Controls.Peak > 0, 1, 0)')
    if glitch:
        amt = 'Controls.Peak'
        out = rgb_split(b, 'Split', out, f'0.012*{amt}*iif(floor(time) - 2*floor(time/2) < 0.5, 1, -1)', '0')
    # lines draw on in the first third and fade out in the last third
    draw = f'min(1, 3*{p})'
    lt = lines_tool(b, 'Lines', 'SrcA', draw)
    col = solid(b, 'LineFill', ('LineColour.TopLeftRed', 'LineColour.TopLeftGreen', 'LineColour.TopLeftBlue'))
    b.set(col, 'EffectMask', Inp(srcop=lt, src='Output'))
    gl = glow(b, 'LineGlow', col, blend='min(1, Controls.LineGlow)', gain_='1 + Controls.LineGlow', threshold=0.1,
              size=10)
    out = merge(b, 'LinesOver', out, gl,
                blend=f'Controls.ShowLines*Controls.LineOpacity*min(1, 3*{p})*min(1, 3*(1 - {p}))')
    b.finish(out)
    return b


def transitions():
    grid_transition('Grid Clean Reveal', 'The next shot fills a white grid cell by cell, corner to corner.',
                    order=2, anim=1, ease=1, spread=0.75)
    grid_transition('Grid Diagonal Sweep', 'Hard cells snap over in a fast diagonal sweep.',
                    order=2, anim=0, spread=0.85, line_width=2, line_opacity=0.6, curve=0)
    grid_transition('Grid Spiral In', 'Cells spiral in from the centre with a springy scale.',
                    order=4, anim=1, ease=2, spread=0.8, line_opacity=0.5)
    grid_transition('Grid Centre Burst', 'Cells burst outwards from the centre.',
                    order=3, anim=1, ease=2, spread=0.7, lines=0)
    grid_transition('Grid Beat', 'Rows step on in beats; set Steps to match your beat.',
                    order=0, anim=0, spread=0.9, steps=8, line_width=3, curve=0)
    grid_transition('Grid Glitch', 'Random cells pop over with a colour-split hit.',
                    order=5, anim=0, spread=0.9, line_opacity=0.35, glitch=True, curve=0)
    grid_transition('Grid White Flash', 'Each cell flashes white as it switches.',
                    order=2, anim=0, spread=0.85, flash=1.0, line_opacity=0.7)
    grid_transition('Grid Neon', 'Glowing neon grid lines with soft fading cells.',
                    order=3, anim=2, spread=0.75, line_rgb=(0.725, 0.675, 1.0), glow_=1.2, line_width=2.5,
                    line_opacity=1.0, gap=0.04, corner=0.3)
    grid_transition('Grid Mosaic Out', 'The shot breaks into shrinking tiles over the next one.',
                    order=3, anim=4, ease=1, spread=0.7, gap=0.0, lines=0)
    grid_transition('Grid Light Reveal', 'The next shot\'s brightest areas arrive first.',
                    image='SrcB', order=6, anim=2, spread=0.85, lines=0)
    grid_transition('Grid Collage', 'Cells turn into mini copies of the next shot, then open into it.',
                    collage=True, order=5, anim=1, ease=2, spread=0.6, gap=0.06, corner=0.2, line_opacity=0.5)


# ---------------------------------------------------------------- effects
MATTES = ['Luma (bright subject)', 'Alpha (Magic Mask)', 'Timed wipe']
FILLS = ['Transparent (next shot below)', 'White', 'Black', 'Colour', 'Blur', 'Invert']

SUBJECT = ('if(n6 < 0.5, (0.2126*getr2b(X, Y) + 0.7152*getg2b(X, Y) + 0.0722*getb2b(X, Y)), '
           'geta2b(X, Y))')


def _sample(dx, dy):
    X = f'(i1 + 0.5 + ({dx}))/n1'
    Y = f'(i2 + 0.5 + ({dy}))/s1'
    return SUBJECT.replace('X', X).replace('Y', Y)


# Subject-driven cells: sample the (pre-blurred, smoothed) matte at the cell
# centre, grow or shrink by one cell, threshold, invert.
_C, _N, _S, _E, _W = _sample(0, 0), _sample(0, 1), _sample(0, -1), _sample(1, 0), _sample(-1, 0)
SUBJECT_VALUE = (f'if(p2y > 0.5, max(max(max({_C}, {_N}), max({_S}, {_E})), {_W}), '
                 f'if(p2y < -0.5, min(min(min({_C}, {_N}), min({_S}, {_E})), {_W}), {_C}))')
# The timed-wipe matte always uses hard (pop) cells: n6 picks the matte here.
_POP = CELL_MASK.replace('n8*', '', 1).replace('if(n6 < 0.5', 'if(0 < 0.5', 1)
TRACK_MASK = (f'n8*if(n6 > 1.5, {_POP}, '
              f'abs(p2x - ({SUBJECT_VALUE} > n7)))')


def hand_track():
    b = Build('Effects', 'Grid Hand Track', F,
              'A moving subject drives the cells: the next shot shows through wherever it goes.',
              tags=['grid-reveal'])
    src(b, 'SrcA')
    b.begin('Timing')
    b.control('Mode', multibutton('Apply at', ['Post', 'Pre', 'Both', 'Whole'], 3))
    b.control('Frames', slider('Frames', 1, 96, 24, integer=True, minA=1, maxA=600))
    b.control('Curve', combo('Curve', EFFECT_CURVES, 0))
    b.end()
    b.hidden('Raw', effect_raw())
    b.hidden('Env', effect_curve())
    b.begin('Look')
    b.control('Strength', slider('Strength', 0, 1, 1, minA=0, maxA=1))
    b.control('Matte', combo('Subject from', MATTES, 0), name='Subject from')
    b.control('Threshold', slider('Threshold', 0, 1, 0.45, minA=0, maxA=1))
    b.control('Grow', combo('Grow / shrink', ['Shrink 1 cell', 'None', 'Grow 1 cell'], 1), name='Grow / shrink')
    b.control('Invert', checkbox('Reveal outside the subject', 0), name='Invert')
    b.control('Smooth', checkbox('Temporal smoothing', 1), name='Temporal smoothing')
    b.control('Fill', combo('Fill', FILLS, 0))
    b.colour('FillColour', 'Fill colour', (0.725, 0.675, 1.0))
    b.end()
    # cells across etc. come from the shared grid controls; order/animation only
    # matter for the timed-wipe matte
    grid_controls(b, cells=14, order=2, anim=0, spread=0.75, line_opacity=0.9)
    active = f'iif({AMT} > 0, 1, 0)'
    # matte: blurred by about half a cell, averaged over 3 frames
    pre = blur(b, 'CellBlur', 'SrcA', '0.35*1000/Controls.Cells')
    t1 = time_tap(b, 'Prev1', pre, '1', blend_frames=False)
    t2 = time_tap(b, 'Prev2', pre, '2', blend_frames=False)
    s1 = merge(b, 'Smooth1', pre, t1, blend='Controls.Smooth/2')
    s2 = merge(b, 'Smooth2', s1, t2, blend='Controls.Smooth/3')
    b.exempt += ['Smooth*.Blend', 'Prev*.SourceTime', 'CellBlur.XBlurSize']
    # Post: the clip opens out of cells; Pre: it breaks into cells at the end.
    prog = progress_expr(clamp01('Controls.Env'))
    m = b.add('Cells', 'Custom', {
        'Image1': conn('SrcA'), 'Image2': conn(s2),
        **{f'NumberIn{i}': Inp(expr=v) for i, v in enumerate(
            ['Controls.Cells', 'Controls.Rows', 'Controls.Order', prog, 'Controls.Spread',
             'Controls.Matte', 'Controls.Threshold', active], 1)},
        'PointIn1': Inp(expr='Point(Controls.Seed, Controls.Corner)'),
        'PointIn2': Inp(expr='Point(Controls.Invert, Controls.Grow - 1)'),
        'Setup1': Inp(ROWS), 'Intermediate1': Inp(CX), 'Intermediate2': Inp(CY), 'Intermediate3': Inp(CELL_P),
        'RedExpression': Inp(TRACK_MASK), 'GreenExpression': Inp(TRACK_MASK),
        'BlueExpression': Inp(TRACK_MASK), 'AlphaExpression': Inp(TRACK_MASK)})
    soft = blur(b, 'Soften', m, 'Controls.Feather')
    # fills
    holes = b.add('Holes', 'BrightnessContrast', {'Input': conn('SrcA'), 'Gain': Inp(0), 'Alpha': Inp(1),
                                                  'EffectMask': conn(soft),
                                                  'Blend': Inp(expr=f'iif(Controls.Fill == 0, 1, 0)*{active}')})
    fc = solid(b, 'FillSolid', ('iif(Controls.Fill == 1, 1, iif(Controls.Fill == 2, 0, FillColour.TopLeftRed))',
                                'iif(Controls.Fill == 1, 1, iif(Controls.Fill == 2, 0, FillColour.TopLeftGreen))',
                                'iif(Controls.Fill == 1, 1, iif(Controls.Fill == 2, 0, FillColour.TopLeftBlue))'))
    c1 = merge(b, 'FillColourOver', holes, fc, mask=soft,
               blend=f'iif(Controls.Fill >= 1, iif(Controls.Fill <= 3, 1, 0), 0)*{active}')
    bl = blur(b, 'FillBlur', 'SrcA', 30)
    c2 = merge(b, 'FillBlurOver', c1, bl, mask=soft, blend=f'iif(Controls.Fill == 4, 1, 0)*{active}')
    wh = solid(b, 'FillWhite', (1, 1, 1))
    c3 = merge(b, 'FillInvert', c2, wh, mode='Difference', mask=soft, blend=f'iif(Controls.Fill == 5, 1, 0)*{active}')
    b.exempt += ['FillBlur.XBlurSize']
    lt = lines_tool(b, 'Lines', 'SrcA', '1')
    col = solid(b, 'LineFill', ('LineColour.TopLeftRed', 'LineColour.TopLeftGreen', 'LineColour.TopLeftBlue'))
    b.set(col, 'EffectMask', Inp(srcop=lt, src='Output'))
    gl = glow(b, 'LineGlow', col, blend='min(1, Controls.LineGlow)', gain_='1 + Controls.LineGlow', threshold=0.1,
              size=10)
    out = merge(b, 'LinesOver', c3, gl, blend=f'Controls.ShowLines*Controls.LineOpacity*min(1, {AMT})')
    b.finish(out)
    return b


def grid_lines():
    b = Build('Effects', 'Grid Lines', F, 'A clean grid over the shot that draws on and off, pixel-exact.',
              tags=['grid-reveal'])
    src(b, 'SrcA')
    b.begin('Timing')
    b.control('Mode', multibutton('Apply at', ['Post', 'Pre', 'Both', 'Whole'], 3))
    b.control('Frames', slider('Frames', 1, 48, 12, integer=True, minA=1, maxA=600))
    b.control('Curve', combo('Curve', EFFECT_CURVES, 1))
    b.end()
    b.hidden('Raw', effect_raw())
    b.hidden('Env', effect_curve())
    b.begin('Look')
    b.control('Strength', slider('Strength', 0, 1, 1, minA=0, maxA=1))
    b.control('Pulse', slider('Pulse every (frames, 0 = off)', 0, 48, 0, integer=True, minA=0, maxA=600),
              name='Pulse')
    b.end()
    grid_controls(b, cells=14, line_opacity=0.85)
    cell_only = ('Order', 'Spread', 'Steps', 'Anim', 'Ease', 'Gap', 'Corner', 'Feather', 'FlashAmt')
    names = [b.ctrl_ui[k]['LINKS_Name'] for k in cell_only]
    b.exposed = [e for e in b.exposed if e[0] not in cell_only]
    b.controls_doc = [c for c in b.controls_doc if c not in names + ['Animation', 'White flash']]
    draw = f'iif(Controls.Mode == 3, 1, min(1, {AMT}))'
    lt = lines_tool(b, 'Lines', 'SrcA', f'min(1, max(0, {draw}))')
    col = solid(b, 'LineFill', ('LineColour.TopLeftRed', 'LineColour.TopLeftGreen', 'LineColour.TopLeftBlue'))
    b.set(col, 'EffectMask', Inp(srcop=lt, src='Output'))
    gl = glow(b, 'LineGlow', col, blend='min(1, Controls.LineGlow)', gain_='1 + Controls.LineGlow', threshold=0.1,
              size=10)
    rel = '(time - comp.RenderStart)'
    pulse = (f'iif(Controls.Pulse > 0, 0.55 + 0.45*max(0, 1 - ({rel} - floor({rel}/Controls.Pulse)*Controls.Pulse)/'
             f'max(1, Controls.Pulse*0.5)), 1)')
    out = merge(b, 'LinesOver', 'SrcA', gl,
                blend=f'Controls.ShowLines*Controls.LineOpacity*min(1, {AMT})*{pulse}')
    _fix_groups(b)
    b.finish(out)
    return b


def _fix_groups(b):
    """Recount group sizes after controls were removed from the Inspector."""
    keys = [k for k, _ in b.exposed]
    groups = [k for k in keys if k.startswith('Grp')]
    for g in groups:
        i = keys.index(g)
        n = 0
        for k in keys[i + 1:]:
            if k.startswith('Grp'):
                break
            n += 1
        if n == 0:
            b.exposed = [e for e in b.exposed if e[0] != g]
            b.ctrl_ui.pop(g, None)
        else:
            b.ctrl_ui[g]['LBLC_NumInputs'] = n


def build():
    transitions()
    hand_track()
    grid_lines()
