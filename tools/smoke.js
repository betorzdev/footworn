#!/usr/bin/env node
/* End to end on a throwaway local D1: boots `wrangler dev`, posts pageviews and events as two
   sites and a bot would, runs the nightly cron, and checks the API's numbers. `npm run smoke`. */
import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const PORT = 8799, PERSIST = '.wrangler/smoke', TOKEN = 'smoke-token';
const BASE = `http://127.0.0.1:${PORT}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

/* workerd outlives wrangler when wrangler is killed, so the ones this run started are listed
   once the server is up and killed by pid at the end. */
function pids() {
  const r = spawnSync('pgrep', ['-x', 'workerd'], { encoding: 'utf8' });
  return (r.stdout || '').split(/\s+/).filter(Boolean).map(Number);
}

function sh(args) {
  const r = spawnSync('npx', ['wrangler', ...args, '--persist-to', PERSIST], { stdio: 'pipe', encoding: 'utf8' });
  if (r.status) { console.error(r.stdout, r.stderr); process.exit(1); }
}

try { await fetch(BASE + '/'); console.error(`smoke: something already listens on ${BASE} (a leftover wrangler dev?)`); process.exit(1); } catch (e) { /* free, as it should be */ }
rmSync(PERSIST, { recursive: true, force: true });
sh(['d1', 'migrations', 'apply', 'DB', '--local']);
for (const [id, name] of [['one', 'Site One'], ['two', 'Site Two']]) {
  const r = spawnSync('node', ['tools/site-add.js', id, name, `https://${id}.example`, '--persist-to', PERSIST], { stdio: 'pipe', encoding: 'utf8' });
  if (r.status) { console.error(r.stdout, r.stderr); process.exit(1); }
}

