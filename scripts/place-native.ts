// Copy the Rust addon builds (core/native/hc-node.*.node, from
// scripts/build-native.ts) into the assembled app and panel, so they ship
// with the Rust engine. Run after scripts/assemble.py.
//
//   bun scripts/place-native.ts
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const panel = join('plugin', 'com.hermitelabs.cut');
// Each assembled app or panel that exists. core/native may be missing even
// when the rest is there: it's empty until now, and CI artifacts drop empty
// folders.
const targets = [
    join(root, 'build', 'app'), // the app
    join(root, 'build', 'app', 'resources', panel), // the panel the app's Setup installs
    join(root, 'build', 'resources', panel),
    join(root, 'build', panel), // the panel-only zip
]
    .filter((d) => existsSync(join(d, 'core')))
    .map((d) => join(d, 'core', 'native'));

const src = join(root, 'core', 'native');
const addons = readdirSync(src).filter((f) => /^hc-node\..+\.node$/.test(f));
if (!addons.length) throw new Error('No addon builds in core/native. Run bun scripts/build-native.ts --release first.');
let n = 0;
for (const dir of targets) {
    mkdirSync(dir, { recursive: true });
    for (const f of addons) {
        copyFileSync(join(src, f), join(dir, f));
        n++;
    }
}
if (!n) throw new Error('Nothing assembled to copy into. Run python scripts/assemble.py first.');
console.log(`Placed ${addons.join(', ')} in ${n / addons.length} folder(s)`);
