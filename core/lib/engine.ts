// HermiteCut's engine for the JavaScript side: the Rust addon when this build
// ships it (core/native/hc-node.<platform>-<arch>.node), otherwise null, and
// callers fall back to the JavaScript implementations in core/lib.
//
// The fallback matters inside Resolve on macOS: Resolve may refuse to load a
// native module that isn't signed, and the panel must still work.
//
// scripts/assemble.py compiles this file (with core/native/index.ts) to
// core/lib/engine.js for Electron.
import { join } from 'node:path';
import { loadNative, type Native } from '../native/index.ts';

let cached: Native | null | undefined;
let reason = '';

/** The Rust engine, or null if it isn't available. Loaded once. */
export function engine(dirs: string[] = [join(__dirname, '..', 'native')]): Native | null {
    if (cached !== undefined) return cached;
    try {
        cached = loadNative(dirs);
    } catch (e) {
        cached = null;
        reason = e instanceof Error ? e.message : String(e);
    }
    return cached;
}

/** Which engine is running, for logs and Setup: `rust 2.0.0`, or `js` and why. */
export function engineInfo(): { engine: 'rust' | 'js'; version: string | null; reason: string } {
    const e = engine();
    return e ? { engine: 'rust', version: e.version(), reason: '' } : { engine: 'js', version: null, reason };
}

/** Forget the loaded engine (tests). */
export function resetEngine(): void {
    cached = undefined;
    reason = '';
}
