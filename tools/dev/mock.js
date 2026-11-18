// Fake bridge used by screenshot.py to render the panel in a normal browser,
// without DaVinci Resolve. Every action resolves with placeholder data.
window.hermite = {
  call: async (name) => {
    if (name === 'status') {
      return { ok: true, result: { connected: true, project: 'Demo Project', timeline: 'Main Edit', fps: 25, width: 1920, height: 1080, page: 'edit', tc: '01:00:12:04', selected: 2 } };
    }
    if (name === 'catalogue') return { ok: true, result: window.HC_MOCK_CATALOGUE || { templates: [], sounds: [] } };
    if (name === 'setupStatus') return { ok: true, result: { mode: 'standalone', resolve: '21.2.0', scripting: true, templates: true, launcher: false, plugin: true, fonts: false } };
    if (name === 'libraryIndex') return { ok: true, result: { items: [], counts: {} } };
    if (name === 'renderPresets') return { ok: true, result: ['YouTube 1080p', 'H.264 Master', 'ProRes 422 HQ'] };
    return { ok: true, result: { msg: 'mock ' + name, done: 1 } };
  },
  readFile: async () => ({ ok: false, error: 'mock' }),
  openFile: async () => null,
  saveFile: async () => null,
  chooseFolder: async () => null,
  win: async (_cmd, value) => value
};
