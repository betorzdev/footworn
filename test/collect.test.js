import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHit, refHost, deviceOf, cleanProps, originAllowed, hostsOf, campaign } from '../src/collect.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const site = { id: 'hallownest', name: 'Hallownest Calculator', origins: 'https://betorzdev.github.io http://localhost:8787' };
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0) / 1000;

test('a pageview', () => {
  const { hit } = makeHit({ s: 'hallownest', p: '/hallownest-calculator/?x=1#view=map', r: 'https://www.reddit.com/r/HollowKnight/', w: 1440, l: 'es-ES' },
                          { site, ua: UA, country: 'ES', now: NOW });
  assert.equal(hit.day, '2026-10-01');
  assert.equal(hit.path, '/hallownest-calculator/');
  assert.equal(hit.event, null);
  assert.equal(hit.props, null);
  assert.equal(hit.ref, 'reddit.com');
  assert.equal(hit.browser, 'Chrome');
  assert.equal(hit.os, 'Windows');
  assert.equal(hit.device, 'desktop');
  assert.equal(hit.width, 1440);
  assert.equal(hit.country, 'ES');
  assert.equal(hit.lang, 'es');
});

test('an event with properties', () => {
  const { hit } = makeHit({ s: 'hallownest', p: '/', e: 'screen-combat', props: { view: 'combat', lang: 'en', n: 3, deep: { a: 1 }, long: 'x'.repeat(100) } },
                          { site, ua: UA, now: NOW });
  assert.equal(hit.event, 'screen-combat');
  assert.deepEqual(hit.props, { view: 'combat', lang: 'en', n: '3', long: 'x'.repeat(64) });
});

test('what is not counted', () => {
  assert.equal(makeHit(null, { site, ua: UA, now: NOW }).skip, 'body');
  assert.equal(makeHit({ p: '/' }, { site, ua: 'Googlebot/2.1', now: NOW }).skip, 'bot');
  assert.equal(makeHit({ p: 'nope' }, { site, ua: UA, now: NOW }).skip, 'path');
  assert.equal(makeHit({}, { site, ua: UA, now: NOW }).skip, 'path');
});

test('country only as ISO alpha-2', () => {
  assert.equal(makeHit({ p: '/' }, { site, ua: UA, country: 'Spain', now: NOW }).hit.country, null);
  assert.equal(makeHit({ p: '/' }, { site, ua: UA, country: undefined, now: NOW }).hit.country, null);
});

test('referrer host', () => {
  const own = hostsOf(site.origins);
  assert.deepEqual(own, ['betorzdev.github.io', 'localhost']);
  assert.equal(refHost('https://www.google.com/search?q=x', own), 'google.com');
  assert.equal(refHost('https://betorzdev.github.io/hallownest-calculator/', own), null);
  assert.equal(refHost('', own), null);
  assert.equal(refHost('garbage', own), null);
  assert.equal(refHost('https://' + 'a'.repeat(120) + '.com/', own), null);
});

test('width and language are kept only when they look like one', () => {
  const at = body => makeHit({ p: '/', ...body }, { site, ua: UA, now: NOW }).hit;
  assert.equal(at({ w: 1e9 }).width, null);
  assert.equal(at({ w: -5 }).width, null);
  assert.equal(at({ w: '1440' }).width, null);
  assert.equal(at({ w: 1439.6 }).width, 1440);
  assert.equal(at({ l: 'pt-BR' }).lang, 'pt');
  assert.equal(at({ l: 'AST' }).lang, 'ast');
  assert.equal(at({ l: '<b>' }).lang, null);
  assert.equal(at({ l: 'x' }).lang, null);
  assert.equal(at({ l: 42 }).lang, null);
});

test('device by width', () => {
  assert.equal(deviceOf(360), 'phone');
  assert.equal(deviceOf(800), 'tablet');
  assert.equal(deviceOf(1920), 'desktop');
  assert.equal(deviceOf(0), null);
  assert.equal(deviceOf(undefined), null);
});

test('props are cut to ten', () => {
  const many = Object.fromEntries(Array.from({ length: 15 }, (_, i) => ['k' + i, 'v']));
  assert.equal(Object.keys(cleanProps(many)).length, 10);
  assert.equal(cleanProps([]), null);
  assert.equal(cleanProps({ a: null, b: {} }), null);
});

test('origin allowlist', () => {
  assert.equal(originAllowed('https://betorzdev.github.io', site.origins), true);
  assert.equal(originAllowed('https://evil.example', site.origins), false);
  assert.equal(originAllowed(null, site.origins), false);
  assert.equal(originAllowed('https://betorzdev.github.io', 'https://BetorzDev.github.io/'), true, 'a registered origin is normalized');
  assert.equal(originAllowed('https://betorzdev.github.io', 'https://betorzdev.github.io/hallownest-calculator/'), true);
  assert.equal(originAllowed('http://betorzdev.github.io', site.origins), false, 'the scheme counts');
});

test('readCapped stops at the cap, with or without Content-Length', async () => {
  const { readCapped } = await import('../src/body.js');
  const small = new Request('http://x/c', { method: 'POST', body: '{"s":"a"}' });
  assert.equal(await readCapped(small, 64), '{"s":"a"}');
  const big = new Request('http://x/c', { method: 'POST', body: 'x'.repeat(100) });
  assert.equal(await readCapped(big, 64), null);
  const lying = new Request('http://x/c', { method: 'POST', body: 'x', headers: { 'Content-Length': '999999' } });
  assert.equal(await readCapped(lying, 64), null);
});

test('$engaged is the one $ event, and carries no properties', () => {
  const at = body => makeHit({ p: '/', ...body }, { site, ua: UA, now: NOW });
  const { hit } = at({ e: '$engaged', props: { view: 'map' } });
  assert.equal(hit.event, '$engaged');
  assert.equal(hit.props, null);
  assert.equal(at({ e: '$other' }).skip, 'event');
  assert.equal(at({ e: '$' }).skip, 'event');
});

test('a link tag takes the referrer\'s place, only when it names a known channel', () => {
  const at = body => makeHit({ p: '/', r: 'https://www.google.com/', ...body }, { site, ua: UA, now: NOW }).hit;
  assert.equal(at({ c: 'Reddit' }).ref, 'reddit');
  assert.equal(at({ c: ' discord ' }).ref, 'discord');
  assert.equal(at({ c: '' }).ref, 'google.com');
  assert.equal(at({ c: 'jsmith' }).ref, 'google.com', 'a personal referral code is not a channel');
  assert.equal(at({ c: 'u8f3k2x9' }).ref, 'google.com');
  assert.equal(at({ c: 'juan@mail.com' }).ref, 'google.com');
  assert.equal(at({ c: 7 }).ref, 'google.com');
  assert.equal(at({ c: 'discord' }).ref, 'discord');
  assert.equal(campaign('youtube'), 'youtube');
  assert.equal(campaign('youtube2'), null);
});
