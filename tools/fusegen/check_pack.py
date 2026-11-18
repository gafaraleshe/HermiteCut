#!/usr/bin/env python3
"""Offline checks for HermiteCut template files (.setting), run without Resolve.

What it checks, for every template:

1. **Syntax.** The file parses as the Lua table format Fusion loads.
2. **Structure.** One MacroOperator; MainInput1 (and MainInput2 for
   transitions) and MainOutput1 exist; every connection and InstanceInput
   points at a tool and an input that exist; no tool is connected to itself.
3. **Known tools and inputs.** Every tool type and input name is on the list in
   KNOWN below. The list matches docs/RESOLVE_API_NOTES.md; extend both
   together after checking a tool in Fusion.
4. **Expressions.** Every expression parses as a Fusion simple expression,
   uses only functions Fusion provides, only refers to tools and inputs that
   exist, and evaluates to a finite number at every frame for every value of
   the template's combo and button controls.
5. **Timing.** Effects: for Apply at Post / Pre / Both, every animated input
   that touches the picture is at its "no change" value outside the window and
   something changes inside it. Transitions: the first frame is exactly the
   outgoing clip and the last frame exactly the incoming clip. Titles: hidden at
   both ends, visible in the middle.

This proves the templates are well formed and that the timing maths is right.
It does not prove how Fusion renders them: that is what tools/dev/test_pack.py
checks inside Resolve.

    python tools/fusegen/check_pack.py build/pack         # a pack folder
    python tools/fusegen/check_pack.py some.setting ...   # single files
"""
import fnmatch
import math
import os
import re
import sys

# ---------------------------------------------------------------- known tools
IMG = ('Input', 'Background', 'Foreground', 'Image1', 'Image2')
COMMON = {'Blend', 'EffectMask'}
KNOWN = {
    'AlphaDivide': {'Input'},
    'PipeRouter': {'Input'},
    'BrightnessContrast': {'Input', 'Gain', 'Lift', 'Gamma', 'Contrast', 'Brightness', 'Saturation',
                           'Red', 'Green', 'Blue', 'Alpha'} | COMMON,
    'Transform': {'Input', 'Center', 'Pivot', 'Size', 'Aspect', 'Angle', 'Edges', 'MotionBlur', 'Quality',
                  'ShutterAngle', 'FlattenTransform', 'FilterMethod', 'FlipHoriz', 'FlipVert'} | COMMON,
    'Merge': {'Background', 'Foreground', 'ApplyMode', 'Gain', 'Center', 'Size', 'Angle'} | COMMON,
    'Dissolve': {'Background', 'Foreground', 'Mix'} | COMMON,
    'ColorGain': {'Input', 'GainRed', 'GainGreen', 'GainBlue', 'GainAlpha'} | COMMON,
    'Blur': {'Input', 'XBlurSize', 'YBlurSize', 'LockXY'} | COMMON,
    'DirectionalBlur': {'Input', 'Type', 'Center', 'Length', 'Angle', 'Glow'} | COMMON,
    'Defocus': {'Input', 'XDefocusSize', 'BloomLevel', 'BloomThreshold'} | COMMON,
    'SoftGlow': {'Input', 'Threshold', 'Gain', 'XGlowSize'} | COMMON,
    'Background': {'Width', 'Height', 'UseFrameFormatSettings', 'TopLeftRed', 'TopLeftGreen', 'TopLeftBlue',
                   'TopLeftAlpha'} | COMMON,
    'FastNoise': {'Width', 'Height', 'UseFrameFormatSettings', 'Detail', 'Contrast', 'Brightness', 'XScale',
                  'SeetheRate', 'Center', 'Angle'} | COMMON,
    'FilmGrain': {'Input', 'MasterStrength'} | COMMON,
    'TimeSpeed': {'Input', 'Delay', 'InterpolateBetweenFrames'},
    'TimeStretcher': {'Input', 'SourceTime', 'InterpolateBetweenFrames', 'SampleSpread'},
    'Custom': ({'Image1', 'Image2', 'Image3', 'RedExpression', 'GreenExpression', 'BlueExpression',
                'AlphaExpression'} | {f'NumberIn{i}' for i in range(1, 9)} | {f'PointIn{i}' for i in range(1, 5)}
               | {f'Setup{i}' for i in range(1, 5)} | {f'Intermediate{i}' for i in range(1, 5)}
               | {f'LUTIn{i}' for i in range(1, 5)} | COMMON),
    'RectangleMask': {'Width', 'Height', 'SoftEdge', 'Invert', 'Center', 'CornerRadius', 'Angle'},
    'EllipseMask': {'Width', 'Height', 'SoftEdge', 'Invert', 'Center', 'Angle'},
    'LumaKeyer': {'Input', 'Low', 'High'} | COMMON,
    'Displace': {'Input', 'Foreground', 'Type', 'RefractionStrength'} | COMMON,
    'TextPlus': {'Width', 'Height', 'UseFrameFormatSettings', 'StyledText', 'Font', 'Style', 'Size', 'Center',
                 'CharacterSpacing', 'Red1', 'Green1', 'Blue1', 'HorizontalLeftCenterRight'},
}
GENERATORS = {'Background', 'FastNoise', 'TextPlus', 'RectangleMask', 'EllipseMask'}
FUNCS = {'iif', 'max', 'min', 'abs', 'floor', 'ceil', 'sin', 'cos', 'sqrt', 'exp', 'Point'}

