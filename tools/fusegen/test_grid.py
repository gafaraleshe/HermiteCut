#!/usr/bin/env python3
"""Offline checks of the Grid Reveal maths (docs/reference/grid-reveal.md,
"How to check it" and "Quality bar").

The Grid templates compute their mattes per pixel in Fusion Custom tools.
This script runs those exact expressions in Python, at 1920x1080, 3840x2160
and 1080x1920, and checks:

- the first frame shows no cells and the last frame shows every cell (so the
  transition starts on A and ends on B exactly);
- with hard (pop) cells, every cell is entirely on or entirely off mid-way;
  no cell is half filled;
- grid lines sit on the cell borders: every line pixel is within half a line
  width of a border, and the borders themselves are drawn;
- cells stay square (rows follow the aspect ratio) unless rows are set;
- Grid Hand Track switches whole cells on where the subject is.

    python tools/fusegen/test_grid.py build/pack
"""
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import check_pack as cp  # noqa: E402

RES = [(1920, 1080), (3840, 2160), (1080, 1920)]


def _rands(lo, hi, seed):
    h = math.sin(seed * 12.9898) * 43758.5453
    return lo + (hi - lo) * (h - math.floor(h))


def compile_custom(expr):
    src = expr.replace('^', '**')
    src = re.sub(r'\bif\s*\(', '_if(', src)
    src = re.sub(r'\bint\s*\(', '_int(', src)
    return compile(src, '<custom>', 'eval')


BASE = {'_if': lambda c, a, b: a if c else b, '_int': lambda v: float(math.trunc(v)), 'abs': abs, 'min': min,
        'max': max, 'sqrt': math.sqrt, 'floor': math.floor, 'rands': _rands}


class Custom:
    """One Custom tool from a template, evaluated at a time."""

    def __init__(self, t, name, time, images, size):
        tool = t.tools[name]
        inp = tool['Inputs']
        self.env = dict(BASE)
        w, h = size
        self.env.update(w=float(w), h=float(h))
        for i in range(1, 9):
            v = t.value(name, f'NumberIn{i}', time) if f'NumberIn{i}' in inp else 0.0
            self.env[f'n{i}'] = float(v)
        for i in range(1, 5):
            v = t.value(name, f'PointIn{i}', time) if f'PointIn{i}' in inp else (0.5, 0.5)
            self.env[f'p{i}x'], self.env[f'p{i}y'] = float(v[0]), float(v[1])
        for k, fn in images.items():
            self.env[k] = fn
        for i in range(1, 5):
            if f'Setup{i}' in inp:
                self.env[f's{i}'] = eval(compile_custom(inp[f'Setup{i}']['Value']), self.env)
        self.inter = [(f'i{i}', compile_custom(inp[f'Intermediate{i}']['Value']))
                      for i in range(1, 5) if f'Intermediate{i}' in inp]
        self.alpha = compile_custom(inp['AlphaExpression']['Value'])

    def at(self, px, py):
        env = self.env
        env['x'] = (px + 0.5) / env['w']
        env['y'] = (py + 0.5) / env['h']
        for k, code in self.inter:
            env[k] = eval(code, env)
        return float(eval(self.alpha, env))


def images_for(w, h, disc=None):
    def lum(xn, yn):
        if disc:
            cx, cy, r = disc
            dx, dy = (xn - cx) * w, (yn - cy) * h
            return 1.0 if dx * dx + dy * dy <= (r * h) ** 2 else 0.0
        return 0.5 + 0.4 * math.sin(xn * 7.0) * math.cos(yn * 5.0)
    imgs = {}
    for n in '12':
        for c in 'rgb':
            imgs[f'get{c}{n}b'] = lum
        imgs[f'geta{n}b'] = lum
    return imgs


def sample_points(w, h, nx=48, ny=27):
    if h > w:
        nx, ny = ny, nx
    return [(int((i + 0.5) * w / nx), int((j + 0.5) * h / ny)) for j in range(ny) for i in range(nx)]


