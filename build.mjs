// node build.mjs [list.txt ...]
// No args: Brave's installed component lists (newest version of each) + lists/*.txt -> dist/userScript.js
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, inject } from './lib/compile.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const BRAVE = join(homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser');

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
const out = inject(readFileSync(join(root, 'src/runtime.js'), 'utf8'), data);
mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/userScript.js'), out);

const count = (s) => (s ? s.split('\n').length : 0);
console.log(`${files.length} lists -> generic hide ${count(data.g)}, site hide ${Object.keys(data.s).length} hosts, ` +
  `site exceptions ${Object.keys(data.x).length} hosts, block ${count(data.n)}, block 3p ${count(data.t)}, ` +
  `allow ${count(data.e)} -> dist/userScript.js ${(out.length / 1024).toFixed(0)} KB`);