# "No change" values. Merge / Dissolve are handled separately.
IDENTITY = {
    ('Transform', 'Center'): (0.5, 0.5), ('Transform', 'Size'): 1, ('Transform', 'Angle'): 0,
    ('BrightnessContrast', 'Gain'): 1, ('BrightnessContrast', 'Contrast'): 0,
    ('BrightnessContrast', 'Saturation'): 1, ('BrightnessContrast', 'Brightness'): 0,
    ('BrightnessContrast', 'Lift'): 0, ('BrightnessContrast', 'Gamma'): 1,
    ('ColorGain', 'GainRed'): 1, ('ColorGain', 'GainGreen'): 1, ('ColorGain', 'GainBlue'): 1,
    ('ColorGain', 'GainAlpha'): 1,
    ('Blur', 'XBlurSize'): 0, ('Blur', 'YBlurSize'): 0, ('DirectionalBlur', 'Length'): 0,
    ('Defocus', 'XDefocusSize'): 0, ('Defocus', 'BloomLevel'): 0,
    ('TimeSpeed', 'Delay'): 0, ('Displace', 'RefractionStrength'): 0,
    ('TimeStretcher', 'SourceTime'): 'time',     # shows the current frame
}


class CheckError(Exception):
    pass


# ---------------------------------------------------------------- Lua table parser
class Typed(dict):
    """A table written as  TypeName { ... }"""
    def __init__(self, typ, items):
        super().__init__(items)
        self.typ = typ


class FuIDv(str):
    pass


_TOKEN = re.compile(r'\s*(?:(--[^\n]*)|("(?:[^"\\]|\\.)*")|(-?\d+\.?\d*(?:[eE][-+]?\d+)?)|'
                    r'([A-Za-z_][A-Za-z0-9_]*)|(.))', re.S)


def _tokens(text):
    out = []
    for m in _TOKEN.finditer(text):
        com, s, n, name, p = m.groups()
        if com:
            continue
        if s is not None:
            out.append(('str', bytes(s[1:-1], 'utf-8').decode('unicode_escape')))
        elif n is not None:
            out.append(('num', float(n)))
        elif name is not None:
            out.append(('name', name))
        elif p is not None and not p.isspace():
            out.append(('p', p))
    return out


def parse_setting(text):
    toks = _tokens(text)
    pos = [0]

    def peek(k=0):
        i = pos[0] + k
        return toks[i] if i < len(toks) else ('eof', None)

    def take(kind=None, val=None):
        t = peek()
        if kind and t[0] != kind or val is not None and t[1] != val:
            raise CheckError(f'syntax: expected {val or kind}, got {t[1]!r} (token {pos[0]})')
        pos[0] += 1
        return t

    def value():
        t = peek()
        if t == ('p', '{'):
            return table()
        if t[0] == 'str':
            take()
            return t[1]
        if t[0] == 'num':
            take()
            return t[1]
        if t[0] == 'name':
            take()
            if t[1] in ('true', 'false'):
                return t[1] == 'true'
            if t[1] == 'nil':
                return None
            if t[1] == 'ordered' and peek() == ('p', '('):
                take('p', '(')
                take('p', ')')
                return table()
            if t[1] == 'FuID':
                body = table()
                return FuIDv(body[1])
            if peek() == ('p', '{'):
                return Typed(t[1], table())
            raise CheckError(f'syntax: bare name {t[1]!r}')
        raise CheckError(f'syntax: unexpected {t[1]!r}')

    def table():
        take('p', '{')
        d, n = {}, 1
        while peek() != ('p', '}'):
            if peek() == ('p', '['):
                take()
                k = value()
                take('p', ']')
                take('p', '=')
                d[int(k) if isinstance(k, float) and k == int(k) else k] = value()
            elif peek()[0] == 'name' and peek(1) == ('p', '='):
                k = take()[1]
                take('p', '=')
                if k in d:
                    raise CheckError(f'syntax: duplicate key {k}')
                d[k] = value()
            else:
                d[n] = value()
                n += 1
            if peek() in (('p', ','), ('p', ';')):
                take()
            elif peek() != ('p', '}'):
                raise CheckError(f'syntax: expected , or }} after field, got {peek()[1]!r}')
        take('p', '}')
        return d

    v = value()
    if peek()[0] != 'eof':
        raise CheckError('syntax: trailing text after the table')
    return v


