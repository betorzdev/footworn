import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSite, saveSite, removeSite, fetchIcon, keepIcon, pageUrl, REMOVE_CHUNK } from '../src/sites.js';
import { readCapped } from '../src/body.js';

/* A D1 stand-in that records every statement. */
function fakeDb() {
  const seen = [];
  return {
    seen,
    prepare(sql) { return { bind(...args) { const st = { sql, args, run: async () => ({ meta: { changes: 1 } }), first: async () => null }; seen.push(st); return st; } }; },
    batch: async list => list.map(() => ({ results: [] })),
  };
}

const good = { id: 'sheos-forge', name: ' Sheo’s Forge ', origins: ['https://sheosforge.com', 'http://localhost:8787'], style: 'umbra', tint: 3, hue: 40, shade: -10, pieces: { wall: 'rampart', shade: 'half', spire: 'kit' } };

test('a site is checked before it is saved', () => {
  assert.deepEqual(validateSite(good), { site: { id: 'sheos-forge', name: 'Sheo’s Forge', origins: 'https://sheosforge.com http://localhost:8787', style: 'umbra', tint: 3, hue: 40, shade: -10, pieces: { wall: 'rampart', shade: 'half' } } });
  /* pieces: "kit" or null is the kit's own; none left is null */
  assert.equal(validateSite({ ...good, pieces: { roofs: 'kit', motes: null } }).site.pieces, null);
  /* origins as the shell gives them: one string; repeated ones once */
  assert.equal(validateSite({ ...good, origins: 'https://a.example  https://b.example https://a.example' }).site.origins, 'https://a.example https://b.example');
  /* the look may be empty: the kit as it is, the colour by position */
  assert.deepEqual(validateSite({ id: 'a', name: 'A', origins: 'https://a.example' }).site, { id: 'a', name: 'A', origins: 'https://a.example', style: null, tint: null, hue: null, shade: null, pieces: null });
  assert.equal(validateSite({ id: 'a', name: 'A', origins: 'https://a.example', style: '', tint: '', hue: null }).site.style, null);
  /* as pasted from the address bar: the origin it is */
  assert.equal(validateSite({ ...good, origins: 'https://Site.Example/ https://site.example:443 http://localhost:8787/' }).site.origins, 'https://site.example http://localhost:8787');
  const bad = [
    [null, /JSON object/],
    [{ ...good, id: 'Sheo' }, /^id:/], [{ ...good, id: '-a' }, /^id:/], [{ ...good, id: 'a'.repeat(65) }, /^id:/], [{ ...good, id: 'a b' }, /^id:/],
    [{ ...good, name: '  ' }, /^name:/], [{ ...good, name: 'n'.repeat(81) }, /^name:/],
    [{ ...good, origins: [] }, /at least one/], [{ ...good, origins: 'nope' }, /not a URL/],
    [{ ...good, origins: 'https://a.example/path' }, /not an origin/], [{ ...good, origins: 'ftp://a.example' }, /not an origin/],
    [{ ...good, origins: 'https://a.example/?q=1' }, /not an origin/], [{ ...good, origins: 'https://a.example/#x' }, /not an origin/],
    [{ ...good, origins: 'https://me:pw@a.example' }, /not an origin/], [{ ...good, origins: 'javascript:alert(1)' }, /not an origin/],
    [{ ...good, origins: Array.from({ length: 21 }, (_, i) => `https://s${i}.example`) }, /20 at most/],
    [{ ...good, style: 'gothic' }, /^style:/],
    [{ ...good, tint: 0 }, /^tint:/], [{ ...good, tint: 9 }, /^tint:/], [{ ...good, tint: 2.5 }, /^tint:/], [{ ...good, tint: '3' }, /^tint:/],
    [{ ...good, hue: 360 }, /^hue:/], [{ ...good, hue: -1 }, /^hue:/],
    [{ ...good, shade: 41 }, /^shade:/], [{ ...good, shade: -41 }, /^shade:/],
    [{ ...good, pieces: 'rampart' }, /^pieces:/], [{ ...good, pieces: ['rampart'] }, /^pieces:/],
    [{ ...good, pieces: { tower: 'iron' } }, /^pieces:/], [{ ...good, pieces: { wall: 'moat' } }, /^pieces:/],
  ];
  for (const [body, re] of bad) assert.match(validateSite(body).error, re, JSON.stringify(body));
});

