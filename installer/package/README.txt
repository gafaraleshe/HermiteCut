HERMITECUT 1.0.0
================
Motion, easing, alignment, beat markers, captions and one-click editing
tools for DaVinci Resolve Studio, as a floating panel inside Resolve.
By Hermite Labs - https://www.hermitelabs.com/cut

REQUIREMENTS
- DaVinci Resolve STUDIO 19 or newer on Windows (tested on 21.2).
  Workflow Integration plugins are a Studio-only feature.

INSTALL
1. Double-click "Install HermiteCut.exe".
   (Windows SmartScreen may warn because the exe is not code-signed:
    click "More info" > "Run anyway". Or use the no-exe .bat version.)
2. Quit and reopen DaVinci Resolve.
3. Open it from: Workspace > Workflow Integrations > HermiteCut

The panel floats above Resolve (the pin button, top left, toggles this).

TOOLS
- Ease       Bezier speed-curve editor with 30 presets and your own presets.
             Applies to Fusion keyframes: selected nodes on the Fusion page,
             or every keyframe in the selected clips' Fusion comps on the Edit page.
- Align      3x3 align grid with margin, Fit / Fill / Reset / Flip, scale, rotate,
             split-screen and picture-in-picture layouts, blend mode, opacity,
             copy / paste / save transforms. Works on selected Edit-page clips.
- Actions    67 one-click actions: speed, fades, dissolves, ripple delete, close gaps,
             remove silence, enable/disable, link, compound and Fusion clips,
             clip colour, flags, markers, Text+, adjustment clip, loudness
             normalize, voice isolation, volume, auto colour, stabilize, smart
             reframe, tracks, In/Out, playhead, pages, render queue, stills,
             timeline export. Right-click any action to favourite it.
- Motion     Grow, Shrink, Slide, Whip, Spin, Pop, Punch, Ken Burns and Shake for
             selected clips (adds an "HC_Motion" Transform node in each clip's
             Fusion comp, eased with your Ease curve), plus native fades.
- Bounce     Overshoot / Bounce springs on Fusion keyframes, or as a pop-in on clips.
- Beats      Analyses the selected clip's audio (or any audio file) and drops
             markers on beats or transients. Mark every beat, 2, bar or 8.
- Captions   Resolve Studio speech-to-text in 36 languages with Phrases / Words
             formats, characters per line, lines and gap; or import an .srt.

UNINSTALL
Run "Uninstall HermiteCut.bat" (or run the exe again and press R).

TIPS
- Most tools act on the clips you have SELECTED on the Edit page timeline.
- Captions, words mode: Format > Words (about 12 characters per caption).
- Beats: select the music clip (or its audio), press Analyse, then Mark beats.
  Markers are tagged, so the trash button only removes HermiteCut beat markers.
- Motion and Bounce pop-in add an "HC_Motion" Transform node to the clip's
  Fusion comp; the trash button in Motion removes it again.

TROUBLESHOOTING
- Menu item missing: Resolve only scans plugins at startup - restart it.
- Panel says "Not connected": make sure a project is open, then press the
  refresh button. Settings > Open log file shows any errors.

Fonts: Archivo, Outfit and Montserrat (SIL Open Font License 1.1, see
plugin/com.hermitelabs.cut/fonts). Full notices: THIRD_PARTY_NOTICES.txt.