# ---------------------------------------------------------------- expressions
_ETOK = re.compile(r'\s*(?:(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(==|~=|<=|>=|[-+*/^%(),.<>]))')


def _etokens(s):
    out, i = [], 0
    while i < len(s):
        m = _ETOK.match(s, i)
        if not m or m.end() == i:
            if s[i:].strip() == '':
                break
            raise CheckError(f'expression: cannot read {s[i:i + 20]!r}')
        n, name, op = m.groups()
        out.append(('num', float(n)) if n else ('name', name) if name else ('op', op))
        i = m.end()
    return out


def parse_expr(s):
    """Lua expression subset -> nested tuples."""
    toks = _etokens(s)
    pos = [0]

    def peek():
        return toks[pos[0]] if pos[0] < len(toks) else ('eof', None)

    def take(v=None):
        t = peek()
        if v is not None and t[1] != v:
            raise CheckError(f'expression: expected {v!r}, got {t[1]!r} in {s[:80]!r}')
        pos[0] += 1
        return t

    def binary(next_, ops):
        def f():
            left = next_()
            while peek()[0] in ('op', 'name') and peek()[1] in ops:
                op = take()[1]
                left = ('bin', op, left, next_())
            return left
        return f

    def unary():
        if peek() == ('op', '-'):
            take()
            return ('neg', unary())
        if peek() == ('name', 'not'):
            take()
            return ('not', unary())
        return power()

    def power():
        base = primary()
        if peek() == ('op', '^'):
            take()
            return ('bin', '^', base, unary())
        return base

    def primary():
        t = take()
        if t[0] == 'num':
            return ('num', t[1])
        if t == ('op', '('):
            e = expr()
            take(')')
            return e
        if t[0] == 'name':
            path = [t[1]]
            while peek() == ('op', '.'):
                take()
                path.append(take()[1])
            if peek() == ('op', '('):
                take()
                args = []
                if peek() != ('op', ')'):
                    args.append(expr())
                    while peek() == ('op', ','):
                        take()
                        args.append(expr())
                take(')')
                return ('call', '.'.join(path), args)
            return ('ref', path)
        raise CheckError(f'expression: unexpected {t[1]!r} in {s[:80]!r}')

    mul = binary(unary, {'*', '/', '%'})
    add = binary(mul, {'+', '-'})
    cmp_ = binary(add, {'<', '>', '<=', '>=', '==', '~='})
    and_ = binary(cmp_, {'and'})
    expr = binary(and_, {'or'})
    tree = expr()
    if pos[0] != len(toks):
        raise CheckError(f'expression: trailing {peek()[1]!r} in {s[:80]!r}')
    return tree


def _num(v, what):
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise CheckError(f'expression: {what} needs a number, got {v!r}')
    return v


