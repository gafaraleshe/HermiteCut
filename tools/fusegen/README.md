# fusegen

Write DaVinci Resolve / Fusion **macros** (`.setting` files) and **template
packs** (`.drfx`) from Python, so every HermiteCut template is generated from
source instead of hand-edited in Fusion.

## Why

- Templates stay reviewable and diffable: a change is one line of Python, not a
  re-saved node graph.
- Shared building blocks, such as the *Apply at / Frames / Curve / Strength*
  timing controls, are written once and reused by every effect.
- Packs are rebuilt the same way every time.

## Quick start

```bash
python tools/fusegen/examples/dev_pack.py   # -> build/HermiteCut Dev.drfx
```

Copy the `.drfx` into the Fusion Templates folder and restart Resolve:

- Windows: `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Templates\`
- macOS: `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Templates/`

## API (`fuse.py`)

| Helper | Produces |
|---|---|
| `Tool(type, inputs, pos, user_controls=None, passthrough=False, **extra)` | A tool, such as `Transform { Inputs = {...}, ViewInfo = OperatorInfo {...} }` |
| `Inp(value=None, expr=None, src=None, srcop=None)` | `Input { Value = …, Expression = "…" }`, or a connection to another tool's output |
| `slider`, `checkbox`, `combo`, `multibutton`, `label`, `button` | `UserControls` entries for the Inspector. `label(name, group=n)` makes a collapsible group of the next *n* controls. |
| `II(srcop, src, name=None, page=None, default=None)` | `InstanceInput`: publishes a tool input on the macro |
| `IO(srcop, src='Output')` | `InstanceOutput` |
| `Macro(name, tools, inputs, outputs)` | The whole `{ Tools = ordered() { Name = MacroOperator {…} }, ActiveTool = … }` table |
| `write_setting(path, macro)` | Writes the `.setting` file |
| `Ordered`, `T`, `FuID`, `Raw`, `Arr`, `lua(value)` | Low-level Lua table rendering |

## Conventions for HermiteCut templates

- **Pack layout:** `Edit/Effects/HermiteCut/…`, `Edit/Transitions/HermiteCut/…`,
  `Edit/Titles/HermiteCut/…`, with a `<Name>.png` thumbnail beside each
  `<Name>.setting`. In scripts the effect id is then
  `Fusion/Effects/HermiteCut/<Name>`.
- **Controls holder:** put all `UserControls` on a pass-through
  `AlphaDivide` named `Controls`, and drive the other tools with expressions
  (`Controls.Strength`).
- **Inputs:**
  - effects: `MainInput1` → `MainOutput1`;
  - transitions: `MainInput1` = outgoing (Background), `MainInput2` = incoming
    (Foreground);
  - titles: output only.
- **Timing:** measure from `comp.RenderStart` / `comp.RenderEnd`. Comp time is
  in the clip's source frame rate. See the examples in `dev_pack.py`.
- Keep every template **resolution independent**: use normalised sizes and
  `UseFrameFormatSettings = 1` on generators.

More detail is in [docs/RESOLVE_API_NOTES.md](../../docs/RESOLVE_API_NOTES.md#fusion-templates-setting--drfx).
