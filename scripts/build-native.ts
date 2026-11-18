// Build HermiteCut's Rust pieces for the app and copy them to core/native/:
//   hc-node.<platform>-<arch>.node        the engine, a Node-API addon (crates/hc-node)
//   hermitecut-mcp-<platform>-<arch>[.exe] the Claude Desktop bridge (crates/hc-mcp)
// On macOS both are ad-hoc signed.
//
//   bun run native                      debug build for this machine
//   bun run native:release              release build
//   bun scripts/build-native.ts --release --target x86_64-apple-darwin
//                                       cross-build (here: Intel Mac on Apple Silicon)
import { $ } from 'bun';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
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
const cargoArgs = ['build', '-p', 'hc-node', '-p', 'hc-mcp', ...(release ? ['--release'] : []), ...(target ? ['--target', target] : [])];
await $`cargo ${cargoArgs}`.cwd(root);

const lib = platform === 'win32' ? 'hc_node.dll' : platform === 'darwin' ? 'libhc_node.dylib' : 'libhc_node.so';
const exe = platform === 'win32' ? '.exe' : '';
const builtDir = join(root, 'target', ...(target ? [target] : []), release ? 'release' : 'debug');
const outDir = join(root, 'core', 'native');
mkdirSync(outDir, { recursive: true });
const outputs = [
    [join(builtDir, lib), join(outDir, `hc-node.${platform}-${arch}.node`)],
    [join(builtDir, `hermitecut-mcp${exe}`), join(outDir, `hermitecut-mcp-${platform}-${arch}${exe}`)],
] as const;
for (const [from, to] of outputs) {
    copyFileSync(from, to);
    chmodSync(to, 0o755);
    if (process.platform === 'darwin') await $`codesign --force --sign - ${to}`.quiet();
    console.log(`Built ${to}`);
}
