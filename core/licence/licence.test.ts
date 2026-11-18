// The licence against a stand-in for Polar's licence-key API: activation,
// the weekly check, revoked keys, working offline, deactivation, and the
// gate on the app's actions.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLicence, gateActions, type LicenceConfig } from './licence.ts';

const ORG = 'org_test';
const KEYS: Record<string, { status: string; limit: number; activations: Set<string> }> = {};
let seq = 0;
let up = true;

const server = Bun.serve({
    port: 0,
    async fetch(req) {
        if (!up) return new Response('down', { status: 503 });
        const url = new URL(req.url);
        const body = (await req.json()) as { key: string; organization_id: string; activation_id?: string };
        if (body.organization_id !== ORG) return Response.json({ detail: 'Not found' }, { status: 404 });
        const k = KEYS[body.key];
        if (!k) return Response.json({ detail: 'License key not found' }, { status: 404 });
        const display = `****-${body.key.slice(-4)}`;
        if (url.pathname.endsWith('/activate')) {
            if (k.activations.size >= k.limit) return Response.json({ detail: 'License key activation limit already reached' }, { status: 403 });
            const id = `act_${++seq}`;
            k.activations.add(id);
            return Response.json({ id, license_key: { status: k.status, display_key: display, limit_activations: k.limit } });
        }
        if (url.pathname.endsWith('/validate')) {
            if (body.activation_id && !k.activations.has(body.activation_id)) return Response.json({ detail: 'Activation not found' }, { status: 404 });
            return Response.json({ status: k.status, display_key: display });
        }
        if (url.pathname.endsWith('/deactivate')) {
            if (!body.activation_id || !k.activations.delete(body.activation_id)) return Response.json({ detail: 'Not found' }, { status: 404 });
            return new Response(null, { status: 204 });
        }
        return new Response('?', { status: 400 });
    },
});

let dir: string;
let clock = Date.parse('2026-11-18T12:00:00Z');
const cfg = (extra: Partial<LicenceConfig> = {}): LicenceConfig => ({
    organizationId: ORG,
    apiBase: `http://127.0.0.1:${server.port}`,
    checkoutUrl: 'https://buy.example/hermitecut',
    portalUrl: 'https://portal.example',
    price: '£30',
    file: join(dir, 'licence.json'),
    label: 'test-mac',
    now: () => clock,
    ...extra,
});

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'hc-licence-')); });
afterAll(() => { server.stop(true); rmSync(dir, { recursive: true }); });
beforeEach(() => {
    rmSync(join(dir, 'licence.json'), { force: true });
    for (const k of Object.keys(KEYS)) delete KEYS[k];
    KEYS['HC-GOOD-1234'] = { status: 'granted', limit: 2, activations: new Set() };
    KEYS['HC-GONE-9999'] = { status: 'revoked', limit: 2, activations: new Set() };
    up = true;
    clock = Date.parse('2026-11-18T12:00:00Z');
});

describe('licence', () => {
    test('with no Polar organisation, licensing is off', async () => {
        const l = createLicence(cfg({ organizationId: '' }));
        expect(l.required).toBe(false);
        expect((await l.status()).valid).toBe(true);
    });

    test('needs a key, activates, and remembers it', async () => {
        const l = createLicence(cfg());
        const before = await l.status();
        expect(before).toMatchObject({ required: true, valid: false, price: '£30', checkoutUrl: 'https://buy.example/hermitecut' });
        const after = await l.activate('  HC-GOOD-1234 ');
        expect(after).toMatchObject({ valid: true, displayKey: '****-1234' });
        expect(existsSync(join(dir, 'licence.json'))).toBe(true);
        // another instance (the Resolve panel) sees the same activation
        expect((await createLicence(cfg()).status()).valid).toBe(true);
    });

    test('explains unknown keys and the two-computer limit', async () => {
        const l = createLicence(cfg());
        await expect(l.activate('NOPE')).rejects.toThrow("wasn't found");
        await expect(l.activate('')).rejects.toThrow('Paste your licence key');
        await createLicence(cfg({ file: join(dir, 'a.json') })).activate('HC-GOOD-1234');
        await createLicence(cfg({ file: join(dir, 'b.json') })).activate('HC-GOOD-1234');
        await expect(l.activate('HC-GOOD-1234')).rejects.toThrow('two computers');
    });

    test('a revoked key does not activate', async () => {
        await expect(createLicence(cfg()).activate('HC-GONE-9999')).rejects.toThrow('not active');
    });

    test('checks with Polar after a week, not before', async () => {
        const l = createLicence(cfg());
        await l.activate('HC-GOOD-1234');
        up = false;
        clock += 6 * 86_400_000;
        expect((await l.status()).reason).toBe(''); // no network needed yet
        up = true;
        clock += 2 * 86_400_000;
        expect(await l.status()).toMatchObject({ valid: true, reason: '' });
    });

    test('a key revoked at Polar stops working at the next check', async () => {
        const l = createLicence(cfg());
        await l.activate('HC-GOOD-1234');
        KEYS['HC-GOOD-1234']!.status = 'revoked';
        clock += 8 * 86_400_000;
        expect((await l.status()).valid).toBe(false);
        expect(existsSync(join(dir, 'licence.json'))).toBe(false);
    });

    test('works offline for 30 days, then asks to go online', async () => {
        const l = createLicence(cfg());
        await l.activate('HC-GOOD-1234');
        up = false;
        clock += 20 * 86_400_000;
        const s = await l.status();
        expect(s.valid).toBe(true);
        expect(s.reason).toContain('offline');
        clock += 15 * 86_400_000;
        expect((await l.status()).valid).toBe(false);
        up = true;
        expect((await l.status()).valid).toBe(true); // back online: the check passes
    });

    test('deactivating frees the activation for another computer', async () => {
        const l = createLicence(cfg());
        await l.activate('HC-GOOD-1234');
        expect(KEYS['HC-GOOD-1234']!.activations.size).toBe(1);
        expect((await l.deactivate()).valid).toBe(false);
        expect(KEYS['HC-GOOD-1234']!.activations.size).toBe(0);
        expect(existsSync(join(dir, 'licence.json'))).toBe(false);
    });

    test('a computer deactivated elsewhere must activate again', async () => {
        const l = createLicence(cfg());
        await l.activate('HC-GOOD-1234');
        KEYS['HC-GOOD-1234']!.activations.clear();
        clock += 8 * 86_400_000;
        expect((await l.status()).valid).toBe(false);
    });
});

describe('the gate on actions', () => {
    test('actions need a licence; the licence screen still works', async () => {
        const l = createLicence(cfg());
        const api: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = {
            applyEffect: async () => 'applied',
            status: async () => ({ connected: true }),
        };
        gateActions(api, l);
        await expect(api.applyEffect!({})).rejects.toThrow('HermiteCut needs a licence');
        expect(await api.status!({})).toEqual({ connected: true });
        expect(((await api.licenceStatus!({})) as { valid: boolean }).valid).toBe(false);
        await api.licenceActivate!({ key: 'HC-GOOD-1234' });
        expect(await api.applyEffect!({})).toBe('applied');
        await api.licenceDeactivate!({});
        await expect(api.applyEffect!({})).rejects.toThrow('HermiteCut needs a licence');
    });

    test('with licensing off, nothing is gated', async () => {
        const api: Record<string, (a: Record<string, unknown>) => Promise<unknown>> = { applyEffect: async () => 'applied' };
        gateActions(api, createLicence(cfg({ organizationId: '' })));
        expect(await api.applyEffect!({})).toBe('applied');
    });
});
