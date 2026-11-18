#!/usr/bin/env python3
"""Render the HermiteCut panel in headless Chrome with a fake Resolve bridge and
save screenshots of each tool set to docs/images/.

    pip install playwright && playwright install chromium
    python tools/dev/screenshot.py            # main, motion, audio, all
    python tools/dev/screenshot.py motion     # one set
"""
import asyncio, os, re, shutil, sys, tempfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
PLUGIN = ROOT / 'plugin'
OUT = ROOT / 'docs' / 'images'
SETS = sys.argv[1:] or ['main', 'motion', 'audio', 'all']


def stage(tmp: Path) -> Path:
    site = tmp / 'site'
    shutil.copytree(PLUGIN, site)
    shutil.copy(Path(__file__).with_name('mock.js'), site / 'mock.js')
    html = (site / 'index.html').read_text(encoding='utf-8')
    html = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>', '', html)
    html = html.replace('<script src="js/math.js"></script>', '<script src="mock.js"></script>\n<script src="js/math.js"></script>')
    (site / 'index.html').write_text(html, encoding='utf-8')
    return site / 'index.html'


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        page_path = stage(Path(tmp))
        async with async_playwright() as p:
            chrome = shutil.which('google-chrome') or shutil.which('chromium')
            browser = await p.chromium.launch(executable_path=chrome, args=['--allow-file-access-from-files']) if chrome \
                else await p.chromium.launch(args=['--allow-file-access-from-files'])
            page = await browser.new_page(viewport={'width': 1120, 'height': 720}, device_scale_factor=1)
            errors = []
            page.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
            page.on('pageerror', lambda e: errors.append(f'page error: {e}'))
            await page.goto(page_path.as_uri())
            await page.wait_for_timeout(900)
            for s in SETS:
                await page.click(f'#sets button[data-set="{s}"]')
                await page.wait_for_timeout(500)
                await page.screenshot(path=str(OUT / f'{s}.png'))
                print('saved', OUT / f'{s}.png')
            await browser.close()
    print('\n'.join(errors) or 'no console errors')


if __name__ == '__main__':
    asyncio.run(main())
