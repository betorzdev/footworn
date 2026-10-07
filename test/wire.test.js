import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LIMITS, CHANNELS } from '../src/collect.js';

/* public/wire.js is a classic script for the dashboard: run here with a window of its own. */
const window = {};
vm.runInNewContext(readFileSync(new URL('../public/wire.js', import.meta.url), 'utf8'), { window });
const W = window.FootwornWire;
const site = { id: 'sheos-forge', name: 'Sheo’s Forge', origins: ['https://sheosforge.com', 'https://www.sheosforge.com'] };
const worker = 'https://footworn.example.workers.dev';

test('the wiring prompt carries the site, its origins and the Worker', () => {
  const p = W.prompt(site, worker);
  assert.match(p, /site id "sheos-forge" \(Sheo’s Forge\), allowed origins: https:\/\/sheosforge\.com https:\/\/www\.sheosforge\.com/);
  assert.ok(p.includes('<script async src="https://footworn.example.workers.dev/footworn.js" data-site="sheos-forge"></script>'), 'the tag');
  assert.ok(p.includes('https://footworn.example.workers.dev/privacy'), 'the privacy link');
  assert.match(p, /propose which views and actions to track/, 'the agent proposes, then asks');
  assert.match(p, /Do not commit or deploy without asking me\.$/);
  /* the panel's steps and the prompt are one list */
  assert.equal(p.match(/^\d+\. /gm).length, W.steps(site, worker).length);
});

test('the limits and channels it tells are the collector’s', () => {
  assert.deepEqual({ ...W.LIMITS }, LIMITS);
  assert.deepEqual([...W.CHANNELS].sort(), [...CHANNELS].sort());
});
