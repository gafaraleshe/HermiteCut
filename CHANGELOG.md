# Changelog

All notable changes to HermiteCut are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `tools/fusegen`: a Python writer for Fusion macros (`.setting`) and `.drfx`
  packs. It is the base of the 2.0 template packs, and it comes with an example
  pack (effect, transition, title) that has been checked in Resolve.
- Development tools: panel screenshots with a mock bridge, test-clip generator,
  in-Resolve frame checks (`frametools.py`), and remote control of the panel
  over CDP (`cdp.py`).

## [1.0.0] - 2026-11-18

First public release as **HermiteCut**, a Workflow Integration plugin for
DaVinci Resolve Studio 19+ (tested on 21.2, Windows).

### Added
- **Ease:** cubic-bezier speed-graph editor with 30 presets and saved custom
  curves. Applies to Fusion keyframes on selected nodes, or on selected clips'
  comps.
- **Align:** 3×3 align grid with margin, fit / fill / reset / flip, scale and
  rotate steps. Split-screen and picture-in-picture layouts with gap. Blend
  modes, opacity, and copy / paste / save transforms.
- **Actions:** 67 one-click actions in eight groups plus favourites and search.
  A Deliver section for render presets, queueing, stills and timeline export
  (FCPXML, FCP 7 XML, EDL, OTIO, CSV, DRT).
- **Motion:** Grow, Shrink, Slide ×4, Whip, Spin, Pop, Punch, Ken Burns and
  Shake, as In / Out / In + Out. Eased with the Ease curve, with optional motion
  blur. Native fades.
- **Bounce:** overshoot and bounce springs on Fusion keyframes, or as a pop-in
  on clips.
- **Beats:** beat and transient detection inside the panel, on the selected
  clip or an audio file. Markers every beat, 2, bar or 8, with offset, minimum
  gap and colour, on the timeline or the clip.
- **Captions:** Resolve Studio speech-to-text in 36 languages with phrase,
  word and custom formats. `.srt` / `.vtt` import.
- Windows installer (single `.exe`, with silent install and uninstall), a
  no-exe `.bat` installer and an uninstaller.

### Changed
- Renamed from the pre-release working name. The plugin id is now
  `com.hermitelabs.cut`. The installer removes the pre-release plugin folder,
  and HermiteCut still recognises motion nodes and beat markers made by the
  pre-release build.

[Unreleased]: https://github.com/gafaraleshe/HermiteCut/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/gafaraleshe/HermiteCut/releases/tag/v1.0.0
