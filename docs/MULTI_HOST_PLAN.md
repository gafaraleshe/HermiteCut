# Plan: HermiteCut for Premiere Pro and Final Cut Pro

**Goal:** the same HermiteCut experience (panel, effects, transitions, titles,
sound, beats, captions) in **DaVinci Resolve, Adobe Premiere Pro and Final Cut
Pro**, on Windows and macOS where the host runs. Final Cut is Mac-only.

**Order:** finish Resolve 2.0 first, then Premiere Pro, then Final Cut Pro.
Each host needs its own integration layer, so plan for months of work, not a
port.

## What can be shared

- **The panel UI**: HTML/CSS/JS, the modules and the design.
- **Logic that doesn't touch the host**:
  - Ease curves and springs (`plugin/js/math.js`);
  - motion preset maths (`plugin/lib/motion.js`);
  - beat detection;
  - the SFX library;
  - the asset library;
  - licensing.
- **The effect catalogue as data**: names, categories, controls, defaults,
  previews. Every host's templates are generated from it.

Restructure into:
- `core/`: UI and logic shared by all hosts;
- `hosts/resolve`, `hosts/premiere`, `hosts/fcp`: each one an **adapter**
  with the same interface (`getSelection`, `applyEffect`, `addTransition`,
  `insertTitle`, `addMarkers`, `placeAudio`…).

`lib/actions.js` becomes the Resolve adapter.

## Premiere Pro (Windows + macOS)

- **Panel:** a **UXP plugin**, Adobe's current plugin system, now in Premiere
  Pro. It is HTML/JS, so the shared UI mostly ports. Fall back to **CEP**
  (HTML panel plus ExtendScript) only for APIs UXP doesn't have yet. Check
  Adobe's Premiere UXP API status at build time.
- **Effects, transitions, titles:** Premiere can't load Fusion macros. Options:
  1. **Motion Graphics Templates (`.mogrt`)**, built in After Effects with
     exposed controls. Good for titles and many transitions.
  2. **Native effects** with the After Effects / Premiere C++ SDK (GPU). This
     is needed for the time effects (shutter angle, echo, prism) and for a
     smooth Grid Reveal.
  3. Presets (`.prfpset`) that stack built-in effects, for simple looks.
- **Selection, markers, audio placement, captions:** the Premiere scripting
  APIs and Premiere's speech-to-text, where it's exposed.
- **Distribution:** a ZXP / UXP package through Creative Cloud or our own
  installer. Native effects install as `.aex` / `.plugin` files.

## Final Cut Pro (macOS only)

- **Panel:** a **Workflow Extension** (Swift / SwiftUI, with a web view for
  the shared UI), shipped in a Mac app. Timeline control is limited. Final Cut
  automation mainly works through **FCPXML** import and export, so
  timeline-editing actions arrive as generated FCPXML.
- **Effects, transitions, titles, generators:** **Motion templates** (built in
  Apple Motion with published parameters). These are the native way.
  **FxPlug 4** (Swift / Metal) is for custom effects that Motion can't do
  (time effects, Grid Reveal).
- **Distribution:** a notarised Mac app or pkg. The Mac App Store is optional.

## Effort and order

| Phase | Work |
|---|---|
| A | Split `core/` from the Resolve adapter. Effect catalogue as data. Resolve 2.0 ships. |
| B | Premiere UXP panel with the shared UI. Titles and transitions as `.mogrt`. Beats, markers and SFX placement. |
| C | Native GPU effects for Premiere (C++ SDK): time FX, Grid Reveal, glitch. |
| D | Final Cut: Motion templates for titles, transitions and effects, plus the Workflow Extension panel. |
| E | FxPlug effects for Final Cut, and one installer per platform that sets up every host it finds. |

**Pricing idea:** one licence covers every host the buyer has. That's a
strong selling point.
