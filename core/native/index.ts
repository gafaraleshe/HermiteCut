// HermiteCut's Rust engine (crates/hc-node), typed for TypeScript.
//
// The addon is a Node-API module, so the same file loads in the HermiteCut
// app's Electron and in Resolve's Electron (the panel). One build per
// platform: hc-node.<platform>-<arch>.node (scripts/build-native.ts).
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ResolveFolders {
    templates: string;
    scripts: string;
    plugins: string;
    fonts: string;
    pluginDir: string;
    nodeCandidates: string[];
    fuscriptCandidates: string[];
    /** fuscript, if Resolve is installed (or HERMITECUT_FUSCRIPT is set). */
    fuscript?: string | null;
    /** Resolve Studio's WorkflowIntegration.node, if Studio is installed. */
    nodeAddon?: string | null;
}

export interface Catalogue {
    templates: unknown[];
    version: string | null;
    sounds: unknown[];
    sfxDir: string;
}

export type LibraryType = 'lut' | 'video' | 'image' | 'audio' | 'drfx' | 'drt' | 'setting';

export interface LibraryItem {
    id: string;
    name: string;
    type: LibraryType;
    root: string;
    /** A file on disk... */
    path?: string;
    /** ...or a file inside a zip. */
    zip?: string;
    entry?: string;
    folder: string;
    size: number;
}

export interface LibraryIndex {
    items: LibraryItem[];
    counts: Partial<Record<LibraryType, number>>;
    errors: string[];
    truncated: boolean;
    indexedAt: string;
}

export interface SetupInstalled {
    templates: boolean;
    launcher: boolean;
    plugin: boolean;
    fonts: boolean;
    paths: Record<'templates' | 'scripts' | 'plugins' | 'sample' | 'fonts', string | null>;
}

export type SetupItem = 'templates' | 'launcher' | 'fonts' | 'plugin';

/** The addon's raw exports (see crates/hc-node/src/lib.rs). */
interface Raw {
    version(): string;
    resolveFolders(): ResolveFolders;
    catalogue(resources: string): Catalogue;
    libraryIndexJson(folders: string[], maxFiles?: number | null, maxDepth?: number | null): Promise<string>;
    libraryMaterialise(item: LibraryItem, cacheDir: string): string;
    libraryClearCache(cacheDir: string): void;
    setupInstalled(resources: string): SetupInstalled;
    setupInstallJson(resources: string, what: SetupItem): Promise<string>;
}

export interface Native {
    /** The engine's version. */
    version(): string;
    /** Resolve's folders on this machine. */
    resolveFolders(): ResolveFolders;
    /** Templates and sounds from the app's resources folder. */
    catalogue(resources: string): Catalogue;
    /** Index folders (and zips) by reference, off the main thread. */
    libraryIndex(folders: string[], opts?: { maxFiles?: number; maxDepth?: number }): Promise<LibraryIndex>;
    /** A real file for an item: the file itself, or its extracted copy in cacheDir. */
    libraryMaterialise(item: LibraryItem, cacheDir: string): string;
    libraryClearCache(cacheDir: string): void;
    /** What Setup has installed. */
    setupInstalled(resources: string): SetupInstalled;
    /** Install one Setup item. 'plugin' asks for administrator rights. */
    setupInstall(resources: string, what: SetupItem): Promise<{ msg: string }>;
}

/** The addon's file name for a platform. */
export function addonName(platform: string = process.platform, arch: string = process.arch): string {
    return `hc-node.${platform}-${arch}.node`;
}

function wrap(raw: Raw): Native {
    return {
        version: () => raw.version(),
        resolveFolders: () => raw.resolveFolders(),
        catalogue: (resources) => raw.catalogue(resources),
        libraryIndex: async (folders, opts = {}) =>
            JSON.parse(await raw.libraryIndexJson(folders, opts.maxFiles ?? null, opts.maxDepth ?? null)) as LibraryIndex,
        libraryMaterialise: (item, cacheDir) => raw.libraryMaterialise(item, cacheDir),
        libraryClearCache: (cacheDir) => raw.libraryClearCache(cacheDir),
        setupInstalled: (resources) => raw.setupInstalled(resources),
        setupInstall: async (resources, what) => JSON.parse(await raw.setupInstallJson(resources, what)) as { msg: string },
    };
}

/**
 * Load the addon from the first folder that has this platform's build.
 * Throws a clear error, naming the file and the folders tried, if none does.
 */
export function loadNative(dirs: string[]): Native {
    const name = addonName();
    for (const dir of dirs) {
        const file = join(dir, name);
        if (existsSync(file)) return wrap(require(file) as Raw);
    }
    throw new Error(`HermiteCut's engine (${name}) is missing. Looked in: ${dirs.join(', ')}`);
}
