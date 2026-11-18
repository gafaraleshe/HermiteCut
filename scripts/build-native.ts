// Build HermiteCut's Rust engine (crates/hc-node) as a Node-API addon and
// copy it to core/native/hc-node.<platform>-<arch>.node, where
// core/native/index.ts finds it.
//
//   bun run native                      debug build for this machine
//   bun run native:release              release build
//   bun scripts/build-native.ts --release --target x86_64-apple-darwin
//                                       cross-build (here: Intel Mac on Apple Silicon)
import { $ } from 'bun';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const args = process.argv.slice(2);
const release = args.includes('--release');
const ti = args.indexOf('--target');
const target = ti >= 0 ? args[ti + 1] : undefined;

/** Node's platform and arch names for a Rust target triple. */
export function nodeNames(triple?: string): { platform: string; arch: string } {
    if (!triple) return { platform: process.platform, arch: process.arch };
    const arch = triple.startsWith('aarch64') ? 'arm64' : triple.startsWith('x86_64') ? 'x64' : triple.split('-')[0] ?? 'unknown';
    const platform = triple.includes('apple-darwin') ? 'darwin' : triple.includes('windows') ? 'win32' : 'linux';
    return { platform, arch };
}

const { platform, arch } = nodeNames(target);
const cargoArgs = ['build', '-p', 'hc-node', ...(release ? ['--release'] : []), ...(target ? ['--target', target] : [])];
await $`cargo ${cargoArgs}`.cwd(root);

const lib = platform === 'win32' ? 'hc_node.dll' : platform === 'darwin' ? 'libhc_node.dylib' : 'libhc_node.so';
const built = join(root, 'target', ...(target ? [target] : []), release ? 'release' : 'debug', lib);
const outDir = join(root, 'core', 'native');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `hc-node.${platform}-${arch}.node`);
copyFileSync(built, out);
console.log(`Built ${out}`);
