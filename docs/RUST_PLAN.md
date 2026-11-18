# HermiteCut in Rust

HermiteCut is moving to Rust for the long term, on Windows and macOS. This
page covers the target design, what is ported, and the order of the rest.
The Electron app stays the released version until the Rust app can do
everything it does. A copy of the code from before the move is on the
`backup/v2-electron` branch.

## The one hard limit

The **panel inside Resolve** (Workspace → Workflow Integrations) has to stay
JavaScript. Resolve loads these panels into its own Electron, through
`manifest.xml`, `main.js` and Resolve's `WorkflowIntegration.node`. So:

- the **standalone app** becomes Rust (Tauri), and is what most people use;
- the **panel** stays a thin JavaScript layer over the same UI. Its logic can
  later come from the Rust core compiled to WebAssembly, which Resolve's
  Electron can load, so there is still one implementation.

`core/ui` (HTML, CSS, JS) stays the interface for both. In the Rust app it
runs in the system web view (WebView2 on Windows, WebKit on macOS), which is
why the app is far smaller than the Electron one.

## Layout

| Crate | Replaces | What it does |
| --- | --- | --- |
| `crates/hc-paths` | the paths in `studio.js` and the Go installer | Where Resolve keeps templates, scripts, plugins, fonts and fuscript, on Windows and macOS |
| `crates/hc-installer` | `installer/` (Go) | The panel-only installer: `Install HermiteCut.exe` on Windows, and the same program on macOS |
| `crates/hc-core` | `core/lib` | Asset library (folders and zips by reference), template and sound catalogue, zip reading |
| `crates/hc-resolve` | `hosts/resolve` (standalone mode) | The fuscript + `bridge.lua` connection, and the Resolve actions |
| `crates/hc-app` | `app/main.js`, `app/preload.js` | The desktop app (Tauri 2): window, file dialogs, and `window.hermite` for `core/ui` |

The Go installer is gone. Releases build `Install HermiteCut.exe` from
`crates/hc-installer`.

## Status

Ported and tested, with tests that run on Windows, macOS and Linux in CI:

- **Installer:** install, reinstall, uninstall, removing the pre-release
  panel, admin rights through UAC (Windows) or the macOS password prompt,
  and refusing unsafe paths.
- **Resolve connection:** fuscript + `bridge.lua`, handles, timeouts,
  "no method" as null, and reconnecting after Resolve restarts. It is tested
  against a stand-in fuscript in a second process.
- **Actions:**
  - `status`, `setupStatus`, `installTemplates`, `installLauncher`,
    `installFonts`, `installPlugin`;
  - `catalogue`, `libraryIndex`, `libraryClearCache`;
  - `hostInfo`.
- **App shell:** the full `core/ui` in a frameless, pinnable window, with file
  dialogs, reading files (for Beats), the log and external links.

Still to port, in this order. Each action keeps the name and JSON it has in
`hosts/resolve`, so the UI doesn't change.

1. **Templates and Grid Reveal:** `applyEffect`, `removeEffects`,
   `addTransition`, `insertTitle` (and the Lua in `hosts/resolve/lua.js`).
2. **Sound and Library:** `placeAudio`, `libraryUse`.
3. **Motion, Ease and Bounce:** `easeKeys`, `bounceKeys`, `clipMotion`,
   `removeMotion`, `fades` (and `core/lib/motion.js`).
4. **Align:** `transform`, `copyTransform`, `pasteTransform`, `align`, `layout`.
5. **Actions:** `quick` (the 67 one-click actions), `playhead`, `openPage`,
   `exportTimeline`, `exportStill`, `queueRender`, `renderPresets`.
6. **Beats:** `audioSource`, `addBeatMarkers`, `clearBeatMarkers`.
7. **Captions and Shorts:** `createCaptions`, `captionStatus`,
   `importSubtitles`, `captionsPlus`, `shortsDuplicate`, `smartReframe`.

Then:

8. **Build tools in Rust:** the template generator and checker
   (`tools/fusegen`) and the sound generator (`tools/sfxgen`).
   `tools/dev` stays Python, because it runs inside Resolve's own Python.
9. **Switch the release:** the Rust app takes the HermiteCut name and app ID
   (`com.hermitelabs.cut`) and the Electron standalone app is retired. The
   panel uses the shared core.
10. **Signing and updates:** Windows code signing, Apple notarisation and
    Tauri's updater, once the certificates exist.

Until it is renamed, the preview installs as **HermiteCut Preview**
(`com.hermitelabs.cut.preview`), so it sits next to the Electron app
without replacing it. Actions that aren't ported yet say so in the app.

## Working on it

```bash
cargo test --workspace --exclude hc-app      # everything except the app window
python scripts/assemble.py                   # the pack, sounds and panel the app ships
cargo run -p hc-app                          # run the app from the repo
```

Building the installers needs the Tauri CLI, run in `crates/hc-app`:
`npx @tauri-apps/cli@2.12.4 build --bundles nsis` on Windows, and on macOS
`... build --bundles dmg --target universal-apple-darwin`. On Linux, the app
also needs WebKitGTK (`libwebkit2gtk-4.1-dev`). The other crates don't.

CI (`.github/workflows/rust.yml`) runs fmt, clippy and the tests on all three
systems, then builds **HermiteCut-Rust-Preview-Windows** and
**HermiteCut-Rust-Preview-Mac** as downloadable artifacts on every push that
touches the Rust code.
