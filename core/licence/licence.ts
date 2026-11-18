// HermiteCut's licence: a Polar licence key (polar.sh), checked through
// Polar's public licence-key API (no secret is needed in the app).
//
// - Activating uses one of the key's activations (two per key) for this
//   computer. The app and the Resolve panel share it: it is kept in
//   ~/.hermitecut/licence.json.
// - Once activated, HermiteCut works offline. It checks back with Polar every
//   7 days when it can, and keeps working for 30 days without a successful
//   check, so a trip without internet never locks anyone out.
// - With no Polar organisation configured at build time, licensing is off and
//   HermiteCut works without a key.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join } from 'node:path';

export interface LicenceConfig {
    /** Polar organisation ID. Empty turns licensing off. */
    organizationId: string;
    /** https://api.polar.sh (or https://sandbox-api.polar.sh for testing). */
    apiBase: string;
    /** Where to buy (the Polar checkout link). */
    checkoutUrl: string;
    /** Where buyers find their key and downloads (the Polar customer portal). */
    portalUrl: string;
    /** The price label, e.g. "£30". */
    price: string;
    file?: string;
    revalidateDays?: number;
    graceDays?: number;
    label?: string;
    fetch?: typeof fetch;
    now?: () => number;
}

interface Saved {
    key: string;
    displayKey: string;
    activationId: string;
    activatedAt: string;
    lastValidatedAt: string;
}

export interface LicenceStatus {
    /** Licensing is on for this build. */
    required: boolean;
    /** HermiteCut may be used. */
    valid: boolean;
    /** Why not, or a note (e.g. working offline). */
    reason: string;
    displayKey: string | null;
    checkoutUrl: string;
    portalUrl: string;
    price: string;
}

const DAY = 86_400_000;

export function defaultLicenceFile(): string {
    return join(homedir(), '.hermitecut', 'licence.json');
}

class HttpError extends Error {
    constructor(public status: number, public detail: string) {
        super(detail);
    }
}

