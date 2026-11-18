# Installing HermiteCut

## HermiteCut 2.0 (app + panel)

Download from the [latest release](https://github.com/gafaraleshe/HermiteCut/releases/latest).

### Windows

1. Run **HermiteCut-Windows-Setup.exe**. It installs for your user only and
   needs no administrator rights. SmartScreen may warn because the installer
   isn't code-signed yet: click **More info → Run anyway**.
2. Open HermiteCut and go to **Setup**. Click **Install everything**: the
   template pack, the Resolve panel (this one asks for administrator rights),
   the Workspace → Scripts launcher and the title fonts.
3. Restart DaVinci Resolve.

### macOS (Apple Silicon or Intel)

1. Open **HermiteCut-Mac-arm64.dmg** (Apple Silicon) or
   **HermiteCut-Mac-x64.dmg** (Intel) and drag HermiteCut to Applications.
2. **First open on Mac.** The app is ad-hoc signed and not notarised, so
   macOS blocks a normal double-click the first time. After that it opens
   normally.
   - macOS 15 (Sequoia) or newer: double-click HermiteCut once and close the
     warning, then go to **System Settings → Privacy & Security** and click
     **Open Anyway**.
   - macOS 14 or older: **right-click HermiteCut in Applications and choose
     Open**, then click Open again.
   - If macOS says the app "is damaged", run this once in Terminal:
     `xattr -cr /Applications/HermiteCut.app`
3. In HermiteCut, go to **Setup → Install everything**, then restart Resolve.

### Activate your licence

HermiteCut needs a licence key (£30, or $50 in the US, one-time). Buy it
at [cut.hermitelabs.com](https://cut.hermitelabs.com/#purchase); Polar emails
your key and your download links.

1. Open HermiteCut. The first time, it asks for your key.
2. Paste the key and click **Activate**. That's it: HermiteCut now works on
   this computer, and keeps working offline.
3. One key works on **two computers**. To move it, open **Setup → Licence**
   on the old computer and click **Deactivate**, then activate on the new one.

Lost your key? It's in your Polar account: click **Already bought? Find your
key** on the licence screen.

### Use HermiteCut with Claude

HermiteCut runs a small MCP server while it's open (the app or its panel in
Resolve), so Claude can use it: apply templates and transitions, insert
titles, place sounds and run actions on the clips you've selected. It only
listens on your own computer (127.0.0.1) and needs a private key.

1. In HermiteCut, open **Setup**. The **Claude** card says *Ready for Claude*.
2. **Claude Code:** click **Copy command** and paste it into a terminal.
   **Claude Desktop:** click **Copy config**, then in Claude Desktop go to
   **Settings → Developer → Edit Config**, paste it into
   `claude_desktop_config.json` (merge it with any servers already there) and
   restart Claude.
3. Keep HermiteCut open while you work. Ask Claude, for example, "add a Whip
   transition at every cut of the selected clips and a whoosh on each cut".

On a Mac, if Claude Desktop can't start the bridge, run
`xattr -dr com.apple.quarantine /Applications/HermiteCut.app` once.

### The connection to Resolve

The app talks to Resolve through its scripting interface. In Resolve, set
**Preferences → System → General → External scripting using: Local** and
restart Resolve once. The app works with the free version of Resolve. The
panel inside Resolve (Workspace → Workflow Integrations) needs Resolve Studio.

## HermiteCut 1.0 (panel only)

The 1.0 panel is a **Workflow Integration plugin** for **DaVinci Resolve
Studio 19 or newer**, tested on 21.2. Workflow Integration plugins are a Studio
feature, so the free version of Resolve does not show the menu.

## Windows (installer)

1. Get `HermiteCut-v1.0.0-windows.zip` from the
   [Releases page](https://github.com/gafaraleshe/HermiteCut/releases), or build
   it with `scripts/build-windows.ps1` (see [BUILDING.md](BUILDING.md)).
2. **Extract the whole zip.** The installer works on its own, but the
   `.bat` alternatives need the `plugin` folder next to them.
3. Double-click **Install HermiteCut.exe**.
   - SmartScreen may warn because the exe is not code-signed. Click
     **More info → Run anyway**.
   - The plugin folder is under `C:\ProgramData`, so Windows asks for
     administrator permission.
4. If Resolve is open, quit it and open it again. Resolve only looks for
   plugins when it starts.
5. Open **Workspace → Workflow Integrations → HermiteCut**.

### What the installer does

- Copies the plugin to
  `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.hermitelabs.cut\`.
- Copies `WorkflowIntegration.node`, Blackmagic's bridge module, from your own
  Resolve Studio install
  (`…\Support\Developer\Workflow Integrations\Examples\SamplePlugin\`) into that
  folder. This file is never shipped with HermiteCut.
- Deletes any earlier copy first, so updating is a clean install. It also
  removes the folder left by the pre-release build
  (`com.gaffystudios.editkit.resolve`), so you don't get two panels.

Command-line switches, which work with `/` or `-`:

| Switch | Effect |
|---|---|
| *(none)* | Interactive. If HermiteCut is already installed, asks Update, Remove or Quit. |
| `/quiet` | Installs without prompts. |
| `/uninstall` | Removes HermiteCut. Combine with `/quiet` for a silent removal. |

### No-exe alternative

If you don't want to run the `.exe`, right-click
**Install HermiteCut (no-exe version).bat** and choose **Run as administrator**.
It does the same copy with `robocopy`.

### Uninstall

Run **Uninstall HermiteCut.bat**, or run the installer again and press **R**.
Then restart Resolve.

## macOS (manual)

The plugin code is cross-platform. Version 1.0 has no Mac installer, and the Mac
build has not been tested yet. The v2 app adds a `.dmg`. To install by hand:

```bash
SRC="/path/to/HermiteCut/plugin"
ROOT="/Library/Application Support/Blackmagic Design/DaVinci Resolve"
DST="$ROOT/Workflow Integration Plugins/com.hermitelabs.cut"

sudo mkdir -p "$DST"
sudo cp -R "$SRC/." "$DST/"
sudo cp "$ROOT/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node" "$DST/"
```

If the `Developer` folder is somewhere else on your Mac, search for
`WorkflowIntegration.node` inside `/Library/Application Support/Blackmagic Design/`.
Restart Resolve and open **Workspace → Workflow Integrations → HermiteCut**.

## First run

- The status bar under the title shows the project, the timeline, its frame rate
  and size, the current page, the playhead timecode and how many clips are
  selected. A green dot means the panel is connected.
- The **pin** button (top left) keeps the panel above Resolve. You can change
  the default in **Settings**.
- The tool-set tabs at the top switch between **Main tools**, **Motion**,
  **Beats & Captions** and **All**. You can choose which tools appear in
  *Main tools* under **Settings → Custom "Main tools" set**.

## Troubleshooting

| Problem | Fix |
|---|---|
| No *Workflow Integrations* menu | You are on the free version of Resolve. Plugins need Studio. |
| Menu is there but *HermiteCut* isn't | Restart Resolve. Check that `manifest.xml` and `WorkflowIntegration.node` are both in the plugin folder. |
| "WorkflowIntegration.node could not be loaded" | Reinstall. The bridge module must come from the **same** Resolve version that is installed. After a big Resolve update, run the installer again. |
| Panel says *Not connected* | Open a project and a timeline, then press refresh (↻). |
| An action reports an error | Most tools need **selected clips on the Edit page**. **Settings → Open log file** shows the details. |
| Panel hides behind Resolve | Toggle the pin button. Resolve's plugin host sometimes drops "always on top", and the panel turns it back on when it is shown or focused. |
