# Roadmap

## Status

| Version | Status | Contents |
|---|---|---|
| **1.0** | ✅ Built and tested on Windows (no GitHub Release was ever published) | Workflow Integration plugin: Ease, Align, Actions, Motion, Bounce, Beats, Captions. Go installer. |
| **2.0** | 🛠 Built, offline-tested; not yet tested in Resolve or published | Standalone app (Windows + macOS), template packs, SFX library, asset library, animated captions, Shorts tools |

### 2.0 progress

| Work item | Status |
|---|---|
| Check the external bridge (fuscript), template install and loading, and placement APIs | ✅ Done (see [RESOLVE_API_NOTES.md](RESOLVE_API_NOTES.md)) |
| `tools/fusegen`: macro writer plus a dev pack proven in Resolve (effect, transition, title) | ✅ Done |
| Template pack (`HermiteCut.drfx`): 91 templates (37 effects incl. Slow Film Burn, 5 time FX, 24 transitions, 12 titles, 13 Grid Reveal), passing `check_pack.py` and `test_grid.py` | 🛠 Built; in-Resolve test (`tools/dev/test_pack.py`) and thumbnails pending |
| SFX library (81 sounds, `tools/sfxgen`) and the asset library (`core/lib/assets.js`, zips by reference) | ✅ Built and tested offline |
| Standalone app: `core/` + `hosts/resolve/` adapter, fuscript bridge (`bridge.lua`), Templates / Grid Reveal / Sound / Library / Captions+ / Shorts / Setup modules | ✅ Built; app launched in Electron and the bridge tested end to end against a stand-in Resolve. Not yet run against real Resolve |
| Packaging: Windows `.exe`, macOS `.dmg` (arm64 + x64), release workflow | 🛠 Workflow ready; first run (tag `v2.0.0`) to be started by the owner |
| End-to-end test in Resolve on Windows and Mac | ⏳ |

---

## 2.0 goals

1. **Its own app.** HermiteCut becomes a standalone desktop app with a Windows
   installer (`.exe`) and a macOS disk image (`.dmg`). It is still **reachable
   from inside Resolve**: through the Workflow Integration panel, and through
   **Workspace → Scripts → HermiteCut**, which opens or focuses the app.
2. **An all-in-one music-video and social editing kit.** Effects, time effects,
   transitions, film burns, titles, sound effects and Shorts tools, all applied
   with one click on the selected clips.
3. **Everything editable.** Every template exposes clean, grouped controls in
   Resolve's Inspector: timing, curve, strength, colour, text and animation.
4. **Keep the 1.0 look.** Same design language and the same seven tools, plus
   new modules.

## Architecture

```
HermiteCut app (Electron, Windows + macOS)
 ├─ renderer: the 1.0 UI + new modules (Effects, Transitions, Titles, Time FX,
 │            Sound, Library, Captions+, Shorts, Setup)
 ├─ main:     lib/actions.js (shared with the plugin)
 │            └─ bridge: either WorkflowIntegration.node (plugin mode)
 │                      or fuscript JSON-lines RPC (standalone mode)
 └─ resources: HermiteCut.drfx, SFX library, fonts, scripts
```

- **Standalone bridge.** A long-lived `fuscript -l lua bridge.lua` child process.
  - Requests and replies are JSON lines on stdin and stdout.
  - The Lua side keeps a handle registry (`id → Resolve object`) and includes
    its own JSON encoder and decoder.
  - The JS side wraps each handle in a `Proxy`, so `await timeline.GetName()`
    works exactly as it does with `WorkflowIntegration.node`.
  - It needs Resolve's **External scripting: Local** preference. The Setup
    screen checks for it and explains how to turn it on.
- **Plugin mode** stays: the same app code, loaded by Resolve Studio as a
  Workflow Integration plugin.
- **Scripts launcher.** A tiny Lua script in `Fusion/Scripts/Utility/`
  (*Workspace → Scripts*) that opens the app, or brings it to the front.
- **Setup screen** (first run, and later from Settings). It installs or
  updates:
  - the template pack in `Fusion/Templates/`,
  - the plugin,
  - the launcher script,
  - the fonts the titles use.

  It then asks the user to restart Resolve.

## Features

### Effects pack

Each effect is a Fusion macro applied with `TimelineItem.AddEffect('fusion', …)`
and shares the same core controls:

- **Apply at:** Post (start) / Pre (end) / Both / Whole clip
- **Frames**, **Curve** (ease shape), **Strength**, **Seed** (for random looks)

Stacking means adding more effects. **Undo** removes HermiteCut effects from the
selected clips.

| Group | Effects |
|---|---|
| Flashes | Flash, Glow Flash, Frame Flash (one frame), Colour Flash, Exposure Pop, Strobe |
| Shakes | Twitch, XY Shake, Vertical Shake, Zoom Shake, Earthquake, Handheld |
| Blurs | Defocus, Zoom Blur, Whip Blur, Glow Blur |
| Motion | Zoom Punch, Zoom Out, Slide, Spin, Pop, Bounce, Smooth Zoom, Ken Burns, Fade Move (includes the Hermite Motion presets) |
| Glitch | RGB Split, Digital Glitch, VHS, Invert, Pixelate |
| Film & light | Film Burn, Light Leak, Film Look, Gate Weave, Vignette Pulse, Letterbox |

