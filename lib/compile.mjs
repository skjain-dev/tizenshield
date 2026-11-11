// Compiles Adblock Plus / uBlock Origin filter lists into the compact data src/runtime.js consumes.
// Deliberately conservative: anything the TV's Chromium 85 page script can't apply faithfully is skipped.

const SKIP_COSMETIC_SEPARATORS = ['#?#', '#@?#', '#$#', '#@$#', '#%#', '#@%#', '$$', '$@$'];
const UNSUPPORTED_SELECTOR = [':has(', ':has-text(', ':is(', ':where(', ':-abp-', ':matches-css', ':matches-attr',
  ':matches-path', ':matches-prop', ':xpath(', ':upward(', ':remove(', ':style(', ':min-text-length(', ':watch-attr(',
  ':others(', ':contains(', ':if(', ':if-not(', ':nth-ancestor(', ':shadow', '{', '}', '\n', '\t', '\u001f'];
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
  // A generic selector whose last part has no class or id lands in Chromium's catch-all bucket and is checked
  // against every element on every style pass, which is what makes pages crawl on a TV CPU.
  for (const sel of out.g) if (!/[.#][\w-]/.test(sel.split(/[\s>+~]+/).pop())) out.g.delete(sel);
  for (const h of out.bad) { out.n.delete(h); out.t.delete(h); }
  for (const h of out.n) out.t.delete(h);
  for (const h of out.important) out.e.delete(h);

  const join = (set) => [...set].sort().join('\n');
  const obj = (map) => Object.fromEntries([...map.keys()].sort().map((k) => [k, join(map.get(k))]));
  return { g: join(out.g), s: obj(out.s), x: obj(out.x), n: join(out.n), t: join(out.t), e: join(out.e) };
}

// FNV-1a. Its source is copied into the runtime at build time, so page and build can't hash differently.
export function hash(s) {
  var h = 0x811c9dc5;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// Per-host data goes into hash buckets of plain strings, so a page parses no object graph and builds no Set:
// a lookup is one indexOf inside a ~1 KB bucket. Lines: "\n" + kind + host + ("\t" + selectors joined by \x1f)?
// kinds: n block, t block third-party, e allow, s site hide, x site un-hide.
export function pack(data, buckets = 4096) {
  const b = Array.from({ length: buckets }, () => []);
  const put = (host, line) => b[hash(host) & (buckets - 1)].push(line);
  for (const k of ['n', 't', 'e']) for (const h of data[k] ? data[k].split('\n') : []) put(h, k + h);
  for (const k of ['s', 'x']) for (const [h, sels] of Object.entries(data[k])) put(h, k + h + '\t' + sels.split('\n').join('\u001f'));
  return { g: data.g, h: b.map((lines) => (lines.length ? '\n' + lines.join('\n') + '\n' : '')) };
}

// The data file the page downloads: generic selectors, then each hash bucket, separated by \x1d. Splitting a
// string is all the page has to do with it; no JSON object graph to build.
export function packText(data, buckets = 4096) {
  const p = pack(data, buckets);
  return [p.g].concat(p.h).join('\u001d');
}

export const TOKENS = { filtersUrl: '/*__FILTERS_URL__*/null', hash: '/*__HASH__*/null' };

// TizenBrew pushes the injected script through the TV's debugger connection, which silently drops multi-MB
// scripts, so the runtime only gets the data's URL; the data itself ships as a separate file.
export function inject(runtime, filtersUrl) {
  const values = { filtersUrl: JSON.stringify(filtersUrl), hash: '(' + hash.toString() + ')' };
  for (const [name, token] of Object.entries(TOKENS)) {
    const parts = runtime.split(token);
    if (parts.length !== 2) throw new Error(`expected exactly one ${token} in runtime, found ${parts.length - 1}`);
    runtime = parts[0] + values[name] + parts[1];
  }
  return runtime;
}
