# Development tools

| File | Use |
|---|---|
| `screenshot.py` | Renders the panel in headless Chrome with `mock.js` standing in for Resolve. Saves `docs/images/*.png` and reports console errors. |
| `mock.js` | Fake `window.hermite` bridge, used only by `screenshot.py`. |
| `make_test_clips.sh` | Makes `CLIP_A/B/C.mp4` (1080p25, 6 s, moving box, frame counter, tone) in `build/testmedia/`. |
| `frametools.py` | Grabs the frame under the playhead and measures it (brightness, difference between two frames, letterbox bars), or scales it to a thumbnail. Standard library only, so it runs in Resolve's Python. |
| `cdp.py` | Calls panel actions over the Chrome DevTools Protocol when `devtools.flag` is installed. |
| `preflight.py` | The checks before testing the template pack: Python, ffmpeg, fuscript, External scripting = Local, the open project and the Templates folder. Changes nothing. |
| `test_pack.py` | Tests every template of the pack inside Resolve, in a scratch project, and renders thumbnails. Writes `build/pack-test/report.md`. |

See [docs/BUILDING.md](../../docs/BUILDING.md) for how they fit together.
