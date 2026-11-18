# HermiteCut: TypeScript + Electron + Rust

The long-term stack for HermiteCut on Windows and macOS. This page covers the
design, what's done, and the order of the rest. The current JavaScript app
keeps shipping while the move happens, one piece at a time, with every step
released. The code from before the move is on the `backup/v2-electron` branch.

## Who does what

| Part | Language | Why |
| --- | --- | --- |
| App shell: windows, menus, dialogs, packaging | **TypeScript** on **Electron** | Resolve loads its panels into Electron too, so one shell serves the app and the panel |
| Interface (`core/ui`) | **TypeScript** | Runs in Electron's renderer, in the app and in Resolve |
| Host adapters (`hosts/resolve`, later Premiere and Final Cut) | **TypeScript** | Inside Resolve, the only way to reach Resolve is a JavaScript object (`WorkflowIntegration.node`) |
| Engine: asset library and zips, catalogue, Resolve's folders, Setup and installs, beat analysis, motion maths | **Rust**, as a native addon (napi-rs) | Fast, safe and tested in one place. Node-API addons load in any Electron, including Resolve's |
| Tools: panel installer, template pack generator, sound generator | **Rust** binaries | Single files with nothing else to install |
| Packages, scripts, bundling, TS tests | **Bun** | Fast installs, runs TypeScript directly, built-in bundler and test runner. Development only: Electron runs Node |

## Layout

```
crates/hc-paths       Resolve's folders on Windows and macOS
crates/hc-installer   the panel-only installer (replaced Go)
crates/hc-core        asset library, zip reader, catalogue
crates/hc-resolve     Setup and install operations, and the fuscript bridge
crates/hc-node        the napi-rs addon: hc-core + Setup for Electron
core/native           its TypeScript loader and types (index.ts) and Bun tests
app/                  Electron main and preload (moving to TypeScript)
core/ui, core/lib     interface and shared logic (moving to TypeScript)
hosts/resolve         Resolve adapter (moving to TypeScript)
package.json          Bun: scripts, TypeScript (tsconfig.json), tests; bun.lock
```

## Done

- **Panel-only installer in Rust.** It replaced the Go installer. It handles
  install, reinstall, uninstall, the pre-release folder, admin rights through
  UAC or the macOS password prompt, and refuses unsafe paths. Releases build
  it on Windows.
- **Engine crates** with tests on Windows, macOS and Linux:
  - `hc-paths`;
  - `hc-core`: the asset library (folders and zips by reference, with its own
    zip reader) and the catalogue;
  - `hc-resolve`: the fuscript + `bridge.lua` connection, plus status and the
    Setup and install operations. It is tested against a stand-in fuscript in
    a second process.
- **The Rust addon for Electron (`hc-node`)**, typed in `core/native/index.ts`:
  - version, Resolve's folders, the catalogue;
  - the asset library (index, extract, clear cache);
  - Setup (what's installed, install each item).
  Slow work runs on Node's thread pool and returns a Promise. Bun tests load
  the real addon. CI builds it for Windows x64, Mac arm64 and x64, and Linux.
- **Bun + TypeScript tooling:**
  - `bun run native` builds the addon;
  - `bun run check` type-checks (strict);
  - `bun test` runs the tests.

- **The engine ships and runs (2.0.1).**
  - **Loader:** `core/lib/engine.ts` loads the addon. If it's missing or the
    OS refuses it, `engine()` returns null and the callers use the JavaScript
    code instead.
  - **Swapped to Rust:** the catalogue and the asset library (`catalogue`,
    `libraryIndex`, `libraryClearCache`, and extraction for `libraryUse`).
    A Bun test checks that Rust and JavaScript give the same items.
  - **Build:** `scripts/assemble.py` compiles the loader with `bun build`.
    CI builds the addon on each platform, and `scripts/place-native.ts`
    puts it in the app and the panel.
  - **Log:** the log says which engine is running.

- **Claude over MCP (2.1.0).**
  - `core/mcp/server.ts`: a local MCP server in the app and the panel. It
    speaks Streamable HTTP on 127.0.0.1, needs a bearer token, refuses web
    origins, and offers 12 tools over the existing actions.
  - `crates/hc-mcp`: the stdio bridge for Claude Desktop. Bun tests run it
    against the server end to end.

## Next, in order

1. **Setup in Rust.** The four Setup actions call `hc-node` once they've been
   run on a real PC (they ask for admin rights, so test them by hand first).
2. **TypeScript, file by file.** `app/main`, `app/preload` and
   `hosts/resolve/*`, then `core/ui/js/*`, with types for the Resolve API as it
   is used.
3. **More engine in Rust.** Beat analysis (`core/ui/js/beats.js`) and motion
   curves (`core/lib/motion.js`), with tests against the current output.
4. **Tools in Rust.** The template pack generator and checker
   (`tools/fusegen`) and the sound generator (`tools/sfxgen`). `tools/dev`
   stays Python, because it runs inside Resolve's own Python.
5. **Signing and updates.** Windows code signing, Apple notarisation and
   electron-updater, once the certificates exist.

## Working on it

```bash
bun install                     # TypeScript and types (Bun 1.4+)
bun run native                  # build the Rust addon for this machine -> core/native/
bun scripts/place-native.ts     # after assemble.py: put it in build/app and the panel
bun run check                   # TypeScript, strict
bun test                        # TS tests (they load the real addon)
cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace          # Rust tests
python scripts/assemble.py      # the pack, sounds and panel the app ships
```

CI (`.github/workflows/rust.yml`) runs fmt, clippy, the Rust tests, the
TypeScript check and the Bun tests on all three systems on every push that
touches this code, and keeps the addon builds as artifacts.
