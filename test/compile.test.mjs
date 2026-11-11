import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, inject, TOKEN } from '../lib/compile.mjs';

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

test('inject replaces exactly one token', () => {
  assert.equal(inject(`var F = ${TOKEN};`, { g: '$&' }), 'var F = {"g":"$&"};');
  assert.throws(() => inject('no token', {}));
  assert.throws(() => inject(TOKEN + TOKEN, {}));
});
