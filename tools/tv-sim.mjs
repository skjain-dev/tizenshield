// TV simulator: opens the module in a Brave window laid out like the Frame (1920x1080 CSS pixels, Tizen 6.5
// user agent), injected exactly the way TizenBrew does. It re-reads dist/ on every page load, so
// `node build.mjs` + Cmd+R shows a change at once. It can't reproduce the TV's own engine or TizenBrew's timing.
//
//   node tools/tv-sim.mjs [--slow] [url]
//
// Remote: arrows · Enter = OK · Esc = Return · Ctrl+R red · Ctrl+G green · Ctrl+Y yellow · PgUp/PgDn = CH ▲/▼
// --slow throttles the CPU 6x, roughly a TV. Tiles you add persist in .sim-profile/.
import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './tizenbrew.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const slow = process.argv.includes('--slow');
const url = process.argv.slice(2).find((a) => !a.startsWith('--')) || pkg.websiteURL;
const TV_UA = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) 85.0.4183.93/6.5 TV Safari/537.36';

// Colour buttons arrive as their real Tizen key codes, ahead of the module's own key handler.
const REMOTE = `(function () {
  if (window.__tvSim) return;
  window.__tvSim = true;
  var MAP = { r: 403, g: 404, y: 405 };
  window.addEventListener('keydown', function (e) {
    var code = e.isTrusted && e.ctrlKey && MAP[(e.key || '').toLowerCase()];
    if (!code) return;
    e.preventDefault(); e.stopImmediatePropagation();
    window.dispatchEvent(new KeyboardEvent('keydown', { keyCode: code, bubbles: true }));
  }, true);
})();`;

const profile = join(root, '.sim-profile');
mkdirSync(profile, { recursive: true });
const { send, browser } = await launch({
  profile,
  dist: join(root, 'dist'),
  args: ['--window-size=1300,800', `--user-agent=${TV_UA}`],
  scripts: () => [REMOTE, readFileSync(join(root, 'dist/userScript.js'), 'utf8')]
});
// Lay pages out at the TV's 1920x1080 and scale the picture down to fit the window.
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, scale: 0.65 });
if (slow) await send('Emulation.setCPUThrottlingRate', { rate: 6 });
await send('Page.navigate', { url });
console.log(`TV simulator open on ${url}${slow ? ' (CPU 6x slower)' : ''}. Close the window to quit.`);
console.log('Remote: arrows · Enter=OK · Esc=Return · Ctrl+R red · Ctrl+G green · Ctrl+Y yellow · PgUp/PgDn=CH');
browser.once('exit', () => process.exit(0));
if (process.env.SIM_SHOT) { // a quick look for whoever launched it headlessly from a script
  setTimeout(async () => {
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    (await import('node:fs')).writeFileSync(process.env.SIM_SHOT, Buffer.from(data, 'base64'));
    console.log('screenshot -> ' + process.env.SIM_SHOT);
  }, 6000);
}
