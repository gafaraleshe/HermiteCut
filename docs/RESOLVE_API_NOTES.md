# Resolve and Fusion scripting notes

These are the facts that HermiteCut depends on. They were **checked against
DaVinci Resolve Studio 21.2 on Windows** while HermiteCut was being built. Where
something differs from Blackmagic's documentation, this file describes what
Resolve actually did. Check again after major Resolve updates. The scripting
reference that ships with Resolve is in
`%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting\README.txt`
on Windows and `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/README.txt`
on macOS.

- [Workflow Integration plugins](#workflow-integration-plugins)
- [JavaScript bridge quirks](#javascript-bridge-quirks)
- [External scripting with fuscript](#external-scripting-with-fuscript)
- [Fusion templates (.setting / .drfx)](#fusion-templates-setting--drfx)
- [Timing inside effects and transitions](#timing-inside-effects-and-transitions)
- [Timeline API (21.x)](#timeline-api-21x)
- [Inspector transform maths](#inspector-transform-maths)
- [Constants](#constants)
- [Fusion tool inputs used by the templates](#fusion-tool-inputs-used-by-the-templates)

---

## Workflow Integration plugins

- They are a **Studio-only** feature. Each plugin is a folder holding
  `manifest.xml`, an Electron `main.js` and a copy of `WorkflowIntegration.node`.
- Install folder:
  - Windows: `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\<id>\`
  - macOS: `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/<id>/`
- Resolve's own sample bridge is at
  `…\Support\Developer\Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node`.
  It must match the installed Resolve version, so installers copy it at install
  time instead of shipping it.
- Resolve only scans the folder **at startup**.
- `WorkflowIntegration.Initialize(pluginId)` must use the same id as the manifest.
  `GetResolve()` then returns the Resolve object.
- The plugin window doesn't stay always-on-top reliably. Set it again with
  `setAlwaysOnTop(true, 'pop-up-menu')` and `moveTop()` on show, restore and blur.
- Normal screen captures, including some screen-recording tools, may not show the
  plugin's top-most window. Use `PrintWindow` or remote debugging (CDP) for test
  screenshots.

## JavaScript bridge quirks

| Behaviour | What to do |
|---|---|
| Methods with no return value throw `Parse - Unknown object type`, even though they ran. | Wrap them: `voidCall(() => obj.Method())`. |
| `undefined` or `null` anywhere in an options object makes the call fail. | Strip them: `clean(opts)`. |
| No `resolve.*` constants. | Hard-code the values (see [Constants](#constants)). |
| `fusion.GetCurrentComp()` doesn't exist. | `await fu.CurrentComp`, or the comp of `Timeline.GetCurrentVideoItem()`. |
| Lists come back as `{ "1": a, "2": b }` objects. | Convert them to arrays, sorted by numeric key. |
| `comp.Execute(lua)` returns **before** the script has run. | Have the script `comp:SetData(key, token…)`, then poll `comp.GetData(key)` (see ARCHITECTURE.md). |

## External scripting with fuscript

This is the bridge the v2 standalone app uses. It was checked from outside
Resolve.

- It needs **Preferences → System → General → External scripting using: Local**.
- Executable:
  - Windows: `C:\Program Files\Blackmagic Design\DaVinci Resolve\fuscript.exe`
  - macOS: `/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fuscript`
- `fuscript -l lua script.lua` runs Lua with `Resolve()` available. Start-up is
  about 0.05 s, so it is fine for a long-lived child process.
- The script can read stdin line by line with `io.read("*l")` and write stdout,
  which is enough for a **JSON-lines RPC**. Lua inside fuscript has **no JSON
  library**, so the bridge must include a small encoder and decoder.
  `bmd.readstring` exists.
- Plan: keep a handle registry in Lua (`id → object`) and generate JS proxy
  objects on the other side, so `lib/actions.js` can call
  `await timeline.GetName()` the same way through either bridge.

## Fusion templates (.setting / .drfx)

- A template is a **macro** saved as a `.setting` file, which is a Lua table:
  `{ Tools = ordered() { Name = MacroOperator { Inputs = …, Outputs = …, Tools = ordered() { … } } }, ActiveTool = "Name" }`.
  The top level is a plain table, not `ordered()`. `tools/fusegen/fuse.py`
  writes this format.
- **Packs** are `.drfx` files: a zip whose paths start with
  `Edit/Effects/<Category>/`, `Edit/Transitions/<Category>/`,
  `Edit/Titles/<Category>/` or `Edit/Generators/<Category>/`. Each
  `<Name>.setting` can have a `<Name>.png` thumbnail beside it.
- Install folder (Resolve picks up `.drfx` files and loose folders here):
  - Windows: `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Templates\`
  - macOS: `~/Library/Application Support/Blackmagic Design/DaVinci Resolve/Fusion/Templates/`
- **New templates appear only after Resolve restarts.** After `resolve.Quit()`,
  launching may need a second attempt.
- Script ids follow the folder: `Fusion/Effects/<Category>/<Name>`, and the same
  pattern for Transitions and Titles.
- **Exposed controls:** put the `UserControls` on a pass-through holder tool,
  `Controls = AlphaDivide { PassThrough = true, … }`. Publish its inputs as
  `InstanceInput`s. Other tools read them through expressions such as
  `Controls.Strength`.
- Expressions can use `time`, `comp.RenderStart`, `comp.RenderEnd`,
  `iif(c, a, b)`, `max`, `min`, `abs`, `sin`, `^` and other tools' inputs.
- **ResolveFX can be used inside macros**, for example
  `ofx.com.blackmagicdesign.resolvefx.Transform`, with its motion blur and
  `edgeBehaviour` set to Reflect for shakes without black edges.
- Input and output conventions:
  - **Effects:** `MainInput1` (the clip) → `MainOutput1`.
  - **Transitions:** `MainInput1` is the **outgoing** clip (Background) and
    `MainInput2` the **incoming** clip (Foreground) → `MainOutput1`.
  - **Titles and generators:** output only.

## Timing inside effects and transitions

- An effect's comp time counts **clip frames at the clip's source frame
  rate**, not timeline frames. A 6 s, 25 fps clip on a 29.97 timeline gave
  `RenderEnd = 148`.
- `comp.RenderStart` is the first rendered frame. With a transition overlap,
  `GlobalStart` can be negative because of handles, so always measure from
  `RenderStart` / `RenderEnd`, never from 0.
- "Post" (from the clip start): `p = (time - comp.RenderStart) / Frames`.
- "Pre" (towards the clip end): `p = (comp.RenderEnd - time) / Frames`.
- Transition progress:
  `(time - comp.RenderStart) / max(1, comp.RenderEnd - comp.RenderStart)`.

## Timeline API (21.x)

These were checked on 21.2. Several are new in Resolve 20 and 21, so check
the README of older versions before relying on them.

| Call | Notes |
|---|---|
| `TimelineItem.AddEffect('fusion' \| 'ofx', id)` | Adds a Fusion template (`Fusion/Effects/<Category>/<Name>`) or an OFX effect to a clip. |
| `TimelineItem.GetEffects()`, `DeleteEffects(...)`, `Effect.GetFusionComp()` | Use these for undo and stacking. **OFX parameters can't be set** through this API. |
| `Timeline.AddTransition({ type, category: 'fusion' \| 'simple', position, alignment, duration })` | Needs **handles** on both clips. Test timelines must use trimmed clips. |
| `TimelineItem.SetPosition({ trackIndex, startFrame })`, `Timeline.MoveItems(...)` | Moves clips precisely. |
| `TimelineItem.SetRightOffset(n)` | Trims. **Titles can't be extended past their default 150 frames.** |
| `Timeline.InsertFusionTitleIntoTimeline(name)` | Inserts **with ripple on V1 at the playhead**. Work-around: move the playhead past the timeline end, insert, then `SetPosition` and trim. |
| `MediaPool.AppendToTimeline([{ mediaPoolItem, startFrame, endFrame, trackIndex, recordFrame, mediaType }])` | Exact placement for SFX and overlays: `mediaType` 1 = video, 2 = audio. |
| `TimelineItem.SetProperties({ CompositeMode: 5, Opacity: 80 })`, `GetProperties()` | Sets several Inspector properties in one call (21.x). Fall back to `SetProperty(key, value)` per key. Composite 5 = Screen, for overlays such as film burns and light leaks. |
| `Timeline.GetEffectsList('video')` | Lists the available effects, including installed templates. |
| `TranscribeAudio` / `GetTranscription`, `Timeline.CreateSubtitlesFromAudio(settings)` | Speech-to-text. |
| `TimelineItem.SetFades(...)`, `TimelineItem.SetSpeed(...)` | Native fades and speed. |
| Frame export | `Project.ExportCurrentFrameAsStill(path)` writes the frame under the playhead (the Color page may need to have been opened once). 21.2 also has a frame-export call that returns base64 PNG data. Search the README for `ExportFrame`. |

## Inspector transform maths

With `bw` × `bh` as the clip's base size at zoom 1 inside the timeline frame
(from source resolution and scaling mode), and `W` × `H` as the timeline size:

- Pan in pixels = `Pan · bw / W`
- Tilt in pixels = `Tilt · bh / H`
- Crop in pixels = `Crop · zoom · bh / H`

## Constants

Read from Resolve 21.2 (the JavaScript bridge doesn't expose them):

| Group | Values |
|---|---|
| Composite mode | NORMAL 0, ADD 1, SUBTRACT 2, DIFF 3, MULTIPLY 4, SCREEN 5, OVERLAY 6, HARDLIGHT 7, SOFTLIGHT 8, DARKEN 9, LIGHTEN 10, COLOR_DODGE 11, COLOR_BURN 12 |
| Auto-caption language | AUTO 0, MANDARIN_SIMPLIFIED 1, DUTCH 2, ENGLISH 3, FINNISH 4, FRENCH 5, GERMAN 6, HINDI 7, INDONESIAN 8, ITALIAN 9, JAPANESE 10, KOREAN 11, MALAY 12, NORWEGIAN 13, POLISH 14, PORTUGUESE 15, ROMANIAN 16, RUSSIAN 17, SPANISH 18, SWEDISH 19, TURKISH 20, VIETNAMESE 21, TAMIL 22, THAI 23, DANISH 24, MANDARIN_TRADITIONAL 25, ARABIC 29, CANTONESE 41, CZECH 43, GREEK 48, HEBREW 53, HUNGARIAN 54, PERSIAN 78, SWAHILI 89, TAGALOG 91, UKRAINIAN 96, URDU 97 |
| Caption preset | SUBTITLE_DEFAULT 0, TELETEXT 1, NETFLIX 2 |
| Caption line break | LINE_SINGLE 1, LINE_DOUBLE 2 |
| Timeline export | AAF 0, DRT 1, EDL 2, FCP_7_XML 3, FCPXML_1_8 4, FCPXML_1_9 5, FCPXML_1_10 6, TEXT_CSV 10, TEXT_TAB 11, OTIO 15, ALE 16, NONE -1 |
| Normalise audio | SET_LEVEL_RELATIVE 0, SET_LEVEL_INDEPENDENT 1 |
| Clip scaling | USE_PROJECT 0, CROP 1, FIT 2, FILL 3, STRETCH 4 |

## Fusion tool inputs used by the templates

This is a working reference for writing macros with `tools/fusegen`. IDs are
the scripting ids. Check any tool you haven't used before in Fusion: select
the node and look at the Inspector tooltips, or run `tool:GetInputList()`.

| Tool (id) | Inputs |
|---|---|
| Transform (`Transform`) | `Center`, `Pivot`, `Size`, `Aspect`, `Angle`, `FlipHoriz`, `FlipVert`, `Edges` (0 Canvas, 1 Wrap, 2 Duplicate, 3 Mirror), `MotionBlur`, `Quality`, `ShutterAngle` |
| Merge (`Merge`) | `Background`, `Foreground`, `Center`, `Size`, `Angle`, `ApplyMode` (`"Normal"`, `"Screen"`, …), `Gain` (0 = additive), `BlendClone` |
| Brightness/Contrast (`BrightnessContrast`) | `Gain`, `Lift`, `Gamma`, `Contrast`, `Brightness`, `Saturation` |
| Soft Glow (`SoftGlow`) | `Threshold`, `Gain`, `XGlowSize`, `RedScale` / `GreenScale` / `BlueScale` |
| Directional Blur (`DirectionalBlur`) | `Type` (0 Linear, 1 Radial, 2 Centered, 3 Zoom), `Center`, `Length`, `Angle`, `Glow` |
| Defocus (`Defocus`) | `Filter` (0 Gaussian, 1 Lens), `XDefocusSize`, `BloomLevel`, `BloomThreshold` |
| Blur (`Blur`) | `Filter`, `XBlurSize`, `LockXY`, `BlendClone` |
| Trails (`Trails`) | temporal feedback: `Restart`, `Preroll`, `RstPrerollOnRender`, `NumberOfPrerollFrames`, `GainRed/Green/Blue/Alpha`, `Rotate`, `XOffset` / `YOffset`, `XScale` / `YScale`, `XBlurSize`, `ApplyMode`, `MergeUnder`. Needs pre-roll to look right mid-shot. |
| Time Speed (`TimeSpeed`) | `Speed` (−5…5, **can't be animated**), `Delay` (frames, −50…50), `InterpolateBetweenFrames` (0 Nearest, 1 Blend, 2 Flow), `SampleSpread` |
| Time Stretcher (`TimeStretcher`) | `SourceTime` (animated spline: the source frame for each comp frame), `InterpolateBetweenFrames` |
| Film Grain (`FilmGrain`) | `Complexity`, `Monochrome`, `Seed`, `TimeLockSeed`, `MasterXSize`, `MasterStrength`, `MasterRoughness`, `LogProcessing` |
| Fast Noise (`FastNoise`) | `Center`, `Detail`, `Contrast`, `Brightness`, `XScale` / `YScale`, `LockXY`, `Angle`, `Seethe`, `SeetheRate`, `Type`, `Color1*` / `Color2*`, `Gradient` |
| Displace (`Displace`) | `Type` (0 Radial, 1 XY), `Center`, `Channel`, `XChannel` / `YChannel`, `RefractionStrength`, `XRefraction` / `YRefraction`, `LightPower`, `LightAngle`, `Spread` |
| Channel Booleans (`ChannelBoolean`) | `Operation` (0 Copy, 1 Add, 2 Subtract, … 13 Difference), `ToRed` / `ToGreen` / `ToBlue` / `ToAlpha` (0 Red FG … 4 Do Nothing, 5 Red BG …) |
| Dissolve (`Dissolve`) | `Operation` (`"DFTDissolve"`, `"DFTAddDissolve"`, `"DFTErode"`, `"DFTRandom"`, `"DFTRandomNoise"`, `"DFTAlphaMerge"`, `"DFTLumaRamp"` with `Map`, `"DFTWipe"`), `Mix`, `DFTWipe.WipeStyle`, `DFTWipe.Softness` |
| Background (`Background`) | `Type` (`"Solid"`, gradients), `TopLeftRed/Green/Blue/Alpha`, gradient stops |
| Text+ (`TextPlus`) | `StyledText`, `Font`, `Style`, `Size`, `Red1/Green1/Blue1`, `UseFrameFormatSettings`, `Width` / `Height` |

### Recipe ideas from testing

- **Shutter angle / slow shutter:** use several `TimeSpeed` taps with
  increasing `Delay` (Blend interpolation) and average them with Merges, each
  at blend 1/k. 180° is half a frame of blur, 360° one frame, 720° two frames
  and 1440° four frames.
- **Start / end / both timing** for every effect: one *Apply at* multi-button
  (Post, Pre, Both, Whole clip) and a *Frames* slider. The amount comes from the
  Post / Pre formulas above, shaped by a *Curve* control.