def evaluate(tree, ref):
    k = tree[0]
    if k == 'num':
        return tree[1]
    if k == 'ref':
        return ref(tree[1])
    if k == 'neg':
        return -_num(evaluate(tree[1], ref), 'minus')
    if k == 'not':
        return not evaluate(tree[1], ref)
    if k == 'call':
        name, args = tree[1], [evaluate(a, ref) for a in tree[2]]
        if name == 'iif':
            if len(args) != 3:
                raise CheckError('iif takes 3 arguments')
            c = args[0]
            return args[1] if (c if isinstance(c, bool) else c != 0) else args[2]
        if name == 'Point':
            return (_num(args[0], 'Point'), _num(args[1], 'Point'))
        a = [_num(x, name) for x in args]
        fn = {'max': max, 'min': min, 'abs': abs, 'floor': math.floor, 'ceil': math.ceil, 'sin': math.sin,
              'cos': math.cos, 'sqrt': math.sqrt, 'exp': math.exp}[name]
        try:
            return float(fn(*a))
        except (ValueError, OverflowError):
            return math.nan
    if k == 'bin':
        op = tree[1]
        a, b = evaluate(tree[2], ref), evaluate(tree[3], ref)
        if op in ('==', '~='):
            return (a == b) if op == '==' else (a != b)
        if op in ('and', 'or'):
            return (a and b) if op == 'and' else (a or b)
        a, b = _num(a, op), _num(b, op)
        if op == '<':
            return a < b
        if op == '>':
            return a > b
        if op == '<=':
            return a <= b
        if op == '>=':
            return a >= b
        if op == '+':
            return a + b
        if op == '-':
            return a - b
        if op == '*':
            return a * b
        if op == '/':
            return a / b if b else (math.copysign(math.inf, a) if a else math.nan)
        if op == '%':
            return a - math.floor(a / b) * b
        if op == '^':
            try:
                return float(a) ** b
            except (OverflowError, ZeroDivisionError):
                return math.inf
            except ValueError:
                return math.nan
    raise CheckError(f'expression: cannot evaluate {tree!r}')


def walk_names(tree, out):
    if tree[0] == 'ref':
        out.append(('ref', tree[1]))
    elif tree[0] == 'call':
        out.append(('call', tree[1]))
        for a in tree[2]:
            walk_names(a, out)
    elif tree[0] in ('neg', 'not'):
        walk_names(tree[1], out)
    elif tree[0] == 'bin':
        walk_names(tree[2], out)
        walk_names(tree[3], out)
    return out


# ---------------------------------------------------------------- a loaded template
class Template:
    def __init__(self, path, kind=None):
        self.path = path
        self.name = os.path.splitext(os.path.basename(path))[0]
        parts = path.replace('\\', '/').split('/')
        self.kind = kind or next((p for p in ('Effects', 'Transitions', 'Titles') if p in parts), 'Effects')
        with open(path, encoding='utf-8') as fh:
            root = parse_setting(fh.read())
        tools = root.get('Tools')
        if not isinstance(tools, dict) or len(tools) != 1:
            raise CheckError('top level must hold exactly one macro in Tools')
        (self.macro_name, macro), = tools.items()
        if not isinstance(macro, Typed) or macro.typ not in ('MacroOperator', 'GroupOperator'):
            raise CheckError('the top-level tool must be a MacroOperator')
        if root.get('ActiveTool') != self.macro_name:
            raise CheckError('ActiveTool must name the macro')
        self.tools = macro.get('Tools', {})
        self.inputs = macro.get('Inputs', {})
        self.outputs = macro.get('Outputs', {})
        self.trees = {}
        self.overrides = {}
        self.env = {'RenderStart': 1000.0, 'RenderEnd': 1099.0}
        self.exempt = []

    # --- tool inputs
    def tool(self, name):
        if name not in self.tools:
            raise CheckError(f'no tool called {name}')
        return self.tools[name]

    def inp(self, tool, name):
        return self.tool(tool).get('Inputs', {}).get(name)

    def user_controls(self, tool):
        if tool not in self.tools:
            return {}
        return self.tools[tool].get('UserControls', {}) or {}

    def valid_input(self, tool, name):
        t = self.tool(tool)
        return name in KNOWN.get(t.typ, set()) or name in self.user_controls(tool)

    # --- evaluation
    def value(self, tool, name, time, stack=()):
        key = (tool, name)
        if key in self.overrides:
            return self.overrides[key]
        if key in stack:
            raise CheckError(f'expression loop through {tool}.{name}')
        i = self.inp(tool, name)
        if i is None:
            uc = self.user_controls(tool).get(name)
            if uc is not None:
                return uc.get('INP_Default', 0)
            raise CheckError(f'{tool}.{name} has no value to read')
        if 'Expression' in i:
            tree = self.trees.get(key) or self.trees.setdefault(key, parse_expr(i['Expression']))

            def ref(path):
                if path == ['time']:
                    return time
                if len(path) == 2 and path[0] == 'comp':
                    if path[1] not in self.env:
                        raise CheckError(f'unknown comp attribute {path[1]}')
                    return self.env[path[1]]
                if len(path) == 2:
                    if not self.valid_input(path[0], path[1]):
                        raise CheckError(f'{tool}.{name} reads unknown input {path[0]}.{path[1]}')
                    return self.value(path[0], path[1], time, stack + (key,))
                raise CheckError(f'{tool}.{name} reads unknown name {".".join(path)}')
            v = evaluate(tree, ref)
        else:
            v = i.get('Value')
            if isinstance(v, dict):
                v = (v[1], v[2])
        return v

    # --- graph
    def ancestry(self):
        memo = {}
        roots = {}
        for key, side in (('MainInput1', 'A'), ('MainInput2', 'B')):
            ii = self.inputs.get(key)
            if isinstance(ii, Typed) and ii.get('SourceOp') in self.tools:
                roots[ii['SourceOp']] = side

        def go(name, seen=()):
            if name in memo:
                return memo[name]
            if name in seen:
                raise CheckError(f'image loop through {name}')
            if name in roots:
                res = {roots[name]}
            else:
                res = set()
                t = self.tool(name)
                if t.typ in GENERATORS:
                    res.add('G')
                for slot in IMG:
                    i = t.get('Inputs', {}).get(slot)
                    if i and 'SourceOp' in i:
                        res |= go(i['SourceOp'], seen + (name,))
            memo[name] = res
            return res
        return {n: go(n) for n in self.tools}

    def exempted(self, tool, name):
        return any(fnmatch.fnmatchcase(f'{tool}.{name}', p) for p in self.exempt)


