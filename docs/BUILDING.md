# Building, developing and testing

## Prerequisites

| Task | Needs |
|---|---|
| Run the plugin | DaVinci Resolve **Studio** 19+ |
| Build the Windows installer | [Go](https://go.dev/dl/) 1.22 or newer (cross-compiles from any OS); `zip` on Linux / macOS |
| Screenshots of the panel | Python 3.10+, `pip install playwright` (and `playwright install chromium` if no Chrome is installed) |
| Test clips | `ffmpeg` |
| Template packs (v2) | Python 3.10+ |

The plugin itself has **no npm dependencies**. Resolve provides Electron.

## Build the Windows release

```bash
scripts/build-windows.sh            # Linux / macOS
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows.ps1   # Windows
```

Output in `dist/`:

```
dist/HermiteCut/
  Install HermiteCut.exe                    Go installer with the plugin embedded
  Install HermiteCut (no-exe version).bat
  Uninstall HermiteCut.bat
  README.txt  LICENSE.txt  THIRD_PARTY_NOTICES.txt
  plugin/com.hermitelabs.cut/               the plugin folder, for the .bat installer
dist/HermiteCut-v<version>-windows.zip
```

The build copies `plugin/` into `installer/payload/`, which is git-ignored, and
leaves out `devtools.flag` and any `WorkflowIntegration.node`. It then builds
with `-trimpath -ldflags "-s -w"`, so no local paths end up in the binary.

The version comes from `plugin/package.json`. Keep `plugin/manifest.xml`, the
about line in `plugin/index.html` and `installer/package/README.txt` in step
with it.

## Develop against a live Resolve

1. Quit Resolve.
2. Run `scripts\dev-install.bat` from an **administrator** prompt. It mirrors
   `plugin\` into the Resolve plugin folder and copies Resolve's
   `WorkflowIntegration.node`.
3. For remote debugging, create an empty file called `devtools.flag` next to the
   installed `main.js`. The panel then listens on `127.0.0.1:9339`.
4. Start Resolve and open the panel.

After you change files, run `dev-install.bat` again and restart Resolve. Closing
and reopening the panel is enough for renderer-only changes, such as
`index.html`, `css/` and `js/`.

### Drive the panel from scripts

`tools/dev/cdp.py` connects over the Chrome DevTools Protocol and calls actions
exactly as the UI does:

```bash
pip install websocket-client
python tools/dev/cdp.py status
python tools/dev/cdp.py quick '{"id": "marker", "arg": "Blue"}'
python tools/dev/cdp.py --eval "document.querySelectorAll('.card').length"
```

You can also open `http://127.0.0.1:9339` in Chrome (`chrome://inspect`) and
debug the panel with the normal DevTools.

### Logs

`hermitecut-log.txt` is in Electron's `userData` folder. Use
**Settings → Open log file** to open it. Each failed action is logged with
its stack trace.

## Test without Resolve

- **UI rendering:** `python tools/dev/screenshot.py` loads the panel in
  headless Chrome with a fake bridge (`tools/dev/mock.js`). It writes
  `docs/images/{main,motion,audio,all}.png` and prints any console errors.
  Run it after every UI change, and treat new errors as failures.
- **Syntax:** `for f in plugin/*.js plugin/lib/*.js plugin/js/*.js; do node --check "$f"; done`
- **Installer:** `cd installer && gofmt -l . && go vet ./...` (run a build
  first so that `payload/` exists).

## Test in Resolve (manual checklist)

Use a scratch project, never a client project. `tools/dev/make_test_clips.sh`
makes `CLIP_A/B/C.mp4`: 1080p25, 6 s each, with a moving box, a frame counter
and a tone. Put them on a timeline. For transition tests, trim the clips so they
have handles.

| Tool | Check |
|---|---|
| Status bar | Shows the project, timeline, fps, size, page, timecode and selected count. Updates when you change the selection. |
| Ease | Fusion page: keyframe two nodes, select one, then **Apply ease** changes only that one. Edit page: applies to selected clips. Ctrl+Z on the Fusion page undoes it in one step. |
| Align | Each of the 9 anchors, with margin 0 % and 10 %, and on a cropped clip. Fit, Fill, Reset, Flip. Each layout with 2–4 clips on stacked tracks. Blend modes and opacity. Copy, paste and save a transform. |
| Actions | Every group. Speed / fades / dissolves on one clip and on several. Markers. Insert items land at the playhead. Deliver: add to queue, export still, each timeline export format. |
| Motion | Every preset × In / Out / In + Out, with motion blur on and off. Re-apply replaces the node. 🗑 removes it. |
| Bounce | Keyframes mode on a clean two-key move. Pop-in on clips. |
| Beats | A music clip that is trimmed and speed-changed: markers line up with the hits. The file-based analysis. Clear removes only HermiteCut markers. |
| Captions | Auto language on a dialogue clip. Words format. Import an `.srt`. |

### Automated frame checks inside Resolve

`tools/dev/frametools.py` runs in Resolve's own Python (Workspace → Console, or
any script with access to `resolve`). It moves the playhead, grabs the frame and
measures its brightness, so a test can assert that an effect changed the
picture:

