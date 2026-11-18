// Tests for the Rust engine through its TypeScript loader. Run `bun run native`
// first to build the addon for this machine, then `bun test`.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addonName, loadNative, type LibraryItem } from './index.ts';

const native = loadNative([import.meta.dir]);
const repo = join(import.meta.dir, '..', '..');

/** A stored (uncompressed) zip, so the test needs no zip tool. */
function writeZip(path: string, files: Record<string, string>): void {
    const crcTable = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc32 = (b: Buffer) => {
        let c = 0xffffffff;
        for (const x of b) c = (crcTable[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const locals: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, text] of Object.entries(files)) {
        const data = Buffer.from(text);
        const n = Buffer.from(name);
        const head = Buffer.alloc(30);
        head.writeUInt32LE(0x04034b50, 0);
        head.writeUInt16LE(20, 4);
        head.writeUInt16LE(0x800, 6);
        head.writeUInt32LE(crc32(data), 14);
        head.writeUInt32LE(data.length, 18);
        head.writeUInt32LE(data.length, 22);
        head.writeUInt16LE(n.length, 26);
        const cd = Buffer.alloc(46);
        cd.writeUInt32LE(0x02014b50, 0);
        cd.writeUInt16LE(20, 4);
        cd.writeUInt16LE(20, 6);
        cd.writeUInt16LE(0x800, 8);
        cd.writeUInt32LE(crc32(data), 16);
        cd.writeUInt32LE(data.length, 20);
        cd.writeUInt32LE(data.length, 24);
        cd.writeUInt16LE(n.length, 28);
        cd.writeUInt32LE(offset, 42);
        locals.push(head, n, data);
        central.push(cd, n);
        offset += head.length + n.length + data.length;
    }
    const cdBuf = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(cdBuf.length, 12);
    end.writeUInt32LE(offset, 16);
    writeFileSync(path, Buffer.concat([...locals, cdBuf, end]));
}

describe('hc-node', () => {
    test('loads, with the workspace version', () => {
        const cargo = readFileSync(join(repo, 'Cargo.toml'), 'utf8');
        expect(cargo).toContain(`version = "${native.version()}"`);
    });

    test('knows where Resolve keeps things', () => {
        const f = native.resolveFolders();
        expect(f.plugins.endsWith('Workflow Integration Plugins')).toBe(true);
        expect(f.pluginDir.endsWith('com.hermitelabs.cut')).toBe(true);
        expect(f.nodeCandidates.length).toBe(3);
        expect(f.templates).toContain('Templates');
    });

    test('reads the catalogue', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hc-cat-'));
        mkdirSync(join(dir, 'sfx'));
        writeFileSync(join(dir, 'HermiteCut-manifest.json'), JSON.stringify({ version: '2.0.0', templates: [{ name: 'Flash' }] }));
        writeFileSync(join(dir, 'sfx', 'sfx.json'), JSON.stringify({ sounds: [{ name: 'Whoosh' }] }));
        const c = native.catalogue(dir);
        expect(c.version).toBe('2.0.0');
        expect(c.templates).toEqual([{ name: 'Flash' }]);
        expect(c.sounds).toEqual([{ name: 'Whoosh' }]);
        expect(native.catalogue(join(dir, 'missing')).templates).toEqual([]);
        rmSync(dir, { recursive: true });
        const built = join(repo, 'build', 'resources');
        if (existsSync(join(built, 'HermiteCut-manifest.json'))) {
            expect(native.catalogue(built).templates.length).toBeGreaterThanOrEqual(90);
        }
    });

    test('indexes folders and zips by reference, and extracts on use', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'hc-lib-'));
        mkdirSync(join(dir, 'Overlays'));
        writeFileSync(join(dir, 'Overlays', 'dust.mov'), 'mov');
        writeFileSync(join(dir, 'notes.txt'), 'not an asset');
        writeZip(join(dir, 'Pack.zip'), { 'LUTs/Teal.cube': 'LUT_3D_SIZE 2', 'Hits/Boom.wav': 'RIFF' });
        const ix = await native.libraryIndex([dir]);
        expect(ix.items.length).toBe(3);
        expect(ix.counts).toEqual({ audio: 1, lut: 1, video: 1 });
        expect(ix.truncated).toBe(false);
        expect(Number.isNaN(Date.parse(ix.indexedAt))).toBe(false);
        const lut = ix.items.find((i) => i.type === 'lut') as LibraryItem;
        expect(lut.entry).toBe('LUTs/Teal.cube');
        expect(lut.folder).toBe('Pack.zip › LUTs');
        const cache = join(dir, 'cache');
        const file = native.libraryMaterialise(lut, cache);
        expect(readFileSync(file, 'utf8')).toBe('LUT_3D_SIZE 2');
        const mov = ix.items.find((i) => i.type === 'video') as LibraryItem;
        expect(native.libraryMaterialise(mov, cache)).toBe(mov.path as string);
        native.libraryClearCache(cache);
        expect(existsSync(cache)).toBe(false);
        expect((await native.libraryIndex([dir], { maxFiles: 1 })).truncated).toBe(true);
        rmSync(dir, { recursive: true });
    });

    test('Setup reports what is installed and refuses unknown items', async () => {
        const res = mkdtempSync(join(tmpdir(), 'hc-res-'));
        const s = native.setupInstalled(res);
        for (const k of ['templates', 'launcher', 'plugin', 'fonts'] as const) expect(typeof s[k]).toBe('boolean');
        expect(s.paths.plugins).toContain('Workflow Integration Plugins');
        await expect(native.setupInstall(res, 'nonsense' as never)).rejects.toThrow('Unknown Setup item');
        rmSync(res, { recursive: true });
    });

    test('a missing build gives a clear error', () => {
        expect(() => loadNative([tmpdir()])).toThrow(addonName());
    });
});
