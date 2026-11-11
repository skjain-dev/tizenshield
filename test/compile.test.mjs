import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, inject, pack, hash, TOKENS } from '../lib/compile.mjs';

const lines = (s) => (s ? s.split('\n') : []);
const c = (...ls) => compile([ls.join('\n')]);

test('generic hide, deduped and sorted; generic exception removes it', () => {
  const d = c('##.b', '##.a', '##.b', '##.gone', '#@#.gone');
  assert.deepEqual(lines(d.g), ['.a', '.b']);
});

test('domain hide fans out per host; domain exception stored', () => {
  const d = c('a.com,B.com##.x', 'a.com#@#.y');
  assert.deepEqual(d.s, { 'a.com': '.x', 'b.com': '.x' });
  assert.deepEqual(d.x, { 'a.com': '.y' });
});

test('unsupported cosmetic forms are skipped', () => {
  const d = c('a.com##+js(set, x, 1)', '##div:has-text(ad)', '~a.com##.neg', 'a.com,~b.com##.neg2',
    'google.*##.entity', '##div:not(.a .b)', '##div:has(> .ad)', 'a.com#?#.proc', 'a.com#$#.x{color:red}',
    'a.com##^script', '##> .child', '##.ok:not(.simple)');
  assert.deepEqual(lines(d.g), ['.ok:not(.simple)']);
  assert.deepEqual(d.s, {});
});

test('network: any-party vs third-party, n wins over t', () => {
  const d = c('||Ads.example^', '||track.example^$third-party', '||both.example^$3p', '||both.example^$script');
  assert.deepEqual(lines(d.n), ['ads.example', 'both.example']);
  assert.deepEqual(lines(d.t), ['track.example']);
});

test('exceptions, important beats exception, badfilter removes', () => {
  const d = c('@@||cdn.example^', '@@||imp.example^$script', '||imp.example^$important', '||bad.example^',
    '||bad.example^$badfilter');
  assert.deepEqual(lines(d.e), ['cdn.example']);
  assert.deepEqual(lines(d.n), ['imp.example']);
});

test('network rules with paths, wildcards or unknown options are skipped', () => {
  const d = c('||a.example/ads/*', '||b.example^$domain=x.com', '||c.example^$redirect=noop.js', '/banner/',
    '||d.example^$~third-party', '||e*.example^', '|https://f.example^');
  assert.equal(d.n, '');
  assert.equal(d.t, '');
});

test('comments, headers and preprocessor lines are ignored, content between kept', () => {
  const d = c('[Adblock Plus 2.0]', '! Title: x', '!#if env_mobile', '##.inside', '!#endif');
  assert.deepEqual(lines(d.g), ['.inside']);
});

test('generic selectors without a class or id in the last part are dropped; site-specific ones kept', () => {
  const d = c('##div[id^="ad"]', '##a[href*="track"]', '##.box > div', '##div.ad', 'a.com##div[id^="ad"]');
  assert.deepEqual(lines(d.g), ['div.ad']);
  assert.deepEqual(d.s, { 'a.com': 'div[id^="ad"]' });
});

test('pack puts every host in the bucket its hash selects', () => {
  const d = c('||ads.example^', '||t.example^$3p', '@@||ok.example^', 'a.com##.x', 'a.com##.y', 'a.com#@#.z');
  const p = pack(d, 8);
  const bucket = (h) => p.h[hash(h) & 7];
  assert.ok(bucket('ads.example').includes('\nnads.example\n'));
  assert.ok(bucket('t.example').includes('\ntt.example\n'));
  assert.ok(bucket('ok.example').includes('\neok.example\n'));
  assert.ok(bucket('a.com').includes('\nsa.com\t.x\u001f.y\n'));
  assert.ok(bucket('a.com').includes('\nxa.com\t.z\n'));
  assert.equal(p.h.length, 8);
});

test('inject fills both tokens exactly once and ships the same hash function', () => {
  const runtime = `var F = ${TOKENS.filters}; var hash = ${TOKENS.hash};`;
  const out = inject(runtime, c('||ads.example^'));
  const fn = new Function(out + '; return [F, hash];');
  const [F, h] = fn();
  assert.equal(h('ads.example'), hash('ads.example'));
  assert.ok(F.h[h('ads.example') & (F.h.length - 1)].includes('\nnads.example\n'));
  assert.throws(() => inject('no tokens', {}));
  assert.throws(() => inject(runtime + TOKENS.hash, c()));
});
