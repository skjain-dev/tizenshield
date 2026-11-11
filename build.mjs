// node build.mjs [list.txt ...]
// No args: Brave's installed component lists (newest version of each) + lists/*.txt -> dist/userScript.js
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, inject, packText } from './lib/compile.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const BRAVE = join(homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser');
// raw.githubusercontent serves a new commit within minutes, and the content-hashed name means a cached old
// script can never pick up a newer data file in a format it doesn't understand.
const DATA_BASE = process.env.DATA_BASE || 'https://raw.githubusercontent.com/skjain-dev/tizenshield/master/dist/';

const newer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

function braveLists() {
  if (!existsSync(BRAVE)) return [];
  return readdirSync(BRAVE, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[a-p]{32}$/.test(d.name)) // Chromium component ids
    .flatMap((d) => {
      const dir = join(BRAVE, d.name);
      const latest = readdirSync(dir).filter((v) => /^[\d.]+$/.test(v)).sort(newer).pop();
      const file = latest && join(dir, latest, 'list.txt');
      return file && existsSync(file) ? [file] : [];
    });
}

const files = process.argv.length > 2 ? process.argv.slice(2)
  : [...braveLists(), ...readdirSync(join(root, 'lists')).filter((f) => f.endsWith('.txt')).map((f) => join(root, 'lists', f))];
if (!files.length) { console.error('no filter lists found'); process.exit(1); }

const data = compile(files.map((f) => readFileSync(f, 'utf8')));
const text = packText(data);
const name = `filters-${createHash('sha256').update(text).digest('hex').slice(0, 10)}.txt`;
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
for (const f of readdirSync(dist)) if (/^filters-.*\.txt$/.test(f) && f !== name) unlinkSync(join(dist, f));
writeFileSync(join(dist, name), text);
const out = inject(readFileSync(join(root, 'src/runtime.js'), 'utf8'), DATA_BASE + name);
writeFileSync(join(dist, 'userScript.js'), out);

const count = (s) => (s ? s.split('\n').length : 0);
console.log(`${files.length} lists -> generic hide ${count(data.g)}, site hide ${Object.keys(data.s).length} hosts, ` +
  `site exceptions ${Object.keys(data.x).length} hosts, block ${count(data.n)}, block 3p ${count(data.t)}, ` +
  `allow ${count(data.e)} -> dist/userScript.js ${(out.length / 1024).toFixed(0)} KB + dist/${name} ${(text.length / 1024).toFixed(0)} KB`);