test('saving writes every field but the icon; removing takes the hits and the hashes with the site', async () => {
  const db = fakeDb();
  await saveSite(db, validateSite(good).site);
  assert.equal(db.seen.length, 1);
  assert.match(db.seen[0].sql, /INSERT INTO sites \(id, name, origins, style, tint, hue, shade, pieces\)/);
  assert.match(db.seen[0].sql, /ON CONFLICT\(id\) DO UPDATE SET name = excluded\.name, origins = excluded\.origins, style = excluded\.style,\s+tint = excluded\.tint, hue = excluded\.hue, shade = excluded\.shade, pieces = excluded\.pieces/);
  assert.doesNotMatch(db.seen[0].sql, /icon/);
  assert.deepEqual(db.seen[0].args, ['sheos-forge', 'Sheo’s Forge', 'https://sheosforge.com http://localhost:8787', 'umbra', 3, 40, -10, '{"wall":"rampart","shade":"half"}']);

  /* a new site never overwrites one: the insert does nothing and says so */
  const db3 = fakeDb();
  db3.prepare = sql => ({ bind: (...args) => ({ run: async () => { db3.seen.push({ sql, args }); return { meta: { changes: 0 } }; } }) });
  assert.equal(await saveSite(db3, validateSite(good).site, { create: true }), false);
  assert.match(db3.seen[0].sql, /ON CONFLICT\(id\) DO NOTHING/);
  db3.prepare = sql => ({ bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) });
  assert.equal(await saveSite(db3, validateSite(good).site, { create: true }), true);

  /* a busy site: its hits in rounds while a round comes back full, then the rest with the site */
  const db2 = fakeDb(), rounds = [REMOVE_CHUNK, REMOVE_CHUNK, 7];
  db2.prepare = sql => ({ bind: (...args) => { const st = { sql, args, run: async () => ({ meta: { changes: rounds.shift() } }) }; db2.seen.push(st); return st; } });
  await removeSite(db2, 'sheos-forge');
  const round = `DELETE FROM hits WHERE id IN (SELECT id FROM hits WHERE site = ? LIMIT ${REMOVE_CHUNK})`;
  assert.deepEqual(db2.seen.map(st => [st.sql, st.args]), [
    [round, ['sheos-forge']], [round, ['sheos-forge']], [round, ['sheos-forge']],
    ['DELETE FROM hits WHERE site = ?', ['sheos-forge']],
    ['DELETE FROM seen WHERE site = ?', ['sheos-forge']],
    ['DELETE FROM sites WHERE id = ?', ['sheos-forge']],
  ]);
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
function serve(files) {
  const asked = [];
  const fetchFn = async url => {
    asked.push(url);
    const f = files[url];
    if (!f) return new Response('not here', { status: 404 });
    if (f instanceof Error) throw f;
    return new Response(f.body, { status: 200, headers: f.headers || {} });
  };
  return { fetchFn, asked };
}

test('the icon is fetched as site:icon fetches it: the page’s links, the first usable one kept', async () => {
  const page = `<html><head><link rel="icon" href="/i/small.png" sizes="32x32"><link rel="icon" href="/i/big.png" sizes="192x192"><link rel="icon" href="/i/svg.svg"></head></html>`;
  const { fetchFn, asked } = serve({
    'https://site.example/': { body: page, headers: { 'Content-Type': 'text/html' } },
    'https://site.example/i/big.png': { body: new Uint8Array(ICON_TOO_BIG()) },   // the largest, but over 40 KB
    'https://site.example/i/small.png': { body: PNG },
  });
  const got = await fetchIcon(fetchFn, 'https://site.example/');
  assert.equal(got.type, 'image/png');
  assert.equal(got.url, 'https://site.example/i/small.png');
  assert.deepEqual([...got.bytes], [...PNG]);
  assert.deepEqual(asked, ['https://site.example/', 'https://site.example/i/big.png', 'https://site.example/i/small.png']);
});

test('a page longer than what is read: its head still gives the icon', async () => {
  const page = '<head><link rel="icon" href="/i.png"></head>' + 'x'.repeat(600 * 1024);
  const { fetchFn } = serve({ 'https://site.example/': { body: page }, 'https://site.example/i.png': { body: PNG } });
  assert.equal((await fetchIcon(fetchFn, 'https://site.example/')).url, 'https://site.example/i.png');
});

test('no page, no links: /favicon.ico is still tried; nothing usable is null', async () => {
  const one = serve({ 'https://site.example/favicon.ico': { body: new Uint8Array([0, 0, 1, 0, 1, 0]) } });
  assert.equal((await fetchIcon(one.fetchFn, 'https://site.example/')).type, 'image/x-icon');
  const down = serve({ 'https://site.example/': new Error('refused') });
  assert.equal(await fetchIcon(down.fetchFn, 'https://site.example/'), null);
  assert.deepEqual(down.asked, ['https://site.example/', 'https://site.example/favicon.ico']);
  /* a page that lies: its icon is an HTML page */
  const lying = serve({ 'https://site.example/': { body: '<link rel="icon" href="/x.png">' }, 'https://site.example/x.png': { body: '<!doctype html>' } });
  assert.equal(await fetchIcon(lying.fetchFn, 'https://site.example/'), null);
});

test('a kept icon goes in as a BLOB of its own bytes', async () => {
  const db = fakeDb();
  const view = new Uint8Array(new ArrayBuffer(16), 4, 8);   // a view into a bigger buffer: only its bytes go in
  view.set([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  await keepIcon(db, 'one', view, 'image/png');
  assert.equal(db.seen[0].sql, 'UPDATE sites SET icon = ?, icon_type = ? WHERE id = ?');
  assert.ok(db.seen[0].args[0] instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(db.seen[0].args[0])], [0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  assert.deepEqual(db.seen[0].args.slice(1), ['image/png', 'one']);
});

test('a page URL for the icon is http(s) or nothing', () => {
  assert.equal(pageUrl('https://site.example/calc/'), 'https://site.example/calc/');
  assert.equal(pageUrl('javascript:alert(1)'), null);
  assert.equal(pageUrl('file:///etc/passwd'), null);
  assert.equal(pageUrl('nope'), null);
});

test('readCapped reads bytes too, with the same cap', async () => {
  const r = new Response(new Uint8Array([1, 2, 3]));
  assert.deepEqual([...await readCapped(r, 8, { bytes: true })], [1, 2, 3]);
  assert.equal(await readCapped(new Response(new Uint8Array(9)), 8, { bytes: true }), null);
  assert.deepEqual([...await readCapped(new Response(null), 8, { bytes: true })], []);
  /* the head of a long page: the first bytes, never nothing */
  assert.equal(await readCapped(new Response('<head><link rel="icon" href="/i.png"></head>' + 'x'.repeat(100)), 45, { head: true }), '<head><link rel="icon" href="/i.png"></head>x');
});

function ICON_TOO_BIG() { const b = new Uint8Array(41 * 1024); b.set([0x89, 0x50, 0x4e, 0x47]); return b; }
