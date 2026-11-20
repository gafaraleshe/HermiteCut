// HermiteCut — preload bridge (context isolated)
const { contextBridge, ipcRenderer } = require('electron/renderer');

contextBridge.exposeInMainWorld('hermite', {
    call: (name, args) => ipcRenderer.invoke('hc:call', name, args),
    readFile: (filePath, maxBytes) => ipcRenderer.invoke('hc:readFile', filePath, maxBytes),
    openFile: (opts) => ipcRenderer.invoke('hc:openFile', opts),
    saveFile: (opts) => ipcRenderer.invoke('hc:saveFile', opts),
    chooseFolder: (opts) => ipcRenderer.invoke('hc:chooseFolder', opts),
    win: (cmd, val) => ipcRenderer.invoke('hc:window', cmd, val),
    app: (cmd, val) => ipcRenderer.invoke('hc:app', cmd, val),
    // Menu commands from the main process (macOS menu bar).
    onCommand: (fn) => { ipcRenderer.on('hc:command', (_e, cmd) => fn(cmd)); }
});
