// Runs a page the way TizenBrew does: a Chromium (Brave) under the DevTools protocol, with the module script
// evaluated in every new execution context. Shared by test/e2e.mjs and tools/tv-sim.mjs.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

// scripts: () => string[] — read on every new context, so a rebuild shows up on the next page load.
// dist: folder that stands in for GitHub when the runtime downloads its filter file.
export async function launch({ browserPath = BRAVE, profile, args = [], scripts, dist }) {
  const browser = spawn(browserPath, ['--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    ...args, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((res, rej) => {
    let buf = '';
    browser.stderr.on('data', (d) => { buf += d; const m = buf.match(/ws:\/\/\S+/); if (m) res(m[0]); });
    setTimeout(() => rej(new Error('browser did not start')), 20000);
  });
  const port = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));

  let id = 0;
  const pending = new Map();
  const dialogs = [];
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id;
    pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
    }
    if (msg.method === 'Runtime.executionContextCreated') {
      for (const expression of scripts()) send('Runtime.evaluate', { expression, contextId: msg.params.context.id }).catch(() => {});
    }
    if (msg.method === 'Fetch.requestPaused') {
      const file = join(dist, msg.params.request.url.split('/').pop());
      const body = existsSync(file) ? readFileSync(file).toString('base64') : '';
      send('Fetch.fulfillRequest', { requestId: msg.params.requestId, responseCode: body ? 200 : 404, body,
        responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'text/plain' }] }).catch(() => {});
    }
    // An open dialog would freeze every later evaluate, so record and dismiss it.
    if (msg.method === 'Page.javascriptDialogOpening') {
      dialogs.push(msg.params.message);
      send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
  });

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*raw.githubusercontent.com/*' }] });

  const close = async () => {
    const exited = new Promise((r) => browser.once('exit', r));
    ws.close();
    browser.kill();
    await exited;
  };
  return { send, dialogs, browser, close };
}
