// HermiteCut — asset library (host-independent).
//
// Indexes the user's own folders BY REFERENCE: nothing is copied. Zip files
// are read from their central directory only; a file inside a zip is
// extracted to a cache the first time it is used. Supported types:
//   lut (.cube .3dl), video overlay, image, audio, drfx, drt, setting.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const TYPES = {
    lut: ['.cube', '.3dl'],
    video: ['.mp4', '.mov', '.m4v', '.webm', '.mxf', '.avi', '.mkv'],
    image: ['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.exr', '.dpx', '.webp'],
    audio: ['.wav', '.mp3', '.aif', '.aiff', '.flac', '.m4a', '.ogg'],
    drfx: ['.drfx'],
    drt: ['.drt'],
    setting: ['.setting']
};
const EXT = {};
for (const [k, list] of Object.entries(TYPES)) for (const e of list) EXT[e] = k;

function typeOf(name) { return EXT[path.extname(name).toLowerCase()] || null; }

// ---------------------------------------------------------------- zip reading
function readCentralDirectory(zipPath) {
    const fd = fs.openSync(zipPath, 'r');
    try {
        const size = fs.fstatSync(fd).size;
        const tailLen = Math.min(size, 65557);
        const tail = Buffer.alloc(tailLen);
        fs.readSync(fd, tail, 0, tailLen, size - tailLen);
        let eocd = -1;
        for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
        if (eocd < 0) throw new Error('not a zip file');
        const count = tail.readUInt16LE(eocd + 10);
        const cdSize = tail.readUInt32LE(eocd + 12);
        const cdOffset = tail.readUInt32LE(eocd + 16);
        if (cdOffset === 0xffffffff || count === 0xffff) throw new Error('zip64 archives are not supported yet');
        const cd = Buffer.alloc(cdSize);
        fs.readSync(fd, cd, 0, cdSize, cdOffset);
        const entries = [];
        let p = 0;
        for (let n = 0; n < count && p + 46 <= cd.length; n++) {
            if (cd.readUInt32LE(p) !== 0x02014b50) break;
            const flags = cd.readUInt16LE(p + 8);
            const method = cd.readUInt16LE(p + 10);
            const csize = cd.readUInt32LE(p + 20);
            const usize = cd.readUInt32LE(p + 24);
            const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32);
            const local = cd.readUInt32LE(p + 42);
            const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nlen);
            entries.push({ name, method, csize, usize, local });
            p += 46 + nlen + xlen + clen;
        }
        return entries;
    } finally { fs.closeSync(fd); }
}

function readZipEntry(zipPath, entry) {
    const fd = fs.openSync(zipPath, 'r');
    try {
        const head = Buffer.alloc(30);
        fs.readSync(fd, head, 0, 30, entry.local);
        if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('bad zip entry');
        const start = entry.local + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
        const data = Buffer.alloc(entry.csize);
        fs.readSync(fd, data, 0, entry.csize, start);
        if (entry.method === 0) return data;
        if (entry.method === 8) return zlib.inflateRawSync(data);
        throw new Error('unsupported zip compression (method ' + entry.method + ')');
    } finally { fs.closeSync(fd); }
}

// ---------------------------------------------------------------- indexing
function index(folders, opts) {
    opts = Object.assign({ maxFiles: 50000, maxDepth: 12 }, opts || {});
    const items = [];
    const errors = [];
    const seen = new Set();
    function add(it) { if (items.length < opts.maxFiles) items.push(it); }
    function walk(dir, depth, root) {
        if (depth > opts.maxDepth || items.length >= opts.maxFiles) return;
        let list;
        try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { errors.push(dir + ': ' + e.message); return; }
        for (const d of list) {
            if (d.name.startsWith('.') || d.name === '__MACOSX') continue;
            const full = path.join(dir, d.name);
            if (d.isDirectory()) { walk(full, depth + 1, root); continue; }
            const lower = d.name.toLowerCase();
            if (lower.endsWith('.zip')) {
                try {
                    for (const e of readCentralDirectory(full)) {
                        if (e.name.endsWith('/') || e.name.includes('__MACOSX')) continue;
                        const type = typeOf(e.name);
                        if (type) add({ id: full + '::' + e.name, name: path.basename(e.name), type, root, zip: full,
                            entry: e.name, folder: path.relative(root, full) + ' › ' + path.dirname(e.name), size: e.usize });
                    }
                } catch (err) { errors.push(full + ': ' + err.message); }
                continue;
            }
            const type = typeOf(d.name);
            if (!type || seen.has(full)) continue;
            seen.add(full);
            let size = 0;
            try { size = fs.statSync(full).size; } catch (e) { /* */ }
            add({ id: full, name: d.name, type, root, path: full, folder: path.relative(root, dir) || '.', size });
        }
    }
    for (const f of folders) walk(f, 0, f);
    const counts = {};
    for (const it of items) counts[it.type] = (counts[it.type] || 0) + 1;
    return { items, counts, errors, truncated: items.length >= opts.maxFiles, indexedAt: new Date().toISOString() };
}

// A real file path for an item: the file itself, or a cached extraction.
function materialise(item, cacheDir) {
    if (!item.zip) return item.path;
    const key = crypto.createHash('sha1').update(item.id).digest('hex').slice(0, 16);
    const dir = path.join(cacheDir, key);
    const out = path.join(dir, path.basename(item.entry));
    if (fs.existsSync(out)) return out;
    const entry = readCentralDirectory(item.zip).find(e => e.name === item.entry);
    if (!entry) throw new Error('That file is no longer inside ' + path.basename(item.zip) + '.');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(out, readZipEntry(item.zip, entry));
    return out;
}

function clearCache(cacheDir) {
    if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true, force: true });
}

module.exports = { TYPES, typeOf, index, materialise, clearCache, readCentralDirectory, readZipEntry };
