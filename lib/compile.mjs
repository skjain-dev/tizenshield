// Compiles Adblock Plus / uBlock Origin filter lists into the compact data src/runtime.js consumes.
// Deliberately conservative: anything the TV's Chromium 85 page script can't apply faithfully is skipped.

const SKIP_COSMETIC_SEPARATORS = ['#?#', '#@?#', '#$#', '#@$#', '#%#', '#@%#', '$$', '$@$'];
const UNSUPPORTED_SELECTOR = [':has(', ':has-text(', ':is(', ':where(', ':-abp-', ':matches-css', ':matches-attr',
  ':matches-path', ':matches-prop', ':xpath(', ':upward(', ':remove(', ':style(', ':min-text-length(', ':watch-attr(',
  ':others(', ':contains(', ':if(', ':if-not(', ':nth-ancestor(', ':shadow', '{', '}', '\n'];
const NETWORK_OPTIONS = new Set(['third-party', '3p', 'script', 'image', 'stylesheet', 'xmlhttprequest', 'xhr',
  'subdocument', 'frame', 'ping', 'beacon', 'media', 'object', 'font', 'websocket', 'other', 'important', 'all',
  'badfilter']);
const HOST = /^[a-z0-9.-]+$/;

function supportedSelector(sel) {
  if (!sel || /^[>+~]/.test(sel) || sel.startsWith('+js(') || sel.startsWith('^')) return false;
  if (UNSUPPORTED_SELECTOR.some((m) => sel.includes(m))) return false;
  // Chromium 85 only knows :not() with a simple selector inside.
  for (const m of sel.matchAll(/:not\(([^()]*)\)/g)) if (/[\s,>+~]/.test(m[1])) return false;
  return !/:not\([^)]*\(/.test(sel); // nested parens inside :not
}

function parseCosmetic(line, sep, out) {
  const at = line.indexOf(sep);
  const domains = line.slice(0, at);
  const sel = line.slice(at + sep.length).trim();
  if (!supportedSelector(sel)) return;
  const list = domains ? domains.split(',').map((d) => d.trim().toLowerCase()) : [];
  if (list.some((d) => !d || d.startsWith('~') || d.includes('*') || d.endsWith('.*') || d.includes('/'))) return;
  const exception = sep === '#@#';
  if (!list.length) (exception ? out.gx : out.g).add(sel);
  else for (const d of list) add(exception ? out.x : out.s, d, sel);
}

function add(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function parseNetwork(line, out) {
  const exception = line.startsWith('@@');
  const body = exception ? line.slice(2) : line;
  const m = body.match(/^\|\|([^\^$]+)\^(?:\$(.*))?$/);
  if (!m) return;
  const host = m[1].toLowerCase();
  if (!HOST.test(host)) return;
  const opts = m[2] ? m[2].split(',').map((o) => o.trim().toLowerCase()) : [];
  if (opts.some((o) => !NETWORK_OPTIONS.has(o))) return;
  if (opts.includes('badfilter')) { out.bad.add(host); return; }
  if (exception) { out.e.add(host); return; }
  (opts.includes('third-party') || opts.includes('3p') ? out.t : out.n).add(host);
  if (opts.includes('important')) out.important.add(host);
}

export function compile(texts) {
  const out = { g: new Set(), gx: new Set(), s: new Map(), x: new Map(), n: new Set(), t: new Set(), e: new Set(),
    bad: new Set(), important: new Set() };
  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('!') || line.startsWith('[')) continue;
      if (SKIP_COSMETIC_SEPARATORS.some((s) => line.includes(s))) continue;
      const sep = line.includes('#@#') ? '#@#' : line.includes('##') ? '##' : null;
      if (sep) parseCosmetic(line, sep, out);
      else parseNetwork(line, out);
    }
  }
  for (const sel of out.gx) out.g.delete(sel);
  for (const h of out.bad) { out.n.delete(h); out.t.delete(h); }
  for (const h of out.n) out.t.delete(h);
  for (const h of out.important) out.e.delete(h);

  const join = (set) => [...set].sort().join('\n');
  const obj = (map) => Object.fromEntries([...map.keys()].sort().map((k) => [k, join(map.get(k))]));
  return { g: join(out.g), s: obj(out.s), x: obj(out.x), n: join(out.n), t: join(out.t), e: join(out.e) };
}

export const TOKEN = '/*__FILTERS__*/null';

export function inject(runtime, data) {
  const parts = runtime.split(TOKEN);
  if (parts.length !== 2) throw new Error(`expected exactly one ${TOKEN} in runtime, found ${parts.length - 1}`);
  return parts[0] + JSON.stringify(data) + parts[1];
}
