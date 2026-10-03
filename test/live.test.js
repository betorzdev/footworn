import test from 'node:test';
import assert from 'node:assert/strict';
import { liveMessage } from '../src/live.js';
import { makeHit } from '../src/collect.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
const site = { id: 'hallownest', name: 'Hallownest', origins: 'https://betorzdev.github.io' };
const NOW = Date.UTC(2026, 9, 3, 12, 0, 0) / 1000;

test('a live pageview carries only the scene fields', () => {
  const { hit } = makeHit({ s: 'hallownest', p: '/map/', r: 'https://www.reddit.com/r/x', w: 390, l: 'es-ES' }, { site, ua: UA, country: 'ES', now: NOW });
  hit.first = 1;
  assert.deepEqual(liveMessage(hit), { site: 'hallownest', t: NOW, path: '/map/', ref: 'reddit.com', device: 'phone', first: 1, country: 'ES', event: null });
});

test('never browser, os, width, lang or props', () => {
  const { hit } = makeHit({ s: 'hallownest', p: '/', e: 'share', props: { view: 'map' }, w: 1440, l: 'en' }, { site, ua: UA, country: 'US', now: NOW });
  hit.first = 0;
  const msg = liveMessage(hit);
  assert.equal(msg.event, 'share');
  for (const k of ['browser', 'os', 'width', 'lang', 'props', 'day', 'id']) assert.equal(k in msg, false, k);
  assert.deepEqual(Object.keys(msg).sort(), ['country', 'device', 'event', 'first', 'path', 'ref', 'site', 't']);
});