def ident_at(ident, f):
    return float(f) if ident == 'time' else ident


def close(a, b, eps=1e-9):
    if isinstance(a, tuple) or isinstance(b, tuple):
        return isinstance(a, tuple) and isinstance(b, tuple) and all(abs(x - y) <= eps for x, y in zip(a, b))
    return abs(float(a) - float(b)) <= eps


def finite(v):
    if isinstance(v, tuple):
        return all(math.isfinite(x) for x in v)
    if isinstance(v, bool):
        return True
    return isinstance(v, (int, float)) and math.isfinite(v)


# ---------------------------------------------------------------- checks
def check_structure(t):
    problems = []
    if 'MainOutput1' not in t.outputs:
        problems.append('no MainOutput1')
    need = {'Effects': ['MainInput1'], 'Transitions': ['MainInput1', 'MainInput2'], 'Titles': []}[t.kind]
    for k in need:
        if k not in t.inputs:
            problems.append(f'no {k}')
    for tname, tool in t.tools.items():
        if not isinstance(tool, Typed):
            problems.append(f'{tname} is not a tool')
            continue
        if tool.typ not in KNOWN:
            problems.append(f'{tname}: unknown tool type {tool.typ}')
            continue
        for iname, i in (tool.get('Inputs') or {}).items():
            if iname not in KNOWN[tool.typ] and iname not in (tool.get('UserControls') or {}):
                problems.append(f'{tname}.{iname}: not an input of {tool.typ}')
            if not isinstance(i, Typed) or i.typ != 'Input':
                problems.append(f'{tname}.{iname}: not an Input')
                continue
            if 'SourceOp' in i:
                src = i['SourceOp']
                if src == tname:
                    problems.append(f'{tname}.{iname}: connected to itself')
                elif src not in t.tools:
                    problems.append(f'{tname}.{iname}: source {src} does not exist')
                else:
                    want = 'Mask' if t.tools[src].typ.endswith('Mask') else 'Output'
                    if i.get('Source') != want:
                        problems.append(f'{tname}.{iname}: reads {src}.{i.get("Source")}, expected {want}')
            if 'Expression' in i:
                try:
                    tree = parse_expr(i['Expression'])
                except CheckError as e:
                    problems.append(f'{tname}.{iname}: {e}')
                    continue
                for kind, n in walk_names(tree, []):
                    if kind == 'call' and n not in FUNCS:
                        problems.append(f'{tname}.{iname}: function {n} is not available in Fusion expressions')
                    if kind == 'ref':
                        if n in (['time'], ['comp', 'RenderStart'], ['comp', 'RenderEnd']):
                            continue
                        if len(n) != 2 or n[0] not in t.tools:
                            problems.append(f'{tname}.{iname}: unknown name {".".join(n)}')
                        elif not t.valid_input(n[0], n[1]):
                            problems.append(f'{tname}.{iname}: {n[0]} has no input {n[1]}')
        for key, uc in (tool.get('UserControls') or {}).items():
            if uc.get('INPID_InputControl') == 'LabelControl' and uc.get('LBLC_DropDownButton'):
                pass
    keys = list(t.inputs.keys())
    for idx, (key, ii) in enumerate(t.inputs.items()):
        if not isinstance(ii, Typed) or ii.typ != 'InstanceInput':
            problems.append(f'macro input {key} is not an InstanceInput')
            continue
        so, s = ii.get('SourceOp'), ii.get('Source')
        if so not in t.tools:
            problems.append(f'macro input {key}: tool {so} does not exist')
            continue
        if not t.valid_input(so, s):
            problems.append(f'macro input {key}: {so} has no input {s}')
        uc = t.user_controls(so).get(s)
        if uc and uc.get('INPID_InputControl') == 'LabelControl' and uc.get('LBLC_NumInputs'):
            if idx + uc['LBLC_NumInputs'] >= len(keys) + 1:
                problems.append(f'group {key} counts past the last input')
    for key, io in t.outputs.items():
        if not isinstance(io, Typed) or io.get('SourceOp') not in t.tools:
            problems.append(f'macro output {key} points nowhere')
    try:
        t.ancestry()
    except CheckError as e:
        problems.append(str(e))
    return problems


