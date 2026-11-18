// The swap from JavaScript to Rust must not change what the UI sees: the
// asset library gives the same items and counts either way, and a missing
// addon falls back cleanly.
import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engine, engineInfo, resetEngine } from './engine.ts';

// the JavaScript implementation the Rust one replaces
const ASSETS = require('./assets.js') as {
    index(folders: string[]): { items: { name: string; type: string; folder: string; size: number }[]; counts: Record<string, number> };
};

afterEach(() => resetEngine());

test('a missing addon falls back to JavaScript', () => {
    expect(engine([tmpdir()])).toBeNull();
    const info = engineInfo();
    expect(info.engine).toBe('js');
    expect(info.reason).toContain('hc-node.');
});

test('the Rust asset library matches the JavaScript one', async () => {
    const rust = engine([join(import.meta.dir, '..', 'native')]);
    expect(rust).not.toBeNull();
    const dir = mkdtempSync(join(tmpdir(), 'hc-parity-'));
    mkdirSync(join(dir, 'Overlays', 'Dust'), { recursive: true });
    mkdirSync(join(dir, '.hidden'));
    writeFileSync(join(dir, 'Overlays', 'Dust', 'dust.mov'), 'mov');
    writeFileSync(join(dir, 'Overlays', 'flare.PNG'), 'png');
    writeFileSync(join(dir, 'Teal.cube'), 'LUT');
    writeFileSync(join(dir, 'Hit.wav'), 'RIFF');
    writeFileSync(join(dir, 'Pack.drfx'), 'drfx');
    writeFileSync(join(dir, 'readme.txt'), 'no');
    writeFileSync(join(dir, '.hidden', 'secret.wav'), 'no');
    const js = ASSETS.index([dir]);
    const rs = await rust!.libraryIndex([dir]);
    const key = (i: { name: string; type: string; folder: string; size: number }) => `${i.type}|${i.name}|${i.folder}|${i.size}`;
    expect(rs.items.map(key).sort()).toEqual(js.items.map(key).sort());
    expect(rs.counts).toEqual(js.counts);
    expect(engineInfo().engine).toBe('rust');
    rmSync(dir, { recursive: true });
});