### Time FX

| Effect | Idea |
|---|---|
| **Slow Shutter** | Real shutter-angle presets: 180°, 360°, 720°, 1440°. Delayed frame taps are averaged to simulate a longer exposure. |
| **Echo** | Ghost trails behind motion. Styles: echoes, glass, stretch. |
| **Prism** | Moving detail splits into a colour trail. Styles: spectrum, delay. |
| **Stutter** | Repeated and held frames. Styles: classic, soft trails. |
| **Time Shift** | Vertical streaks that follow motion. Styles: pull up, pull down. |

### Transitions pack

Applied between two clips with `Timeline.AddTransition({ category: 'fusion' })`.
Clips need handles. Each transition has **Direction**, **Curve**, **Blur**,
**Glow** and **Flash** controls where they make sense.

Whip, Spin 360, Hyper Slide, Shake, Chromatic Split, Lens Flare, Light Wipe,
Grid, Exposure Flash, Focus Pull, Displace, Negative, Scale In, Scale Out,
Shutter Swipe, Shutter Whip, Slide, Split Slide, Swish Glow, Film Burn,
Light Leak, Glitch, Zoom Blur, Luma Fade.

### Titles and text templates

Every title is a Fusion title macro with grouped Inspector controls:
**Text**, **Colour**, **Title Styling**, **Film Look** and **Animation**
(in / out, duration and curve).

- **Music-video credit titles:** a set of distinct styles (clean, blurred,
  distressed, glass, neon, bold and so on), each with **Song**, **Artist**,
  **Directed By** and **Credit** fields.
- **Lower thirds**, **social** (handles, subscribe, call-outs),
  **cinematic** titles and a **neon location** title.
- **Kinetic captions:** see Captions+ below.
- **Custom text templates:** save any title's settings as your own preset in the
  app, and apply it again with one click.

Placement: at the playhead or at the start of the selected clip, on the first
free track above it. See the *InsertFusionTitleIntoTimeline* work-around in
[RESOLVE_API_NOTES.md](RESOLVE_API_NOTES.md#timeline-api-21x).

### Film burns, light leaks and overlays

- Short burns and flashes are effects (above).
- **Slow film burns** and long light leaks are overlay media placed above the
  clip with `MediaPool.AppendToTimeline` and set to the Screen or Add blend.
  Sources are generated in-house or come from the user's own library.

### Sound effects library

A built-in library of sounds made in-house, so there are no licensing problems:

- whooshes and swishes, risers and downers, impacts and hits,
- camera shutters and clicks, glitches, pops and UI clicks,
- film projector, tape stop and reverse effects.

The library lets you preview each sound, mark favourites and search. It inserts
at the **playhead**, on **every cut** of the selection, or on **every marker**,
on an audio track with exact placement.

### Asset library

Indexes the user's own folders, **including inside `.zip` files**, without
copying them. It holds LUTs, overlays, sound effects, `.drfx` packs and `.drt`
timelines. You can browse with previews, extract on demand to a cache and
insert or apply. Third-party packs are never bundled with HermiteCut.

### Captions+

Animated word-by-word captions. The transcript is split into phrases of at most
about 5 seconds. Each phrase becomes a Fusion title whose words light up in
time. Styles come from the text templates.

### Shorts tools

- Duplicate the timeline as **9:16**, with clips set to *scale to crop*.
- **Smart Reframe** on the selection.
- Safe-zone guides, and caption presets placed for vertical video.

## Packaging

| Platform | Output |
|---|---|
| Windows | `HermiteCut-Setup-<version>.exe` (app + Setup), plus a `.zip` |
| macOS | `HermiteCut-<version>-arm64.dmg` and `-x64.dmg`, ad-hoc signed (or Developer ID if available), plus a `.zip` |

Both go on GitHub Releases. The macOS build is best made on a Mac
(`electron-builder`, `hdiutil`, `codesign`).

## Definition of done for 2.0

- Every effect, transition and title renders correctly in Resolve 21.x on
  Windows **and** macOS. This is checked automatically with frame grabs: the
  frame changes when it should, and the clip is untouched outside the effect's
  window.
- Install, update and uninstall work on a clean machine, with no leftover
  plugin folders.
- The app works with Resolve open or closed, says clearly when external
  scripting is off, and never changes a project without the user acting.

## Open questions

- "**Shorter**" was on the 2.0 wish list. It is read as **Shorts tools**
  (vertical edits). It might instead mean keyboard **shortcuts**.
- Support for Resolve **free**: OFX-free Fusion templates work in the free
  version, but external scripting and plugins may not. Decide what the app shows
  there.
