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
const PNG = '89504e470d0a1a0a';   // the first bytes of a PNG: what /api/icon serves back
for (const [id, name, style] of [['one', 'Site One', 'umbra'], ['two', 'Site Two']]) {
  const r = spawnSync('node', ['tools/site-add.js', id, name, `https://${id}.example`, ...(style ? ['--style', style] : []), '--persist-to', PERSIST], { stdio: 'pipe', encoding: 'utf8' });
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
  // C came by a link tagged ?ref=Discord: the tag stands in for the missing referrer.
  await post({ s: 'one', p: '/', r: '', c: 'Discord', w: 1024, l: 'fr' }, { ip: '203.0.113.3' });
  // A reloads the home page: the same visit again, not counted.
  await post({ s: 'one', p: '/', rl: 1, w: 1440, l: 'es-ES' });
  // A used the home page: one `$engaged`, a "used" load, never an event; `$other` is not Footworn's.
  await post({ s: 'one', p: '/', e: '$engaged' });
  await post({ s: 'one', p: '/', e: '$other' });
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
  assert.deepEqual(st.totals, { hits: 4, visitors: 3, events: 3, loads: 4, engaged: 1 }, 'totals');
  assert.deepEqual(st.days, [{ day: today, hits: 4, visitors: 3, events: 3, engaged: 1 }], 'days');
  assert.deepEqual(st.path.map(p => [p.value, p.hits, p.loads, p.engaged]), [['/', 3, 3, 1], ['/map/', 1, 1, 0]], 'paths, and their used loads');
  assert.deepEqual(st.ref.map(r => r.value).sort(), ['discord', 'reddit.com'], 'refs, a link tag among them');
  assert.deepEqual(st.device.map(d => d.value).sort(), ['desktop', 'phone'], 'devices');
  assert.deepEqual(st.lang.map(d => [d.value, d.hits]).sort(), [['en', 1], ['es', 2], ['fr', 1]], 'langs');
  assert.deepEqual(st.events, [{ value: 'screen', hits: 2 }, { value: 'share', hits: 1 }], 'events');
  assert.equal(st.hours.reduce((n, h) => n + h.hits, 0), 4, 'hours sum to the pageviews');
  assert.ok(st.hours.every(h => h.hour >= 0 && h.hour < 24), 'hours are 0-23');
  assert.deepEqual(st.weekdays, [{ weekday: new Date().getUTCDay(), hits: 4 }], 'weekdays');
  assert.deepEqual(st.widths, [{ bucket: 300, hits: 1 }, { bucket: 1000, hits: 1 }, { bucket: 1400, hits: 2 }], 'widths');
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  assert.deepEqual(st.previous, { from: yesterday, to: yesterday, hits: 0, visitors: 0, events: 0, loads: 0, engaged: 0 }, 'previous period');

  const ev = await api(`/api/event?site=one&name=screen&from=${today}&to=${today}`);
  assert.equal(ev.totals.hits, 2);
  assert.deepEqual(ev.props.view.map(v => v.value).sort(), ['combat', 'map'], 'event props');
  assert.deepEqual(ev.props.lang, [{ value: 'es', hits: 2 }], 'event props');
  assert.deepEqual(ev.paths.map(p => p.value).sort(), ['/', '/map/'], 'event paths');

  const two = await api(`/api/stats?site=two`);
  assert.equal(two.totals.hits, 1, 'site two is separate');

  // The snowfield's read: counts only, no list of hits.
  const sc = await api('/api/scene?site=one');
  assert.deepEqual([sc.today.hits, sc.today.visitors, sc.today.events, sc.today.loads, sc.today.engaged], [4, 3, 3, 4, 1], 'scene totals');
  assert.deepEqual(sc.pages.map(p => [p.value, p.hits]), [['/', 3], ['/map/', 1]], 'scene towers');
  assert.deepEqual(sc.refs.map(r => r.value).sort(), ['discord', 'reddit.com'], 'scene lanes');
  assert.deepEqual(sc.today.pages.map(p => [p.path, p.hits, p.loads, p.engaged, p.events]).sort(), [['/', 3, 3, 1, 2], ['/map/', 1, 1, 0, 1]], 'scene today by page');
  assert.deepEqual(sc.views, [{ value: 'combat', hits: 1 }, { value: 'map', hits: 1 }], 'scene stalls: the views, ties by name');
  assert.deepEqual(sc.today.views, [{ view: 'combat', hits: 1 }, { view: 'map', hits: 1 }], 'scene views today');
  assert.deepEqual(sc.yesterday.pages, [], 'scene: nothing yesterday');
  /* a site's look: its kit, and its icon behind the token */
  assert.deepEqual((await api('/api/sites')).map(s => [s.id, s.style, s.icon]), [['one', 'umbra', false], ['two', null, false]], 'sites: style and icon');
  sh(['d1', 'execute', 'DB', '--local', '--command', `UPDATE sites SET icon = X'${PNG}', icon_type = 'image/png' WHERE id = 'one'`]);
  assert.equal((await fetch(BASE + '/api/icon?site=one')).status, 401, 'icon: token needed');
  assert.equal((await fetch(BASE + '/api/icon?site=two', { headers: { Authorization: 'Bearer ' + TOKEN } })).status, 404, 'icon: none kept');
  const ic = await fetch(BASE + '/api/icon?site=one', { headers: { Authorization: 'Bearer ' + TOKEN } });
  assert.equal(ic.headers.get('content-type'), 'image/png', 'icon: its type');
  assert.equal(Buffer.from(await ic.arrayBuffer()).toString('hex'), PNG, 'icon: its bytes');
  assert.equal((await api('/api/sites'))[0].icon, true, 'sites: one has an icon');

  /* The Sites panel's writes: a site added, dressed, given an icon, then removed with its hits. */
  const H = { Authorization: 'Bearer ' + TOKEN };
  const put = body => fetch(BASE + '/api/site', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(BASE + '/api/site', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401, 'write: token needed');
  assert.equal((await put({ id: 'Bad Id', name: 'x', origins: ['https://three.example'] })).status, 400, 'write: a bad id is refused');
  assert.equal((await put({ id: 'three', name: 'x', origins: ['https://three.example/path'] })).status, 400, 'write: an origin with a path is refused');
  assert.equal((await put({ id: 'one', name: 'Not One', origins: ['https://x.example'], create: true })).status, 409, 'write: a new site never overwrites one');
  assert.equal((await api('/api/sites')).find(s => s.id === 'one').name, 'Site One', 'write: the old one stands');
  assert.equal((await fetch(BASE + '/api/stats?site=one', { method: 'DELETE', headers: H })).status, 405, 'write: a read path is not written');
  const saved = await (await put({ id: 'three', name: 'Site Three', origins: ['https://three.example'], style: 'citadel', tint: 5, hue: 120, shade: -20, create: true })).json();
  assert.deepEqual(saved.site, { id: 'three', name: 'Site Three', origins: ['https://three.example'], style: 'citadel', tint: 5, hue: 120, shade: -20, icon: false }, 'write: the site as saved');
  await put({ id: 'three', name: 'Site Three', origins: ['https://three.example', 'https://www.three.example'], style: 'stone' });
  const three = (await api('/api/sites')).find(s => s.id === 'three');
  assert.deepEqual([three.style, three.tint, three.hue, three.origins.length], ['stone', null, null, 2], 'write: an edit replaces the look');
  const upPng = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  assert.equal((await fetch(BASE + '/api/icon?site=three', { method: 'POST', headers: { ...H, 'Content-Type': 'image/png' }, body: Buffer.from('<svg></svg>') })).status, 400, 'icon upload: not an image');
  assert.equal((await fetch(BASE + '/api/icon?site=three', { method: 'POST', headers: { ...H, 'Content-Type': 'image/png' }, body: upPng })).status, 200, 'icon upload');
  const ic3 = await fetch(BASE + '/api/icon?site=three', { headers: H });
  assert.equal(Buffer.from(await ic3.arrayBuffer()).toString('hex'), upPng.toString('hex'), 'icon upload: its bytes, served back');
  assert.equal((await fetch(BASE + '/api/icon?site=three', { method: 'DELETE', headers: H })).status, 200, 'icon removed');
  assert.equal((await fetch(BASE + '/api/icon?site=three', { headers: H })).status, 404, 'icon removed: none kept');
  await post({ s: 'three', p: '/' }, { origin: 'https://www.three.example', ip: '203.0.113.9' });
  assert.equal((await api('/api/stats?site=three')).totals.hits, 1, 'a site added from the panel counts');
  assert.equal((await fetch(BASE + '/api/site?site=nope', { method: 'DELETE', headers: H })).status, 404, 'remove: unknown site');
  assert.equal((await fetch(BASE + '/api/site?site=three', { method: 'DELETE', headers: H })).status, 200, 'remove');
  assert.deepEqual((await api('/api/sites')).map(s => s.id), ['one', 'two'], 'remove: gone from the list');
  assert.equal((await api('/api/stats?site=three')).totals.hits, 0, 'remove: its hits went with it');
  await post({ s: 'three', p: '/' }, { origin: 'https://three.example' });
  assert.equal((await api('/api/stats?site=three')).totals.hits, 0, 'remove: its hits are dropped again');
  assert.deepEqual(sc.today.viewPages, [{ path: '/', view: 'combat', hits: 1 }, { path: '/map/', view: 'map', hits: 1 }], 'scene views today by page');
  assert.equal(sc.today.viewsTotal, 2, 'scene views today, all of them');
  assert.ok(!('live' in sc), 'no count of the last 5 minutes any more');
  assert.equal(sc.hours.length, 24, 'scene hours');
  assert.equal(sc.hours.reduce((n, h) => n + h.today, 0), 4, 'scene hours sum to today');
  assert.ok(!('recent' in sc) && !('wear' in sc), 'no footprints any more');
  assert.ok(JSON.stringify(sc).indexOf('country') < 0, 'no country in the aggregate');

  // The village on a past day (nothing was counted yesterday), and the days of the history strip.
  const past = await api(`/api/scene?site=one&day=${yesterday}`);
  assert.deepEqual([past.day, past.past, past.today.hits, past.today.visitors, past.pages.length], [yesterday, true, 0, 0, 0], 'scene of a past day');
  assert.equal(sc.past, false, 'scene of today is not past');
  assert.equal((await api('/api/scene?site=one&day=2999-01-01')).day, today, 'a day to come is today');
  assert.deepEqual((await api(`/api/days?site=one&from=${yesterday}&to=${today}`)).days, [{ day: today, visitors: 3, hits: 4 }], 'days of the strip');

  // Today's visits, one by one, rounded: the minute, never the second or the width.
  const vs = await api('/api/visits?site=one');
  assert.equal(vs.visits.length, 7, 'visits: 4 pageviews and 3 events, no $engaged');
  assert.deepEqual(vs.visits.filter(v => v.event).map(v => v.event).sort(), ['screen', 'screen', 'share'], 'visits events');
  assert.ok(vs.visits.every(v => v.minute % 60 === 0 && !('width' in v) && !('ts' in v) && !('id' in v)), 'visits are rounded');
  assert.deepEqual(vs.visits.find(v => v.event === 'screen' && v.path === '/map/').props, { view: 'map', lang: 'es' }, 'visits props parsed');
  assert.ok((await api('/api/visits?site=two')).visits.every(v => v.path === '/'), 'visits of two are separate');

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
  assert.deepEqual({ ...msg, t: 0, country: null, browser: null, os: null }, { site: 'two', t: 0, path: '/live/', ref: 'news.ycombinator.com', device: 'phone',
    browser: null, os: null, lang: 'en', first: 1, country: null, event: null, props: null }, 'live message');
  assert.deepEqual([msg.browser, msg.os], ['Chrome', 'Windows'], 'live browser and system families');
  msg = next();
  await post({ s: 'two', p: '/' }, { origin: 'https://two.example', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
  assert.equal(await msg, null, 'a bot is not relayed');
  msg = next();
  await post({ s: 'two', p: '/live/', e: '$engaged' }, { origin: 'https://two.example', ip: '203.0.113.9' });
  assert.equal(await msg, null, '$engaged is not relayed');
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
  // A reloads the next day (a tab left open overnight): the day's first pageview, so it counts.
  await post({ s: 'one', p: '/', rl: 1, w: 1440, l: 'es-ES' });
  st = await api(`/api/stats?site=one`);
  assert.deepEqual(st.totals, { hits: 5, visitors: 4, events: 3, loads: 5, engaged: 1 }, 'after the cron');

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
