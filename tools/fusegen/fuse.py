"""fusegen: write DaVinci Resolve / Fusion macro files (.setting) from Python.

A .setting file is a Lua table. This module renders Python values as that Lua
syntax and has helpers for the parts of a macro: tools, inputs with values or
expressions, user controls (sliders, checkboxes, combos, buttons, labels),
instance inputs/outputs and the MacroOperator wrapper. See README.md.
"""
import re

class Ordered(dict):
    """Rendered as  ordered() { ... }"""
class T:
    """Typed table:  TypeName { ... }"""
    def __init__(self, typ, body=None, **kw):
        self.typ = typ
        self.body = dict(body or {}); self.body.update(kw)
class FuID:
    def __init__(self, s): self.s = s
class Raw:
    def __init__(self, s): self.s = s
class Arr(list):
    """Positional table  { a, b, c }"""

def _q(s):
    return '"' + str(s).replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'

_ident = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')
def _key(k):
    if isinstance(k, int): return '[%d]' % k
    if isinstance(k, float): return '[%s]' % _num(k)
    return k if _ident.match(k) else '[' + _q(k) + ']'

def _num(v):
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, int): return str(v)
    if v == int(v) and abs(v) < 1e15: return str(int(v))
    return repr(float(v))

def lua(v, ind=0):
    tab = '\t'
    p = tab * ind
    if isinstance(v, T):
        return v.typ + ' ' + lua(v.body, ind)
    if isinstance(v, FuID):
        return 'FuID { ' + _q(v.s) + ' }'
    if isinstance(v, Raw):
        return v.s
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return _num(v)
    if isinstance(v, str):
        return _q(v)
    if v is None:
        return 'nil'
    if isinstance(v, Arr) or isinstance(v, (list, tuple)):
        if all(isinstance(x, (int, float, str, bool)) for x in v) and len(v) <= 8:
            return '{ ' + ', '.join(lua(x) for x in v) + ' }'
        return '{\n' + ''.join(p + tab + lua(x, ind + 1) + ',\n' for x in v) + p + '}'
    if isinstance(v, dict):
        pre = 'ordered() ' if isinstance(v, Ordered) else ''
        if not v:
            return pre + '{ }'
        items = ''.join(p + tab + _key(k) + ' = ' + lua(x, ind + 1) + ',\n' for k, x in v.items())
        return pre + '{\n' + items + p + '}'
    raise TypeError(type(v))

# ---------- helpers for building macros ----------
def Inp(value=None, expr=None, src=None, srcop=None, **extra):
    d = {}
    if value is not None: d['Value'] = value
    if expr is not None: d['Expression'] = expr
    if srcop is not None:
        d['SourceOp'] = srcop; d['Source'] = src or 'Output'
    d.update(extra)
    return T('Input', d)

def Tool(typ, inputs=None, pos=(0, 0), user_controls=None, **extra):
    body = {'CtrlWZoom': False}
    if extra.pop('passthrough', False): body['PassThrough'] = True
    body['NameSet'] = True
    if inputs: body['Inputs'] = inputs
    body['ViewInfo'] = T('OperatorInfo', Pos=list(pos))
    if user_controls: body['UserControls'] = user_controls
    body.update(extra)
    return T(typ, body)

def slider(name, lo=0.0, hi=1.0, default=None, integer=False, minA=-1e6, maxA=1e6, page=None):
    d = {'LINKS_Name': name, 'LINKID_DataType': 'Number', 'INPID_InputControl': 'SliderControl',
         'INP_Integer': integer, 'INP_MinScale': lo, 'INP_MaxScale': hi,
         'INP_MinAllowed': minA, 'INP_MaxAllowed': maxA}
    if default is not None: d['INP_Default'] = default
    if page: d['ICS_ControlPage'] = page
    return d

def checkbox(name, default=0, width=None, page=None):
    d = {'LINKS_Name': name, 'LINKID_DataType': 'Number', 'INPID_InputControl': 'CheckboxControl',
         'INP_Integer': True, 'INP_MinScale': 0, 'INP_MaxScale': 1, 'INP_Default': default, 'CBC_TriState': False}
    if width: d['ICD_Width'] = width
    if page: d['ICS_ControlPage'] = page
    return d

def combo(name, options, default=0, page=None):
    d = {'LINKS_Name': name, 'LINKID_DataType': 'Number', 'INPID_InputControl': 'ComboControl',
         'INP_Integer': True, 'INP_MinScale': 0, 'INP_MaxScale': len(options) - 1, 'INP_Default': default,
         'CC_LabelPosition': 'Horizontal'}
    for i, o in enumerate(options):
        d[i + 1] = {'CCS_AddString': o}
    if page: d['ICS_ControlPage'] = page
    return d

def multibutton(name, options, default=0, page=None):
    d = {'LINKS_Name': name, 'LINKID_DataType': 'Number', 'INPID_InputControl': 'MultiButtonControl',
         'INP_Integer': True, 'INP_MinScale': 0, 'INP_MaxScale': len(options) - 1, 'INP_Default': default,
         'MBTNC_ShowName': True, 'MBTNC_StretchToFit': True, 'MBTNC_ShowToolTip': True}
    for i, o in enumerate(options):
        d[i + 1] = {'MBTNC_AddButton': o}
    if page: d['ICS_ControlPage'] = page
    return d

def label(name, group=0, page=None):
    d = {'LINKS_Name': name, 'LINKID_DataType': 'Number', 'INPID_InputControl': 'LabelControl',
         'INP_Integer': False, 'LBLC_DropDownButton': group > 0, 'INP_External': False, 'INP_Passive': True}
    if group: d['LBLC_NumInputs'] = group; d['LBLC_NestLevel'] = 1
    if page: d['ICS_ControlPage'] = page
    return d

def button(name, func, page=None):
    d = {'LINKS_Name': name, 'LINKID_DataType': 'Number', 'INPID_InputControl': 'ButtonControl',
         'BTNCS_Execute': func, 'INP_Integer': False, 'INP_External': False, 'INP_Passive': True}
    if page: d['ICS_ControlPage'] = page
    return d

def Macro(name, tools, inputs, outputs, kind='MacroOperator'):
    return dict({'Tools': Ordered({name: T(kind, {
        'CtrlWZoom': False, 'NameSet': True,
        'Inputs': inputs, 'Outputs': outputs,
        'ViewInfo': T('GroupInfo', Pos=[0, 0]),
        'Tools': tools,
    })}), 'ActiveTool': name})

def II(srcop, src, name=None, page=None, default=None, **extra):
    d = {'SourceOp': srcop, 'Source': src}
    if name: d['Name'] = name
    if page: d['Page'] = page
    if default is not None: d['Default'] = default
    d.update(extra)
    return T('InstanceInput', d)

def IO(srcop, src='Output'):
    return T('InstanceOutput', {'SourceOp': srcop, 'Source': src})

def write_setting(path, macro):
    import os
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(lua(macro) + '\n')