def expr_inputs(t):
    for tname, tool in t.tools.items():
        for iname, i in (tool.get('Inputs') or {}).items():
            if 'Expression' in i:
                yield tname, iname


def choice_controls(t):
    """Combo / multibutton controls on Controls with their option counts."""
    out = {}
    for key, uc in t.user_controls('Controls').items():
        if uc.get('INPID_InputControl') in ('ComboControl', 'MultiButtonControl'):
            out[key] = int(uc.get('INP_MaxScale', 0)) + 1
        if uc.get('INPID_InputControl') == 'CheckboxControl':
            out[key] = 2
    return out


def check_finite(t):
    problems = []
    frames = list(range(int(t.env['RenderStart']), int(t.env['RenderEnd']) + 1))
    choices = choice_controls(t)
    settings = [{}]
    for key, n in choices.items():
        settings += [{key: float(v)} for v in range(n)]
    for s in settings:
        t.overrides = {('Controls', k): v for k, v in s.items()}
        for tname, iname in expr_inputs(t):
            for f in frames[::3] + [frames[-1]]:
                try:
                    v = t.value(tname, iname, f + 0.25 * (f % 2))
                except CheckError as e:
                    problems.append(f'{tname}.{iname}: {e}')
                    break
                if not finite(v):
                    problems.append(f'{tname}.{iname} = {v} at frame {f} with {s or "defaults"}')
                    break
    t.overrides = {}
    return sorted(set(problems))


def watched(t, anc, sides):
    """(tool, input, identity) for expression inputs that must sit at their
    'no change' value, on tools whose picture comes from `sides`."""
    for tname, iname in expr_inputs(t):
        tool = t.tools[tname]
        if t.exempted(tname, iname) or not (anc[tname] & sides) or tname in ('Controls',):
            continue
        typ = tool.typ
        if typ in ('Merge', 'Dissolve'):
            if iname == 'Blend':
                yield tname, iname, 0
            continue
        if iname == 'Blend':
            yield tname, iname, 0
        elif (typ, iname) in IDENTITY:
            yield tname, iname, IDENTITY[(typ, iname)]


