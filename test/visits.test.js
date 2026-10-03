import test from 'node:test';
import assert from 'node:assert/strict';
import { visits } from '../src/stats.js';

/* A D1 stand-in that records the query and answers with the rows given. */
function fakeDb(rows) {
  const seen = {};
  return {
    seen,
    prepare(sql) { seen.sql = sql; return { bind(...args) { seen.args = args; return { all: async () => ({ results: rows }) }; } }; },
  };
}

test('today only, newest first, rounded: no width, no second, no id', async () => {
  const db = fakeDb([{ minute: 1791043200, path: '/', ref: null, device: 'phone', browser: 'Safari', os: 'iOS', lang: 'es', country: 'ES', first: 1, event: null, props: null }]);
  const out = await visits(db, { site: 'one', now: Date.UTC(2026, 9, 3, 12, 0, 30) });
  assert.deepEqual(db.seen.args, ['one', '2026-10-03']);
  assert.match(db.seen.sql, /\(ts \/ 60\) \* 60 AS minute/);
  assert.match(db.seen.sql, /ORDER BY ts DESC/);
  const cols = db.seen.sql.slice(db.seen.sql.indexOf('SELECT') + 6, db.seen.sql.indexOf('FROM'));
  for (const bad of ['width', 'id', ' ts,', 'day']) assert.ok(!cols.includes(bad), bad);
  assert.equal(out.day, '2026-10-03');
  assert.equal(out.visits[0].minute % 60, 0);
});

test('props come parsed, and bad JSON becomes null', async () => {
  const db = fakeDb([
    { minute: 60, path: '/', event: 'screen', props: '{"view":"map"}', first: 0 },
    { minute: 0, path: '/', event: 'share', props: '{bad', first: 0 },
  ]);
  const out = await visits(db, { site: 'one' });
  assert.deepEqual(out.visits.map(v => v.props), [{ view: 'map' }, null]);
});

test('$engaged rows stay out of the list: they would join two rows', async () => {
  const db = fakeDb([]);
  await visits(db, { site: 'one' });
  assert.match(db.seen.sql, /event IS NULL OR \(event IS NOT NULL AND event NOT LIKE '\$%'\)/);
});