```python
import sys; sys.path.append(r"C:\path\to\HermiteCut\tools\dev")
import frametools as ft
pm = resolve.GetProjectManager(); project = pm.GetCurrentProject(); tl = project.GetCurrentTimeline()
before = ft.mean_luma(ft.grab(project, tl, frame_offset=20))
flash  = ft.mean_luma(ft.grab(project, tl, frame_offset=0))
assert flash > before + 10, (flash, before)
```

## Template packs (v2)

The pack is generated from Python in `tools/fusegen/packs/`. Never edit a
`.setting` file by hand. More in [tools/fusegen/README.md](../tools/fusegen/README.md).

```bash
python tools/fusegen/build_pack.py     # -> build/HermiteCut.drfx + build/HermiteCut-manifest.json
python tools/fusegen/check_pack.py build/pack   # the offline checks on their own
```

`build_pack.py` runs the offline checks and refuses to build a pack that
fails them. The checks cover syntax, known tools and inputs, expressions at
every frame, Post / Pre / Both windows, transition end frames and title
visibility.

### Test the pack in Resolve

On the machine with Resolve, with a scratch project open:

```bash
python tools/dev/preflight.py            # Python, ffmpeg, fuscript, External scripting = Local, project
python tools/fusegen/build_pack.py
python tools/fusegen/install_pack.py     # add --remove-dev to delete old dev packs
```

Restart Resolve, then:

```bash
python tools/dev/test_pack.py --make-clips
```

`test_pack.py` opens or creates the scratch project "HermiteCut Pack Test".
It saves the project that was open first and never changes it. It then:

- applies every effect to a trimmed clip and checks Post, Pre, Both and Whole
  frame by frame against the clip without it;
- puts every transition on a cut with handles and checks that the first frame
  is clip A, the last is clip B and the middle changes;
- inserts every title and checks that it is hidden at both ends and that its
  text field edits the picture.

It writes `build/pack-test/report.md`, plus the frames of any failed check,
and a real 320×180 thumbnail per template in `build/thumbs/`. Run
`build_pack.py` and `install_pack.py` again to put the thumbnails in the pack.
Use `--only "Whip*"` or `--kind transitions` to re-test a few templates.

The small dev pack is still there for quick experiments:
`python tools/fusegen/examples/dev_pack.py` writes `build/HermiteCut Dev.drfx`.

## Releasing

1. Bump the version in `plugin/package.json`, `plugin/manifest.xml`, the about
   line in `plugin/index.html` and `installer/package/README.txt`.
2. Add the release notes to `CHANGELOG.md`.
3. Build the zip, then test the installer on a clean machine or VM, including
   an update over an older version.
4. Publish it. On GitHub go to **Actions → Release → Run workflow**, or push a
   tag `v<version>`. The workflow (`.github/workflows/release.yml`):
   - checks the sources;
   - builds `HermiteCut-v<version>-windows.zip`;
   - creates the tag and the GitHub release, with notes taken from this
     version's section of `CHANGELOG.md`.

   Running it again for the same version replaces the zip.

## Code style

- Plain JavaScript (ES2020) in the plugin, with no build step and no
  dependencies. Every Resolve call is `await`ed.
- Every action returns a small plain object, and the UI shows it as a toast.
  Errors are thrown as `Error` with a message the user can act on.
- Write UI text in British English ("colour", "centre").
- Format Go with `gofmt`.
