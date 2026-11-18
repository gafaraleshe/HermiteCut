// HermiteCut: the window.hermite API that core/ui expects (Electron's
// preload.js provides the same), answered by the Rust back end over Tauri IPC.
(function () {
    if (window.hermite) return;
    const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args || {});
    window.hermite = {
        call: (name, args) => invoke('hc_call', { name, args: args || {} }),
        readFile: async (filePath, maxBytes) => {
            const size = await invoke('hc_stat', { path: filePath });
            if (maxBytes && size > maxBytes) {
                return { ok: false, error: 'File is too large to analyse (' + Math.round(size / 1048576) + ' MB).', size };
            }
            const buf = await invoke('hc_read_file', { path: filePath });
            return { ok: true, data: new Uint8Array(buf), size };
        },
        openFile: (opts) => invoke('hc_open_file', { opts: opts || {} }),
        saveFile: (opts) => invoke('hc_save_file', { opts: opts || {} }),
        chooseFolder: (opts) => invoke('hc_choose_folder', { opts: opts || {} }),
        win: (cmd, val) => invoke('hc_window', { cmd, val: val === undefined ? null : val })
    };
    // Electron drags the frameless window through CSS (-webkit-app-region);
    // here a press on the title bar, away from its controls, starts the drag.
    window.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || !e.target.closest) return;
        if (!e.target.closest('.titlebar, [data-drag]')) return;
        if (e.target.closest('button, input, select, textarea, a, .sets, [data-no-drag]')) return;
        invoke('hc_drag').catch(() => 0);
    });
})();
