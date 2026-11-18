// HermiteCut — Resolve host adapter.
//
// Every host (Resolve now; Premiere Pro and Final Cut Pro later, see
// docs/MULTI_HOST_PLAN.md) exports the same shape:
//   { id, name, connect(), api }
// `api` maps action names to async functions; the shared UI calls them by
// name. Resolve can be reached two ways:
//   - plugin mode: Resolve Studio loads HermiteCut as a Workflow Integration
//     plugin and provides WorkflowIntegration.node next to main.js;
//   - standalone mode: the HermiteCut app talks to Resolve over fuscript
//     (bridge.lua), which needs External scripting set to Local.
'use strict';

const fs = require('fs');
const path = require('path');
const adapter = require('./adapter.js');
const { FuscriptBridge } = require('./bridge-fuscript.js');

const PLUGIN_ID = 'com.hermitelabs.cut';

function create(ctx) {
    // ctx: { appDir, resourcesDir, log, app }
    let mode = null;
    let WI = null;
    let resolveObj = null;
    let bridge = null;

    const nodePath = path.join(ctx.appDir, 'WorkflowIntegration.node');
    if (fs.existsSync(nodePath)) {
        try { WI = require(nodePath); mode = 'plugin'; } catch (e) { ctx.log('WorkflowIntegration.node: ' + e.message); }
    }
    if (!mode) mode = 'standalone';

    async function getResolve() {
        if (resolveObj) return resolveObj;
        if (mode === 'plugin') {
            const ok = await WI.Initialize(PLUGIN_ID);
            if (!ok) throw new Error('Could not connect to DaVinci Resolve (Initialize failed).');
            resolveObj = await WI.GetResolve();
        } else {
            bridge = bridge || new FuscriptBridge({ script: path.join(__dirname, 'bridge.lua') });
            resolveObj = await bridge.start();
        }
        if (!resolveObj) throw new Error('Could not get the Resolve object.');
        return resolveObj;
    }

    function reset() { resolveObj = null; if (bridge) { bridge.stop(); bridge = null; } }

    adapter.init({ getResolve, log: ctx.log, app: ctx.app, resourcesDir: ctx.resourcesDir, mode: () => mode });
    return {
        id: 'resolve',
        name: 'DaVinci Resolve',
        mode: () => mode,
        reset,
        cleanup() { try { if (WI) WI.CleanUp(); } catch (e) { /* */ } reset(); },
        api: adapter.api
    };
}

module.exports = { create, PLUGIN_ID };
