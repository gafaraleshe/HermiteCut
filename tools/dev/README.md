# Development tools

| File | Use |
|---|---|
| `screenshot.py` | Renders the panel in headless Chrome with `mock.js` standing in for Resolve. Saves `docs/images/*.png` and reports console errors. |
| `mock.js` | Fake `window.hermite` bridge, used only by `screenshot.py`. |
| `make_test_clips.sh` | Makes `CLIP_A/B/C.mp4` (1080p25, 6 s, moving box, frame counter, tone) in `build/testmedia/`. |
| `frametools.py` | Runs inside Resolve's Python. Grabs the frame under the playhead and measures it, using only the standard library. |
| `cdp.py` | Calls panel actions over the Chrome DevTools Protocol when `devtools.flag` is installed. |

See [docs/BUILDING.md](../../docs/BUILDING.md) for how they fit together.