export function createLicence(cfg: LicenceConfig) {
    const file = cfg.file ?? defaultLicenceFile();
    const now = cfg.now ?? Date.now;
    const http = cfg.fetch ?? fetch;
    const revalidate = (cfg.revalidateDays ?? 7) * DAY;
    const grace = (cfg.graceDays ?? 30) * DAY;
    const label = cfg.label ?? `${hostname()} (HermiteCut)`;
    const required = Boolean(cfg.organizationId);
    let inflight: Promise<LicenceStatus> | null = null;

    const base = (valid: boolean, reason: string, displayKey: string | null = null): LicenceStatus => ({
        required, valid, reason, displayKey, checkoutUrl: cfg.checkoutUrl, portalUrl: cfg.portalUrl, price: cfg.price,
    });

    function load(): Saved | null {
        try {
            const s = JSON.parse(readFileSync(file, 'utf8')) as Saved;
            return s.key && s.activationId ? s : null;
        } catch {
            return null;
        }
    }
    function save(s: Saved) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(s, null, 2), { mode: 0o600 });
    }
    function forget() {
        rmSync(file, { force: true });
    }

    async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
        const r = await http(`${cfg.apiBase.replace(/\/$/, '')}/v1/customer-portal/license-keys/${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ organization_id: cfg.organizationId, ...body }),
        });
        const text = await r.text();
        if (!r.ok) {
            let detail = text;
            try {
                const j = JSON.parse(text) as { detail?: unknown };
                detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail ?? j);
            } catch {
                /* plain text */
            }
            throw new HttpError(r.status, detail);
        }
        return text ? JSON.parse(text) : null;
    }

    async function check(): Promise<LicenceStatus> {
        if (!required) return base(true, 'Licensing is off in this build.');
        const s = load();
        if (!s) return base(false, 'Enter your licence key to start using HermiteCut.');
        const age = now() - Date.parse(s.lastValidatedAt);
        if (age < revalidate) return base(true, '', s.displayKey);
        try {
            const k = (await post('validate', { key: s.key, activation_id: s.activationId })) as { status?: string; display_key?: string };
            if (k?.status !== 'granted') {
                forget();
                return base(false, 'This licence key is no longer active. Contact support if you think this is a mistake.');
            }
            save({ ...s, displayKey: k.display_key ?? s.displayKey, lastValidatedAt: new Date(now()).toISOString() });
            return base(true, '', k.display_key ?? s.displayKey);
        } catch (e) {
            if (e instanceof HttpError && (e.status === 404 || e.status === 403 || e.status === 422)) {
                forget();
                return base(false, 'This computer is no longer activated for that key. Enter it again to reactivate.');
            }
            if (age < grace) return base(true, 'Working offline: HermiteCut will check your licence when you are back online.', s.displayKey);
            return base(false, 'HermiteCut could not check your licence for 30 days. Connect to the internet and try again.', s.displayKey);
        }
    }

    return {
        required,
        /** The licence status. Checks with Polar at most once a week. */
        status(): Promise<LicenceStatus> {
            if (!inflight) inflight = check().finally(() => { inflight = null; });
            return inflight;
        },
        /** Activate this computer with a key. */
        async activate(rawKey: string): Promise<LicenceStatus> {
            if (!required) return base(true, 'Licensing is off in this build.');
            const key = String(rawKey ?? '').trim();
            if (!key) throw new Error('Paste your licence key first.');
            try {
                const a = (await post('activate', { key, label, meta: { app: 'HermiteCut' } })) as {
                    id: string;
                    license_key?: { status?: string; display_key?: string };
                };
                if (a?.license_key?.status && a.license_key.status !== 'granted') throw new Error('This licence key is not active.');
                const at = new Date(now()).toISOString();
                const displayKey = a.license_key?.display_key ?? `****-${key.slice(-4)}`;
                save({ key, displayKey, activationId: a.id, activatedAt: at, lastValidatedAt: at });
                return base(true, 'HermiteCut is activated on this computer.', displayKey);
            } catch (e) {
                if (e instanceof HttpError) {
                    if (e.status === 404) throw new Error("That licence key wasn't found. Check it and try again.");
                    if (e.status === 403) throw new Error('This key is already active on two computers. Deactivate it on one of them (Setup → Licence), then try again.');
                    if (e.status === 422) throw new Error("That doesn't look like a HermiteCut licence key.");
                    throw new Error(`The licence server said: ${e.detail}`);
                }
                if (e instanceof Error && /not active|Paste your/.test(e.message)) throw e;
                throw new Error("Couldn't reach the licence server. Check your internet connection and try again.");
            }
        },
        /** Free this computer's activation, so the key can be used on another. */
        async deactivate(): Promise<LicenceStatus> {
            const s = load();
            if (s && required) {
                try {
                    await post('deactivate', { key: s.key, activation_id: s.activationId });
                } catch (e) {
                    if (!(e instanceof HttpError && e.status === 404)) {
                        throw new Error("Couldn't reach the licence server, so this computer is still activated. Try again when you're online.");
                    }
                }
            }
            forget();
            return base(!required, required ? 'This computer is deactivated.' : 'Licensing is off in this build.');
        },
    };
}

export type Licence = ReturnType<typeof createLicence>;

/** The licence for this build, configured at build time (scripts/assemble.py passes --define). */
export function buildLicence(overrides: Partial<LicenceConfig> = {}): Licence {
    return createLicence({
        organizationId: process.env.HC_POLAR_ORGANIZATION_ID ?? '',
        apiBase: process.env.HC_POLAR_API ?? 'https://api.polar.sh',
        checkoutUrl: process.env.HC_POLAR_CHECKOUT_URL ?? 'https://cut.hermitelabs.com/#purchase',
        portalUrl: process.env.HC_POLAR_PORTAL_URL ?? 'https://cut.hermitelabs.com/#purchase',
        price: process.env.HC_PRICE ?? '£30',
        ...overrides,
    });
}

/**
 * Wrap the app's actions so they need a valid licence. A few stay open: the
 * licence actions themselves, and what the UI needs to show the licence screen.
 */
export const OPEN_ACTIONS = new Set(['hostInfo', 'engineInfo', 'licenceStatus', 'licenceActivate', 'licenceDeactivate', 'setupStatus', 'mcpInfo', 'status']);

export function gateActions(api: Record<string, (args: Record<string, unknown>) => Promise<unknown>>, licence: Licence): void {
    for (const [name, fn] of Object.entries(api)) {
        if (OPEN_ACTIONS.has(name) || typeof fn !== 'function') continue;
        api[name] = async (args) => {
            const s = await licence.status();
            if (!s.valid) throw new Error(`HermiteCut needs a licence. ${s.reason} Buy it for ${s.price} at ${s.checkoutUrl}`);
            return fn(args);
        };
    }
    api.licenceStatus = () => licence.status();
    api.licenceActivate = (a) => licence.activate(String(a?.key ?? ''));
    api.licenceDeactivate = () => licence.deactivate();
}
