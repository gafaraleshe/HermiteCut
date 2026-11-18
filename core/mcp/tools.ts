// The tools HermiteCut offers Claude over MCP. Each one runs an existing app
// action (hosts/resolve), so Claude does exactly what the buttons do, on the
// clips selected in Resolve.
import { readFileSync } from 'node:fs';

export type Json = Record<string, unknown>;
/** Runs one app action by name, as the UI does. */
export type Call = (action: string, args?: Json) => Promise<unknown>;

export interface Tool {
    name: string;
    title: string;
    description: string;
    inputSchema: Json;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
    run(args: Json, call: Call): Promise<unknown>;
}

const obj = (properties: Json = {}, required: string[] = []): Json => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description: string, extra: Json = {}): Json => ({ type: 'string', description, ...extra });
const num = (description: string, extra: Json = {}): Json => ({ type: 'number', description, ...extra });

interface Template { id: string; kind: string; name: string; family: string; blurb?: string; controls?: unknown; defaults?: unknown; fields?: unknown }
interface Sound { name: string; category: string; file: string; seconds: number }
interface Catalogue { templates: Template[]; sounds: Sound[]; sfxDir: string }

async function catalogue(call: Call): Promise<Catalogue> {
    const c = (await call('catalogue')) as Partial<Catalogue>;
    return { templates: c.templates ?? [], sounds: c.sounds ?? [], sfxDir: c.sfxDir ?? '' };
}

function matches(text: string, q?: unknown): boolean {
    return typeof q !== 'string' || !q.trim() || text.toLowerCase().includes(q.trim().toLowerCase());
}

/** Find a template by id or (case-insensitive) name, optionally of one kind. */
async function findTemplate(call: Call, idOrName: string, kind?: string): Promise<Template> {
    const { templates } = await catalogue(call);
    const want = idOrName.trim().toLowerCase();
    const pool = templates.filter((t) => !kind || t.kind === kind);
    const t = pool.find((x) => x.id.toLowerCase() === want) ?? pool.find((x) => x.name.toLowerCase() === want);
    if (!t) throw new Error(`No ${kind ?? 'template'} called "${idOrName}". Use list_templates to see the names.`);
    return t;
}