def check_effect_timing(t):
    problems = []
    anc = t.ancestry()
    s, e = int(t.env['RenderStart']), int(t.env['RenderEnd'])
    frames = int(t.value('Controls', 'Frames', s))
    modes = int(t.user_controls('Controls')['Mode'].get('INP_MaxScale', 3)) + 1
    watch = list(watched(t, anc, {'A'}))
    if not watch:
        return ['nothing on the picture path is animated']
    for mode, label_ in ((0, 'Post'), (1, 'Pre'), (2, 'Both'), (3, 'Whole'))[:modes]:
        t.overrides = {('Controls', 'Mode'): float(mode)}
        if mode == 0:
            inside, outside = range(s, s + frames), range(s + frames, e + 1)
        elif mode == 1:
            inside, outside = range(e - frames + 1, e + 1), range(s, e - frames + 1)
        elif mode == 2:
            inside = list(range(s, s + frames)) + list(range(e - frames + 1, e + 1))
            outside = range(s + frames, e - frames + 1)
        else:
            inside, outside = range(s, e + 1), range(0)
        for f in outside:
            for tname, iname, ident in watch:
                v = t.value(tname, iname, f)
                if not close(v, ident_at(ident, f)):
                    problems.append(f'{label_}: {tname}.{iname} = {v} at frame {f - s}, outside the '
                                    f'{frames}-frame window (should be {ident_at(ident, f)})')
                    break
            else:
                continue
            break
        changed = any(not close(t.value(tn, i_, f), ident_at(ident, f))
                      for f in inside for tn, i_, ident in watch)
        if not changed:
            problems.append(f'{label_}: nothing changes inside the window')
    t.overrides = {}
    return problems


def check_transition_timing(t):
    problems = []
    anc = t.ancestry()
    s, e = int(t.env['RenderStart']), int(t.env['RenderEnd'])
    for f, side, other, label_ in ((s, 'A', 'B', 'first'), (e, 'B', 'A', 'last')):
        for tname, iname, ident in watched(t, anc, {side}):
            if anc[tname] == {other} or (anc[tname] & {other} and t.tools[tname].typ == 'Dissolve'):
                continue
            v = t.value(tname, iname, f)
            if not close(v, ident_at(ident, f)):
                problems.append(f'{label_} frame: {tname}.{iname} = {v} (should be {ident_at(ident, f)})')
        for tname, tool in t.tools.items():
            if tool.typ == 'Dissolve' and 'Mix' in tool.get('Inputs', {}):
                bg = tool['Inputs'].get('Background', {}).get('SourceOp')
                fg = tool['Inputs'].get('Foreground', {}).get('SourceOp')
                if bg and fg and 'A' in anc[bg] and 'B' in anc[fg]:
                    want = 0 if side == 'A' else 1
                    v = t.value(tname, 'Mix', f)
                    if not close(v, want):
                        problems.append(f'{label_} frame: {tname}.Mix = {v} (should be {want})')
    mid = (s + e) // 2
    if close(t.value('Controls', 'Peak', mid), 0):
        problems.append('Peak is 0 in the middle')
    return problems


def check_title_timing(t):
    s, e = int(t.env['RenderStart']), int(t.env['RenderEnd'])
    problems = []
    v0, v1, vm = (t.value('Opacity', 'Blend', f) for f in (s, e, (s + e) // 2))
    if not close(v0, 0):
        problems.append(f'visible on the first frame (opacity {v0})')
    if not close(v1, 0):
        problems.append(f'visible on the last frame (opacity {v1})')
    if not 0.6 <= vm <= 1.0 + 1e-9:
        problems.append(f'opacity {vm} in the middle')
    return problems


def check_file(path, exempt=()):
    t = Template(path)
    t.exempt = list(exempt)
    problems = check_structure(t)
    if problems:
        return t, problems
    problems += check_finite(t)
    if problems:
        return t, problems
    hidden = t.user_controls('Controls') if 'Controls' in t.tools else {}
    if not ({'Raw', 'Vis'} & set(hidden)):
        return t, problems          # not built on the HermiteCut timing controls
    if t.kind == 'Effects':
        problems += check_effect_timing(t)
    elif t.kind == 'Transitions':
        problems += check_transition_timing(t)
    else:
        problems += check_title_timing(t)
    return t, problems


def check_paths(paths, exempts=None):
    exempts = exempts or {}
    files = []
    for p in paths:
        if os.path.isdir(p):
            for root, _d, fs in os.walk(p):
                files += [os.path.join(root, f) for f in sorted(fs) if f.endswith('.setting')]
        else:
            files.append(p)
    failed = 0
    for f in sorted(files):
        name = os.path.splitext(os.path.basename(f))[0]
        try:
            _t, problems = check_file(f, exempts.get(name, ()))
        except CheckError as e:
            problems = [str(e)]
        if problems:
            failed += 1
            print(f'FAIL {os.path.relpath(f)}')
            for pr in problems[:12]:
                print('     ' + pr)
    print(f'{len(files) - failed}/{len(files)} templates passed the offline checks')
    return failed == 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(0 if check_paths(sys.argv[1:]) else 1)
