# AGENTS.md: HermiteCut project context

This file gives a developer or coding agent everything needed to carry on
building HermiteCut without any earlier conversation. Read it first, then the
linked docs. Keep it up to date when decisions change.

---

## 1. Project at a glance

- **What:** HermiteCut is an all-in-one editing toolkit for **DaVinci
  Resolve**. A Hermite Labs product (<https://www.hermitelabs.com/cut>).
- **Owner and sole author:** Gafar (GitHub `gafaraleshe`). The copyright line is
  "Gafar / Hermite Labs".
- **Status:**
  - **v1.0.0** is done. It is a Workflow Integration plugin for Resolve Studio
    with seven tools (Ease, Align, Actions, Motion, Bounce, Beats, Captions) and
    a Windows installer. It was built and tested on the owner's Windows PC with
    Resolve Studio 21.2.
  - **v2.0** is in development. The foundations are verified and the template
    generator exists. The template packs, SFX, standalone app and packaging are
    still to do. Section 9 has the plan.
- **Docs:** [README](README.md) · [Install](docs/INSTALL.md) ·
  [User guide](docs/USER_GUIDE.md) · [Architecture](docs/ARCHITECTURE.md) ·
  [Building & testing](docs/BUILDING.md) ·
  [Resolve API notes](docs/RESOLVE_API_NOTES.md) · [Roadmap](docs/ROADMAP.md) ·
  [Changelog](CHANGELOG.md)

## 2. Working rules (from the owner)

1. **Gafar is the author.** Commit as `Gafar <99144520+gafaraleshe@users.noreply.github.com>`.
   **Never** add `Co-Authored-By` trailers, "generated with" lines or any AI or
   assistant credit to commits, PRs, code, docs or release notes.
2. **This repository is public.** Keep the following out of it:
   - client names and client projects,
   - credentials,
   - Blackmagic binaries (`WorkflowIntegration.node`),
   - Blackmagic's documentation,
   - third-party template, LUT or SFX packs.
3. **Don't use the name "EditKit"** or its "-It" tool names (EaseIt, AlignIt…).
   The owner doesn't own that brand. The product is **HermiteCut**, and the
   tools are Ease, Align, Actions, Motion, Bounce, Beats and Captions.
4. **Make things that work.** "Done" means it has been checked in Resolve: it
   renders, it lands on the right frames, and undo works. Use the test tools in
   `tools/dev/`.
5. **Keep the look.** The owner likes the 1.0 UI: dark cards, accent
   `#b9acff`, Archivo / Outfit / Montserrat fonts. New modules must follow it.
   The aim is "beautiful software" and "as good as possible".
6. Write UI text in British English ("colour", "centre").
7. Don't change the owner's real Resolve projects. Test in a scratch project.

## 3. History and naming

- **13 Nov 2026:** v1 was built as "EditKit for Resolve". It was a Resolve
  rebuild of the idea behind EDITKIT by ZickFX, an MIT-licensed Adobe CEP panel.
  The owner's reference copy is `C:\Users\gafar\Downloads\EDITKIT-2.0.2` and the
  product page is https://zickfx.com/editkit. No EDITKIT code was used.
- **18 Nov 2026:** renamed to **HermiteCut** and moved here. Name changes:

  | Thing | Old | New |
  |---|---|---|
  | Plugin id | `com.gaffystudios.editkit.resolve` | `com.hermitelabs.cut` |
  | Fusion motion node | `EK_Motion` | `HC_Motion` |
  | Beat-marker custom data | `editkit-beat` | `hermitecut-beat` |
  | Comp data key | `EditKit.r` | `HermiteCut.r` |
  | Renderer bridge | `window.ek` | `window.hermite` |
  | UI namespace | `window.EK` | `window.HC` |
  | Storage prefix | `ek.` | `hc.` |

  The new code still **recognises the old names**:
  - `lib/lua.js` adopts or removes `EK_Motion` nodes;
  - `lib/actions.js` also clears `editkit-beat` markers;
  - the installer, `.bat` files and `scripts/dev-install.bat` delete the old
    plugin folder.

  Keep these compatibility paths until 2.x.
- **Hermite Labs context:**
  - hermitelabs.com/cut currently shows a staged plan: **Hermite Motion**
    (presets, easing editor, speed ramps), **Hermite Subs** (on-device
    transcription), **Hermite AI** (local models) and **Hermite API** (cloud).
  - The page says a 7-macro `.drfx` preset pack and a Resolve bridge script
    were built for Hermite Motion. That work probably lives in the owner's
    `gafaraleshe/HermiteLabs` repo. **Check it and merge** so there is one
    HermiteCut.
  - Sister products are HermiteFlow (billing) and HermiteMind (AI). The website
    uses the "Clay" design system.

## 4. Repository map

```
plugin/              v1 Workflow Integration plugin (Electron, no build step)
  main.js, preload.js, lib/{actions,lua,motion}.js, index.html, css/, js/, fonts/, img/
installer/           Go Windows installer (main.go), files shipped beside it (package/)
.github/workflows/   release.yml: builds and publishes the Windows release
scripts/             build-windows.sh / .ps1, dev-install.bat
tools/fusegen/       Python → Fusion .setting / .drfx generator (v2 templates)
tools/dev/           screenshot.py + mock.js, make_test_clips.sh, frametools.py, cdp.py
docs/                documentation and screenshots
```

## 5. Commands

```bash
# checks that need no Resolve
for f in plugin/*.js plugin/lib/*.js plugin/js/*.js; do node --check "$f"; done
python tools/dev/screenshot.py            # renders the UI with a mock bridge; must print "no console errors"
scripts/build-windows.sh                  # dist/HermiteCut-v<ver>-windows.zip (needs Go)
# releases: GitHub Actions > Release > Run workflow (builds the zip, tags v<ver>, publishes the release)
python tools/fusegen/examples/dev_pack.py # build/HermiteCut Dev.drfx
tools/dev/make_test_clips.sh              # build/testmedia/CLIP_A/B/C.mp4

# Windows, against a live Resolve (admin prompt, Resolve closed)
scripts\dev-install.bat
python tools/dev/cdp.py status            # needs devtools.flag next to the installed main.js
```

## 6. The owner's setup

- **Windows PC.** DaVinci Resolve **Studio 21.2** is installed at
  `C:\Program Files\Blackmagic Design\DaVinci Resolve\`, with `fuscript.exe` in
  the same folder. **Preferences → System → General → External scripting**
  must be **Local** for the standalone bridge.
- **Mac:** the owner also edits on a Mac, so v2 must ship a `.dmg`. Build both
  arm64 and x64 unless the owner says which.
- **Asset folders the owner offered** (Windows, drive F:): `F:\master bundle`
  and `F:\Edit resources`. They may hold LUTs, overlays, SFX and packs. Use them
  only through the asset-library feature, by reference. Never copy them into
  this repo or the installers.
- **Left over from v1 and v2 testing on the PC.** Clean these up when 2.0 is
  installed, and ask the owner before deleting a project:
  - The old plugin folder
    `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.gaffystudios.editkit.resolve`.
    The HermiteCut installer removes it.
  - The dev template pack `EditKit Dev.drfx` in
    `%APPDATA%\Blackmagic Design\DaVinci Resolve\Support\Fusion\Templates\`.
  - Scratch files in `C:\Users\gafar\Downloads\EDITKIT-2.0.2\_ektest\` and
    `%LOCALAPPDATA%\Temp\editkit-test\`. The second holds test clips and the
    first versions of `frametools.py` and `cdp.py`.
  - The Resolve project **"EditKit Test"**, with timeline **"EK2 Handles Test"**:
    trimmed clips with handles, used for transition tests. The owner hasn't
    decided yet whether it can be deleted.
- **Ways to run scripts inside Resolve:**
  - Resolve's Console (Workspace → Console);
  - `fuscript -l lua|py3 script` from a terminal;
  - a Resolve MCP server, if one is set up in your tools. Earlier development
    used one that runs Python with `resolve` and `project` pre-defined.

## 7. Verified technical knowledge

The full details are in **[docs/RESOLVE_API_NOTES.md](docs/RESOLVE_API_NOTES.md)**.
The points that matter most:

1. **The JS bridge** (`WorkflowIntegration.node`):
   - every call is async;
   - void methods throw `Unknown object type`, so use `voidCall`;
   - `undefined` in options is rejected, so use `clean`;
   - there are no `resolve.*` constants, so use the `CONST` table in
     `lib/actions.js`;
   - `comp.Execute` is asynchronous, so use the token reply through
     `comp:SetData` / `GetData`.
2. **External bridge** (planned for the v2 standalone app):
   `fuscript -l lua bridge.lua` works with `Resolve()`. It reads stdin with
   `io.read("*l")` and starts in about 0.05 s. Lua there has no JSON library,
   so write one.
3. **Templates:**
   - a `.drfx` is a zip of `Edit/{Effects,Transitions,Titles,Generators}/<Category>/<Name>.setting`
     with optional `<Name>.png`;
   - install it in the Fusion `Templates` folder, then **restart Resolve**;
   - the script id is `Fusion/Effects/<Category>/<Name>`;
   - transitions use `MainInput1` = outgoing and `MainInput2` = incoming.
4. **Effect timing:**
   - comp time is in the **clip's source fps**;
   - measure from `comp.RenderStart` / `comp.RenderEnd`, never from 0;
   - Post = `(time - comp.RenderStart) / Frames`;
   - Pre = `(comp.RenderEnd - time) / Frames`.
5. **Placement (21.x):**
   - `TimelineItem.AddEffect('fusion', id)`, `GetEffects`, `DeleteEffects`;
   - `Timeline.AddTransition({type, category:'fusion', position, alignment, duration})`
     needs clip handles;
   - `InsertFusionTitleIntoTimeline` ripple-inserts on V1 at the playhead.
     Work-around: insert past the timeline end, then `SetPosition` and trim;
   - titles can't be longer than **150 frames**;
   - `MediaPool.AppendToTimeline([{…, trackIndex, recordFrame, mediaType}])`
     places SFX and overlays exactly;
   - `SetProperties({CompositeMode: 5})` sets Screen.
6. **Fusion tool ids and inputs** for the templates are tabled at the end of
   RESOLVE_API_NOTES.md (Transform, Merge, DirectionalBlur, Defocus, TimeSpeed,
   Trails, FastNoise, Displace, Dissolve, TextPlus…).

**Proven in Resolve** with `tools/fusegen/examples/dev_pack.py` (as "EditKit
Dev" before the rename):
- an effect whose flash follows Post / Pre / Both timing;
- a transition whose progress follows the overlap;
- a Text+ title with its text exposed.

## 8. What the owner asked for in v2

This is a paraphrase. Quoted phrases are the owner's words.

- "Its own separate software, like the scripts": a standalone app with a
  **macOS `.dmg`** and a **Windows `.exe`**, and also "accessible from inside
  DaVinci Resolve itself".
- "Every feature these videos I've added have … and it should work."
  The owner shared six reference videos of commercial Resolve packs for
  music-video editing. They aren't stored anywhere you can reach, so ask the
  owner to share them again if you need detail. What they showed is captured
  in [docs/ROADMAP.md](docs/ROADMAP.md):
  - effect families with **Apply at Pre / Post / Both** and frame counts;
  - transitions;
  - credit titles with **Song / Artist / Directed By / Credit** fields and
    Inspector groups **Color, Title Styling, Film Look, Animation**;
  - film looks.
- Text templates, Fusion templates, effect templates, and "**custom text
  templates for everything**".
- "**Shorter**". This is unclear: it is taken to mean **Shorts tools**
  (vertical 9:16), but it could mean keyboard shortcuts. **Confirm with the
  owner.**
- "**Shutter angles**, everything, **slow film burns**".
- "Sound effects built inside, **SFX** like **whoosh** sounds, **shutter**
  sounds, everything".
- "An all-in-one plugin that is just a **powerhouse**", in "beautiful
  software", for both Mac and Windows.

**Reference products** the owner pointed to, for the *looks* only. Build
original implementations, and never copy their files, names or presets:

- **Time Drift** (thecreativeherd.com/tools/time-drift): five OFX time effects.
  - Time Shift: vertical motion streaks, *Pull Up* / *Pull Down*.
  - Slow Shutter.
  - Prism: colour-split trails, *Spectrum* / *Delay*.
  - Echo: *Echoes* / *Glass* / *Stretch*.
  - Stutter: *Classic* / *Soft Trails*.
- **Viral Transitions Pack** (oscarmerinostore.com): 20 drag-and-drop
  transitions with direction, curve, blur, glow and flash controls. Examples:
  Whip, Spin 360, Hyper Slide, Shake, Chromatic Split, Lens Flare, Light Wipe.

## 9. v2 plan and next steps

The complete feature spec is in [docs/ROADMAP.md](docs/ROADMAP.md). Steps are
numbered to match the owner's task list. **Steps 1–5 are done**: the v1 plugin,
the installer, the Resolve API checks, `tools/fusegen` with its dev pack, and
this repository with its docs. **Continue from step 6**, in order, and tick
items off in the ROADMAP status table.

**Before step 6, on the owner's Windows PC:**

1. DaVinci Resolve Studio is open with a scratch project. "EditKit Test" can be
   reused.
2. **Preferences → System → General → External scripting using** is set to
   **Local**.
3. The bridge works. Save `print(Resolve():GetVersionString())` as `check.lua`,
   then run `"C:\Program Files\Blackmagic Design\DaVinci Resolve\fuscript.exe" -l lua check.lua`.
   It should print a 21.x version.
4. Python 3 is on PATH, for `tools/fusegen` and the frame checks.

6. **Template pack (`HermiteCut.drfx`).**
   - Extend `tools/fusegen` with one pack script per family:
     `tools/fusegen/packs/{effects,timefx,transitions,titles}.py` and a
     `build_pack.py` that zips everything.
   - Shared controls on every effect: *Apply at* (Post / Pre / Both / Whole),
     *Frames*, *Curve*, *Strength*, *Seed*.
   - **Slow Shutter:** shutter angles 180 / 360 / 720 / 1440°, made from
     `TimeSpeed` taps averaged with Merges.
   - **Thumbnails:** real renders. Apply each template to `CLIP_A` in Resolve,
     grab frames and save them as `<Name>.png`.
   - **Verify each template** on the test timeline with
     `tools/dev/frametools.py`. The frame must change inside the window and
     stay identical outside it, and transitions must blend A into B.
7. **SFX library** (`tools/sfxgen/`). About 80 sounds made with
   numpy / scipy: whooshes, swishes, risers, downers, impacts, shutter clicks,
   camera, glitches, pops, UI clicks, film projector, tape stop. Use 48 kHz
   WAV, peak around −1 dBFS, with consistent names and category folders.
   Ship them as app resources. They may not be committed if they are large;
   generate them at build time.

   **Asset library** (also step 7):
   - Index user folders, including `.zip` contents, with no copying.
   - Types: LUTs (`.cube`), overlays (video and images), audio, `.drfx`, `.drt`.
   - Show previews, extract on demand to a cache, then insert or apply.
8. **Standalone app (v2).** Electron, Windows + macOS.
   - `bridge.lua`: a JSON-lines RPC over fuscript with a handle registry, plus
     JS `Proxy` objects so `lib/actions.js` runs unchanged.
   - Plugin mode keeps working.
   - Launcher script in `Fusion/Scripts/Utility/`.
   - New UI modules:
     - **Effects** (browse, Pre / Post / Both, frames, favourites, undo),
     - **Transitions**,
     - **Titles** (at playhead or clip start, editable fields, custom presets),
     - **Time FX**,
     - **Sound**,
     - **Library**,
     - **Captions+** (animated word captions as per-phrase titles of ≤150
       frames),
     - **Shorts** (9:16 duplicate, scale to crop, Smart Reframe, safe zones),
     - **Setup** (installs templates, plugin, launcher and fonts; checks that
       External scripting is Local).
9. **Packaging.**
   - Windows: an installer `.exe` (the extended Go installer, or
     electron-builder NSIS) plus a `.zip`.
   - macOS: `.dmg` for arm64 and x64, ad-hoc signed unless the owner provides a
     Developer ID. Build on the Mac.
   - Publish on GitHub Releases.
10. **End-to-end test** on Windows and Mac against Resolve 21.x. Then clean up
   the leftovers listed in section 6, and update the website `/cut` page,
   README, CHANGELOG and this file.

## 10. Decisions already made

- Effects are **per-clip Fusion effects** (`AddEffect`), not adjustment clips,
  so they travel with the clip. Stacking means adding more effects.
  Undo = `DeleteEffects` on HermiteCut ids.
- Long overlays (slow film burns, light leaks) are **media on a track above**,
  placed with `AppendToTimeline` and set to the Screen / Add blend.
- Animated captions are **per-phrase titles**, at most about 5 s each, because
  titles can't be longer than 150 frames.
- User and third-party assets are **referenced, never bundled**.
- Before v2 ships, the 1.0 plugin stays the supported way to use HermiteCut.

## 11. Open questions for the owner

- What does "shorter" mean: Shorts tools or keyboard shortcuts?
- Mac: Apple Silicon, Intel or both?
- Can the "EditKit Test" Resolve project and the scratch folders be deleted?
- Should the website `/cut` page be updated to describe HermiteCut 1.0 now?