/** The one-click actions, read from the Actions module so the list never drifts. */
export function quickActions(quickJs: string): { id: string; names: string[] }[] {
    const byId = new Map<string, string[]>();
    for (const m of quickJs.matchAll(/\['([a-zA-Z]+)',\s*'[^']*',\s*'([^']+)',\s*'[a-z]+'/g)) {
        const [, id, name] = m;
        if (!id || !name) continue;
        byId.set(id, [...(byId.get(id) ?? []), name]);
    }
    return [...byId].map(([id, names]) => ({ id, names }));
}

export function buildTools(opts: { quickJsPath?: string; actionNames: string[] }): Tool[] {
    let quick: { id: string; names: string[] }[] = [];
    try {
        if (opts.quickJsPath) quick = quickActions(readFileSync(opts.quickJsPath, 'utf8'));
    } catch {
        /* the generic tool still covers them */
    }
    const quickList = quick.map((q) => `${q.id} (${q.names.slice(0, 3).join(', ')}${q.names.length > 3 ? ', …' : ''})`).join('; ');

    return [
        {
            name: 'resolve_status',
            title: 'Resolve status',
            description:
                'What is open in DaVinci Resolve: the page, project, timeline, frame rate, resolution, playhead timecode and how many clips are selected. Call this first.',
            inputSchema: obj(),
            annotations: { readOnlyHint: true },
            run: (_a, call) => call('status'),
        },
        {
            name: 'list_templates',
            title: 'List templates',
            description:
                "HermiteCut's effects, transitions and titles (including Grid Reveal and the Time FX), with each one's family, description, controls and defaults. Filter by kind, family or a search word.",
            inputSchema: obj({
                kind: str('Only this kind.', { enum: ['effect', 'transition', 'title'] }),
                family: str('Only this family, e.g. "Flashes", "Grid Reveal", "Time FX".'),
                search: str('Words to look for in the name, family or description.'),
            }),
            annotations: { readOnlyHint: true },
            run: async (a, call) => {
                const { templates } = await catalogue(call);
                return templates
                    .filter((t) => !a.kind || t.kind === a.kind)
                    .filter((t) => matches(t.family, a.family))
                    .filter((t) => matches(`${t.name} ${t.family} ${t.blurb ?? ''}`, a.search))
                    .map((t) => ({ id: t.id, name: t.name, kind: t.kind, family: t.family, blurb: t.blurb, controls: t.controls, defaults: t.defaults, fields: t.fields }));
            },
        },
        {
            name: 'apply_effect',
            title: 'Apply an effect',
            description:
                'Add a HermiteCut effect to every selected video clip on the Edit page timeline. Optional values set its controls, e.g. {"Apply at": 0, "Frames": 12, "Strength": 1}.',
            inputSchema: obj({ template: str('The effect name or id, from list_templates.'), values: { type: 'object', description: 'Control values by name.' } }, ['template']),
            run: async (a, call) => {
                const t = await findTemplate(call, String(a.template), 'effect');
                return call('applyEffect', { id: t.id, values: (a.values as Json) ?? {} });
            },
        },
        {
            name: 'add_transition',
            title: 'Add a transition',
            description: 'Add a HermiteCut transition (including the Grid Reveal looks) at the cuts of the selected clips.',
            inputSchema: obj(
                {
                    template: str('The transition name or id, from list_templates.'),
                    frames: num('Length in frames (default 20).', { minimum: 1 }),
                },
                ['template'],
            ),
            run: async (a, call) => {
                const t = await findTemplate(call, String(a.template), 'transition');
                return call('addTransition', { id: t.id, name: t.name, frames: a.frames });
            },
        },
        {
            name: 'insert_title',
            title: 'Insert a title',
            description:
                'Insert a HermiteCut title at the playhead (or a given frame). values fills its text fields, e.g. {"ArtistText": "Name", "SongText": "Song"}; list_templates shows each title\'s fields.',
            inputSchema: obj(
                {
                    template: str('The title name or id, from list_templates.'),
                    values: { type: 'object', description: 'Text fields and controls by name.' },
                    frames: num('Length in frames.', { minimum: 1 }),
                    startFrame: num('Timeline frame to start at. Defaults to the playhead.'),
                },
                ['template'],
            ),
            run: async (a, call) => {
                const t = await findTemplate(call, String(a.template), 'title');
                return call('insertTitle', { id: t.id, name: t.name, values: (a.values as Json) ?? {}, frames: a.frames, startFrame: a.startFrame });
            },
        },
        {
            name: 'remove_effects',
            title: 'Remove HermiteCut effects',
            description: 'Remove the HermiteCut effects from the selected clips. Other effects are left alone.',
            inputSchema: obj(),
            annotations: { destructiveHint: true },
            run: (_a, call) => call('removeEffects'),
        },
        {
            name: 'list_sounds',
            title: 'List sounds',
            description: "HermiteCut's sound effects (whooshes, risers, impacts, glitches and more), with category and length.",
            inputSchema: obj({ category: str('Only this category.'), search: str('Words to look for in the name.') }),
            annotations: { readOnlyHint: true },
            run: async (a, call) => {
                const { sounds } = await catalogue(call);
                return sounds
                    .filter((s) => matches(s.category, a.category))
                    .filter((s) => matches(s.name, a.search))
                    .map((s) => ({ name: s.name, category: s.category, seconds: s.seconds }));
            },
        },
        {
            name: 'place_sound',
            title: 'Place a sound',
            description: 'Put a HermiteCut sound on a free audio track: at the playhead, on every cut, or on every marker.',
            inputSchema: obj(
                {
                    sound: str('The sound name, from list_sounds.'),
                    where: str('Where to place it.', { enum: ['playhead', 'cuts', 'markers'] }),
                    offset: num('Shift in frames (negative = earlier), e.g. to land a whoosh before the cut.'),
                },
                ['sound'],
            ),
            run: async (a, call) => {
                const { sounds, sfxDir } = await catalogue(call);
                const want = String(a.sound).toLowerCase();
                const s = sounds.find((x) => x.name.toLowerCase() === want);
                if (!s) throw new Error(`No sound called "${a.sound}". Use list_sounds to see the names.`);
                const sep = sfxDir.includes('\\') ? '\\' : '/';
                return call('placeAudio', { file: sfxDir + sep + s.file.split('/').join(sep), where: a.where ?? 'playhead', offset: a.offset });
            },
        },
        {
            name: 'run_action',
            title: 'Run a one-click action',
            description:
                'Run one of the Actions module\'s one-click edits on the selection: speed, fades, dissolves, ripple delete, close gaps, remove silence, markers, colours, stabilise and more. ' +
                (quickList ? `Action ids: ${quickList}.` : '') +
                ' arg is the value the button uses, e.g. 50 for speed 50%.',
            inputSchema: obj({ id: str('The action id.'), arg: { description: 'The action\'s value, if it takes one.' } }, ['id']),
            run: (a, call) => call('quick', { id: a.id, arg: a.arg }),
        },
        {
            name: 'open_page',
            title: 'Open a Resolve page',
            description: 'Switch DaVinci Resolve to a page.',
            inputSchema: obj({ page: str('The page.', { enum: ['media', 'cut', 'edit', 'fusion', 'color', 'fairlight', 'deliver'] }) }, ['page']),
            run: (a, call) => call('openPage', { page: a.page }),
        },
        {
            name: 'make_short',
            title: 'Make a 9:16 short',
            description: 'Duplicate the current timeline as a 9:16 vertical version for Shorts, Reels and TikTok, optionally with Smart Reframe (Resolve Studio).',
            inputSchema: obj({ reframe: { type: 'boolean', description: 'Run Smart Reframe on the clips.' } }),
            run: (a, call) => call('shortsDuplicate', { reframe: a.reframe ?? true }),
        },
        {
            name: 'hermitecut_action',
            title: 'Any HermiteCut action',
            description:
                'Run any HermiteCut action by name with its arguments, exactly as the app\'s buttons do. Use the specific tools above when they fit. Actions: ' +
                opts.actionNames.join(', ') +
                '.',
            inputSchema: obj({ action: str('The action name.', { enum: opts.actionNames }), args: { type: 'object', description: 'The action\'s arguments.' } }, ['action']),
            run: (a, call) => call(String(a.action), (a.args as Json) ?? {}),
        },
    ];
}
