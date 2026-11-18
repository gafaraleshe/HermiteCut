#!/usr/bin/env python3
"""Drive the HermiteCut panel over the Chrome DevTools Protocol (development only).

1. Create an empty file named devtools.flag next to the installed plugin's
   main.js (scripts/dev-install.bat prints the folder) and restart Resolve.
2. Open the panel (Workspace > Workflow Integrations > HermiteCut).
3. Run:
       pip install websocket-client
       python tools/dev/cdp.py status
       python tools/dev/cdp.py quick '{"id": "marker", "arg": "Blue"}'
       python tools/dev/cdp.py --eval "document.title"

Every action in plugin/lib/actions.js can be called this way, exactly as the
UI calls it (window.hermite.call), which makes end-to-end tests scriptable.
"""
import json
import sys
import urllib.request

import websocket  # pip install websocket-client

PORT = 9339


def panel():
    with urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json') as r:
        targets = json.load(r)
    for t in targets:
        if t.get('type') == 'page' and t.get('url', '').endswith('index.html'):
            return t
    raise SystemExit('Panel not found. Is devtools.flag in place and the panel open?')


class CDP:
    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=120)
        self.seq = 0

    def send(self, method, **params):
        self.seq += 1
        self.ws.send(json.dumps({'id': self.seq, 'method': method, 'params': params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == self.seq:
                if 'error' in msg:
                    raise RuntimeError(msg['error'])
                return msg.get('result', {})

    def eval(self, expression):
        r = self.send('Runtime.evaluate', expression=expression, awaitPromise=True, returnByValue=True)
        if 'exceptionDetails' in r:
            raise RuntimeError(r['exceptionDetails'])
        return r['result'].get('value')

    def call(self, action, args=None):
        """Run a main-process action the same way the UI does."""
        return self.eval(f'window.hermite.call({json.dumps(action)}, {json.dumps(args or {})})')


if __name__ == '__main__':
    c = CDP(panel()['webSocketDebuggerUrl'])
    if len(sys.argv) > 2 and sys.argv[1] == '--eval':
        print(json.dumps(c.eval(sys.argv[2]), indent=2))
    else:
        name = sys.argv[1] if len(sys.argv) > 1 else 'status'
        args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
        print(json.dumps(c.call(name, args), indent=2))
