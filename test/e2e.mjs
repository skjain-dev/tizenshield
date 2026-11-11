// End-to-end check: inject dist/userScript.js the way TizenBrew does (CDP Runtime.evaluate on every new
// execution context) into a headless Chromium with a throwaway profile, then drive it with TV key codes.
// Usage: node test/e2e.mjs [path-to-chromium]   (defaults to the Brave install on macOS)
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, '../dist/userScript.js'), 'utf8');
const browserPath = process.argv[2] || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';

const PAGES = {
  '/': `<!doctype html><title>one</title><body style="margin:0;height:3000px">
    <div class="abovead" id="ad1" style="height:50px">ad</div>
    <a id="next" href="/two" target="_blank" style="position:absolute;left:900px;top:500px;width:200px;height:80px;display:block">next</a>
    <input id="q" style="position:absolute;left:100px;top:300px;width:300px;height:40px">
    <div id="out"></div></body>`,
  '/two': '<!doctype html><title>two</title><body><div class="abovead" id="ad2">ad</div>page two</body>'
};
const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(PAGES[req.url] || 'nf');
}).listen(0);
const origin = `http://127.0.0.1:${server.address().port}`;

const profile = mkdtempSync(join(tmpdir(), 'tizenshield-e2e-'));
const browser = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--window-size=1920,1080', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
    send('Runtime.evaluate', { expression: script, contextId: msg.params.context.id }).catch(() => {});
  }
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const key = async (keyCode, key = '') => {
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', {keyCode: ${keyCode}, key: ${JSON.stringify(key)}, bubbles: true}))`);
  await sleep(30);
};
const shot = async (name) => {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(here, `${name}.png`), Buffer.from(data, 'base64'));
};

const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(`ok   ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message}`); process.exitCode = 1; }
};

try {
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: origin + '/' });
  await sleep(1500);

  await check('script runs once per page, in the main world', async () => {
    assert.equal(await evalJs('typeof window.__tizenShieldTest'), 'object');
    assert.equal(await evalJs("document.querySelectorAll('tizen-shield-ui').length"), 1);
  });
  // Brave's own Shields also hide ads in the test browser, so assert on our adopted sheet, not just the result.
  await check('our cosmetic sheet is adopted and covers .abovead', async () => {
    const r = await evalJs(`(() => { const rules = [...document.adoptedStyleSheets].flatMap((s) => [...s.cssRules]);
      return { n: rules.length, hit: rules.some((r) => r.selectorText && r.selectorText.split(',').map((x) => x.trim()).includes('.abovead')) }; })()`);
    assert.ok(r.n > 500, `only ${r.n} rules`);
    assert.ok(r.hit, '.abovead not in sheet');
    assert.equal(await evalJs("getComputedStyle(document.getElementById('ad1')).display"), 'none');
  });
  await check('tracker fetch is rejected and counted', async () => {
    const r = await evalJs("fetch('https://www.google-analytics.com/collect').then(() => 'sent', (e) => e.message)");
    assert.equal(r, 'Failed to fetch');
    assert.ok((await evalJs('__tizenShieldTest.state().blocked')) >= 1);
  });
  await check('tracker script src is refused', async () => {
    const src = await evalJs("(() => { const s = document.createElement('script'); s.src = 'https://www.googletagmanager.com/gtag/js'; return s.getAttribute('src'); })()");
    assert.equal(src, null);
  });
  await check('first-party request is allowed', async () => {
    assert.equal(await evalJs(`__tizenShieldTest.isBlocked('${origin}/x')`), false);
  });
  await check('arrow keys move the pointer, holding accelerates', async () => {
    const a = await evalJs('__tizenShieldTest.state()');
    await key(39); await key(39); await key(39);
    const b = await evalJs('__tizenShieldTest.state()');
    assert.ok(b.cx - a.cx > 14 * 3, `moved ${b.cx - a.cx}`);
  });
  await check('red key opens the panel, Return closes it', async () => {
    await key(403, 'ColorF0Red');
    assert.equal((await evalJs('__tizenShieldTest.state()')).panelOpen, true);
    await shot('panel');
    await key(10009);
    assert.equal((await evalJs('__tizenShieldTest.state()')).panelOpen, false);
  });
  await check('Enter on an input focuses it (TV keyboard)', async () => {
    await moveTo(250, 320);
    await key(13);
    assert.equal(await evalJs('document.activeElement.id'), 'q');
    await key(10009); // blur, not navigate back
    assert.equal(await evalJs('document.activeElement.id'), '');
  });
  await check('Enter on a target=_blank link navigates in place and re-injects', async () => {
    await moveTo(1000, 540);
    await shot('pointer');
    await key(13);
    await sleep(1500);
    assert.equal(await evalJs('document.title'), 'two');
    assert.equal(await evalJs("getComputedStyle(document.getElementById('ad2')).display"), 'none');
  });
  await check('Return key goes back', async () => {
    await key(10009);
    await sleep(1500);
    assert.equal(await evalJs('document.title'), 'one');
  });
  await check('address bar: text searches, domains open', async () => {
    const u = (t) => evalJs(`__tizenShieldTest.toUrl(${JSON.stringify(t)})`);
    assert.equal(await u('wikipedia.org'), 'https://wikipedia.org');
    assert.equal(await u('news.ycombinator.com/item?id=1'), 'https://news.ycombinator.com/item?id=1');
    assert.equal(await u('http://192.168.1.5'), 'http://192.168.1.5');
    assert.equal(await u('best pizza near me'), 'https://search.brave.com/search?q=best%20pizza%20near%20me');
    assert.equal(await u('node.js'), 'https://node.js');
  });
  // Last: it re-runs the script in this page, which would double the key handlers for any later check.
  await check('injection cost per page (desktop; expect several times slower on a TV)', async () => {
    const ms = await evalJs(`(() => { document.adoptedStyleSheets = []; const t = performance.now();
      (0, eval)(${JSON.stringify(script)}); return Math.round(performance.now() - t); })()`);
    results.push(`     injection took ${ms} ms`);
    assert.ok(ms < 1000);
  });
} finally {
  console.log(results.join('\n'));
  ws.close();
  const exited = new Promise((r) => browser.once('exit', r));
  browser.kill();
  await exited;
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}

async function moveTo(x, y) {
  for (let i = 0; i < 200; i++) {
    const s = await evalJs('__tizenShieldTest.state()');
    const dx = x - s.cx, dy = y - s.cy;
    if (Math.abs(dx) < 15 && Math.abs(dy) < 15) return;
    await sleep(200); // let acceleration reset so steps stay small
    if (Math.abs(dx) >= 15) await key(dx > 0 ? 39 : 37); else await key(dy > 0 ? 40 : 38);
  }
  throw new Error('could not reach target');
}