def check_transition(t, problems, size):
    w, h = size
    s, e = int(t.env['RenderStart']), int(t.env['RenderEnd'])
    names = [n for n, tool in t.tools.items() if tool.typ == 'Custom' and n in ('Cells', 'CellsOut')]
    pts = sample_points(w, h)
    cols = None
    for name in names:
        imgs = images_for(w, h)
        first = Custom(t, name, s, imgs, size)
        last = Custom(t, name, e, imgs, size)
        on0 = sum(first.at(*p) > 0.001 for p in pts)
        off1 = sum(last.at(*p) < 0.999 for p in pts)
        if on0:
            problems.append(f'{w}x{h} {name}: {on0} pixels already revealed on the first frame')
        if off1:
            problems.append(f'{w}x{h} {name}: {off1} pixels not revealed on the last frame')
        cols = first.env['n1']
        rows = first.env['s1']
        cw, ch = w / cols, h / rows
        if abs(cw / ch - 1) > 0.08 and not first.env['n2']:
            problems.append(f'{w}x{h}: cells are not square ({cw:.1f} x {ch:.1f} px)')
        # mid-way, with hard cells every cell is uniform
        # the frame where this tool is half-way through its own progress
        tm = min(range(s, e + 1), key=lambda f: abs(t.value(name, 'NumberIn4', f) - 0.5))
        mid = Custom(t, name, tm, imgs, size)
        if mid.env['n6'] < 0.5:
            cells = {}
            for (px, py) in pts:
                key = (int(px / cw), int(py / ch))
                cells.setdefault(key, set()).add(round(mid.at(px, py), 6))
            mixed = [k for k, v in cells.items() if len(v) > 1]
            # gaps and rounded corners are allowed to cut into cells
            if mixed and not mid.env['n7']:
                problems.append(f'{w}x{h} {name}: {len(mixed)} cells are half filled mid-way')
            vals = {v for vs in cells.values() for v in vs}
            if not ({0.0, 1.0} & vals) or len(vals) < 2:
                problems.append(f'{w}x{h} {name}: mid-way frame is not a mix of on and off cells ({sorted(vals)[:4]})')
    check_lines(t, problems, size, (s + e) // 2)


def check_lines(t, problems, size, time):
    if 'Lines' not in t.tools:
        return
    w, h = size
    ln = Custom(t, 'Lines', time, images_for(w, h), size)
    if ln.env['n4'] < 0.999:
        return
    cols, rows, lw = ln.env['n1'], ln.env['s1'], ln.env['n3'] * h / 1080
    cw, ch = w / cols, h / rows
    bad = 0
    for (px, py) in sample_points(w, h, 96, 54):
        if ln.at(px, py) > 0.5:
            dx = min(((px + 0.5) % cw), cw - ((px + 0.5) % cw))
            dy = min(((py + 0.5) % ch), ch - ((py + 0.5) % ch))
            major = 2 if ln.env['n6'] > 0 else 1
            if min(dx, dy) > lw / 2 * major + 0.5:
                bad += 1
    if bad:
        problems.append(f'{w}x{h}: {bad} line pixels are off the cell borders')
    # every interior vertical border is drawn (sample half-way down each)
    missing = 0
    for k in range(1, int(cols)):
        bx = k * cw
        px = int(bx)  # the pixel straddling or next to the border
        hit = any(ln.at(qx, int(ch * 0.5)) > 0.5 for qx in (px - 1, px, px + 1) if 0 <= qx < w)
        if not hit and ln.env['n7'] < 0.5:
            missing += 1
    if missing:
        problems.append(f'{w}x{h}: {missing} vertical cell borders have no line')


def check_track(t, problems, size):
    w, h = size
    s, e = int(t.env['RenderStart']), int(t.env['RenderEnd'])
    t.overrides = {('Controls', 'Matte'): 0.0}
    disc = (0.5, 0.5, 0.18)
    c = Custom(t, 'Cells', (s + e) // 2, images_for(w, h, disc), size)
    cw, ch = w / c.env['n1'], h / c.env['s1']
    cells = {}
    for (px, py) in sample_points(w, h):
        cells.setdefault((int(px / cw), int(py / ch)), set()).add(round(c.at(px, py), 6))
    mixed = [k for k, v in cells.items() if len(v) > 1]
    if mixed:
        problems.append(f'{w}x{h} Hand Track: {len(mixed)} cells are half filled')
    centre = cells.get((int(w / 2 / cw), int(h / 2 / ch)), {0})
    corner = cells.get((0, 0), {1})
    if max(centre) < 1 or min(corner) > 0:
        problems.append(f'{w}x{h} Hand Track: cells do not follow the subject (centre {centre}, corner {corner})')
    t.overrides = {}


def main(paths):
    files = []
    for p in paths:
        for root, _d, fs in os.walk(p):
            files += [os.path.join(root, f) for f in fs if f.startswith('Grid ') and f.endswith('.setting')]
    failed = 0
    for f in sorted(files):
        t = cp.Template(f)
        problems = []
        for size in RES:
            if t.kind == 'Transitions':
                check_transition(t, problems, size)
            elif t.name == 'Grid Hand Track':
                check_track(t, problems, size)
            if t.name == 'Grid Lines':
                check_lines(t, problems, size, int(t.env['RenderStart']) + 40)
        if problems:
            failed += 1
            print('FAIL', t.name)
            for pr in problems[:8]:
                print('    ', pr)
    print(f'{len(files) - failed}/{len(files)} Grid templates passed the grid checks')
    return failed == 0


if __name__ == '__main__':
    sys.exit(0 if main(sys.argv[1:] or [os.path.join(HERE, '..', '..', 'build', 'pack')]) else 1)