const workerdBefore = new Set(pids());
/* wrangler's own entry, not npx's wrapper: then `dev.pid` is wrangler itself and a signal reaches it. */
const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const dev = spawn(process.execPath, [WRANGLER, 'dev', '--port', String(PORT), '--persist-to', PERSIST, '--var', `ADMIN_TOKEN:${TOKEN}`, '--log-level', 'error'], { stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
dev.stdout.on('data', d => { out += d; });
dev.stderr.on('data', d => { out += d; });

async function ready() {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(BASE + '/api/sites'); if (r.status === 401 || r.status === 200) return; } catch (e) { /* not yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  console.error(out);
  throw new Error('wrangler dev did not come up');
}

function post(body, { origin = 'https://one.example', ua = UA, ip = '203.0.113.1' } = {}) {
  return fetch(BASE + '/c', { method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'text/plain', Origin: origin, 'User-Agent': ua, 'CF-Connecting-IP': ip } });
}
const api = (path) => fetch(BASE + path, { headers: { Authorization: 'Bearer ' + TOKEN } }).then(r => r.json());
const today = new Date().toISOString().slice(0, 10);

let mine = [];
try {
  await ready();
  mine = pids().filter(p => !workerdBefore.has(p));
  const r401 = await fetch(BASE + '/api/sites');
  assert.equal(r401.status, 401, 'the API is locked');

  // Site one: visitor A twice on two pages, visitor B once, A fires two events.
  assert.equal((await post({ s: 'one', p: '/', r: 'https://www.reddit.com/r/x/', w: 1440, l: 'es-ES' })).status, 204);
  await post({ s: 'one', p: '/map/', w: 1440, l: 'es-ES' });
  await post({ s: 'one', p: '/', w: 390, l: 'en-US' }, { ip: '203.0.113.2', ua: UA.replace('Windows NT 10.0; Win64; x64', 'iPhone; CPU iPhone OS 17_5 like Mac OS X') });
  await post({ s: 'one', p: '/', e: 'screen', props: { view: 'combat', lang: 'es' } });
  await post({ s: 'one', p: '/map/', e: 'screen', props: { view: 'map', lang: 'es' } });
  // Visitor C fires an event before any pageview: the event is not a visitor, the pageview still is.
  await post({ s: 'one', p: '/', e: 'share' }, { ip: '203.0.113.3' });
  await post({ s: 'one', p: '/', w: 1024, l: 'fr' }, { ip: '203.0.113.3' });
  // Not counted: a bot, a wrong origin, an unknown site, a bad path, a body too big to be a hit.
  await post({ s: 'one', p: '/' }, { ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
  await post({ s: 'one', p: '/' }, { origin: 'https://evil.example' });
  await post({ s: 'nope', p: '/' });
  await post({ s: 'one', p: 'relative' });
  await post({ s: 'one', p: '/', props: 'x'.repeat(9000) });
  // Site two: one pageview, must not leak into one.
  await post({ s: 'two', p: '/' }, { origin: 'https://two.example' });

  const sites = await api('/api/sites');
  assert.deepEqual(sites.map(s => s.id), ['one', 'two']);

  let st = await api(`/api/stats?site=one&from=${today}&to=${today}`);
  assert.deepEqual(st.totals, { hits: 4, visitors: 3, events: 3 }, 'totals');
  assert.deepEqual(st.days, [{ day: today, hits: 4, visitors: 3, events: 3 }], 'days');
  assert.deepEqual(st.path.map(p => [p.value, p.hits]), [['/', 3], ['/map/', 1]], 'paths');
  assert.deepEqual(st.ref, [{ value: 'reddit.com', hits: 1, visitors: 1 }], 'refs');
  assert.deepEqual(st.device.map(d => d.value).sort(), ['desktop', 'phone'], 'devices');
  assert.deepEqual(st.lang.map(d => [d.value, d.hits]).sort(), [['en', 1], ['es', 2], ['fr', 1]], 'langs');
  assert.deepEqual(st.events, [{ value: 'screen', hits: 2 }, { value: 'share', hits: 1 }], 'events');
  assert.equal(st.hours.reduce((n, h) => n + h.hits, 0), 4, 'hours sum to the pageviews');
  assert.ok(st.hours.every(h => h.hour >= 0 && h.hour < 24), 'hours are 0-23');
  assert.deepEqual(st.weekdays, [{ weekday: new Date().getUTCDay(), hits: 4 }], 'weekdays');
  assert.deepEqual(st.widths, [{ bucket: 300, hits: 1 }, { bucket: 1000, hits: 1 }, { bucket: 1400, hits: 2 }], 'widths');
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  assert.deepEqual(st.previous, { from: yesterday, to: yesterday, hits: 0, visitors: 0, events: 0 }, 'previous period');

  const ev = await api(`/api/event?site=one&name=screen&from=${today}&to=${today}`);
  assert.equal(ev.totals.hits, 2);
  assert.deepEqual(ev.props.view.map(v => v.value).sort(), ['combat', 'map'], 'event props');
  assert.deepEqual(ev.props.lang, [{ value: 'es', hits: 2 }], 'event props');
  assert.deepEqual(ev.paths.map(p => p.value).sort(), ['/', '/map/'], 'event paths');

  const two = await api(`/api/stats?site=two`);
  assert.equal(two.totals.hits, 1, 'site two is separate');

  // The snowfield's read: counts only, no list of hits.
  const sc = await api('/api/scene?site=one');
  assert.deepEqual([sc.today.hits, sc.today.visitors, sc.today.events], [4, 3, 3], 'scene totals');
  assert.deepEqual(sc.pages.map(p => [p.value, p.hits]), [['/', 3], ['/map/', 1]], 'scene stones');
  assert.deepEqual(sc.refs, [{ value: 'reddit.com', hits: 1 }], 'scene gates');
  assert.deepEqual(sc.today.pages.map(p => [p.path, p.hits, p.events]).sort(), [['/', 3, 2], ['/map/', 1, 1]], 'scene today by page');
  assert.equal(sc.recent.reduce((n, r) => n + r.hits, 0), 4, 'scene recent footprints');
  assert.ok(sc.recent.every(r => !('country' in r)), 'no country in the aggregate');

  // The live view: a ticket, the socket, one hit relayed with exactly its scene fields; a bot is
  // not relayed; a ticket tampered with opens nothing.
  const { ticket } = await api('/api/live-ticket');
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/live?ticket=${encodeURIComponent(ticket)}`);
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error('the live socket did not open')); });
  const next = () => new Promise(ok => { const t = setTimeout(() => ok(null), 3000); ws.onmessage = e => { clearTimeout(t); ok(JSON.parse(e.data)); }; });
  let msg = next();
  await post({ s: 'two', p: '/live/', r: 'https://news.ycombinator.com/', w: 390, l: 'en' }, { origin: 'https://two.example', ip: '203.0.113.9' });
  msg = await msg;
  assert.ok(msg, 'a live message arrives');
  // wrangler dev fills the country from this machine's connection, so any code (or none) will do.
  assert.ok(msg.country === null || /^[A-Z]{2}$/.test(msg.country), 'live country');
  assert.deepEqual({ ...msg, t: 0, country: null }, { site: 'two', t: 0, path: '/live/', ref: 'news.ycombinator.com', device: 'phone', first: 1, country: null, event: null }, 'live message');
  msg = next();
  await post({ s: 'two', p: '/' }, { origin: 'https://two.example', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
  assert.equal(await msg, null, 'a bot is not relayed');
  ws.close();
  const bad = new WebSocket(`ws://127.0.0.1:${PORT}/live?ticket=${encodeURIComponent(ticket.slice(0, -2) + (ticket.endsWith('AA') ? 'BB' : 'AA'))}`);
  assert.equal(await new Promise(ok => { bad.onopen = () => ok('open'); bad.onerror = () => ok('refused'); }), 'refused', 'a tampered ticket is refused');
  assert.equal((await fetch(BASE + '/live')).status, 426, '/live is a socket');

  // The dashboard comes with its headers (public/_headers), and the file itself is not served.
  const home = await fetch(BASE + '/');
  assert.equal(home.status, 200, 'the dashboard is served');
  assert.match(home.headers.get('content-security-policy') || '', /frame-ancestors 'none'/, 'CSP on the dashboard');
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff', 'nosniff everywhere');
  assert.equal((await fetch(BASE + '/_headers')).status, 404, '_headers is not an asset');

  // The cron forgets today's visitors: the same visitor is new again.
  const cron = await fetch(BASE + '/cdn-cgi/local/scheduled');
  assert.equal(cron.status, 200, 'cron ran');
  await post({ s: 'one', p: '/', w: 1440, l: 'es-ES' });
  st = await api(`/api/stats?site=one`);
  assert.deepEqual(st.totals, { hits: 5, visitors: 4, events: 3 }, 'after the cron');

  console.log('smoke: ok');
} catch (e) {
  console.error('smoke: FAIL', e.message);
  if (e.actual !== undefined) console.error(' actual:', JSON.stringify(e.actual), '\n expected:', JSON.stringify(e.expected));
  process.exitCode = 1;
} finally {
  dev.kill('SIGTERM');
  setTimeout(() => {
    dev.kill('SIGKILL');
    for (const p of mine) { try { process.kill(p, 'SIGKILL'); } catch (e) { /* gone */ } }
  }, 1200);
  setTimeout(() => process.exit(process.exitCode || 0), 1500);
}
