import test from 'node:test';
import assert from 'node:assert/strict';
import { scene } from '../src/stats.js';

/* A D1 stand-in that records every statement and answers the batch with the rows given, in order. */
function fakeDb(answers) {
  const seen = [];
  return {
    seen,
    prepare(sql) { return { bind(...args) { const st = { sql, args, first: async () => null }; seen.push(st); return st; } }; },
    batch: async list => list.map((st, i) => ({ results: answers[i] || [] })),
  };
}

const NOW = Date.UTC(2026, 9, 5, 12, 0, 30);

test('the views of a site: the 30-day top 8, and today per page', async () => {
  const answers = [];
  answers[2] = [{ hits: 9, visitors: 2, events: 6, views: 4 }];
  answers[7] = [{ value: 'charms', hits: 40 }, { value: 'map', hits: 12 }];
  answers[8] = [{ view: 'charms', hits: 3 }, { view: 'map', hits: 1 }];
  answers[9] = [{ path: '/', view: 'charms', hits: 2 }, { path: '/es/', view: 'charms', hits: 1 }, { path: '/es/', view: 'map', hits: 1 }];
  const db = fakeDb(answers);
  const out = await scene(db, { site: 'one', now: NOW });
  assert.deepEqual(out.views, answers[7]);
  assert.deepEqual(out.today.views, answers[8]);
  assert.deepEqual(out.today.viewPages, answers[9]);
  /* Every view opened today, not the sum of a list cut at 200 names; they are inside `events`. */
  assert.equal(out.today.viewsTotal, 4);
  assert.equal(out.today.events, 6);
  assert.match(db.seen.find(st => st.sql.includes('AS loads') && !st.sql.includes('GROUP BY')).sql, /SUM\(event = 'screen' AND json_type\(props, '\$\.view'\) = 'text'\) AS views/);

  const [top, today, pages] = db.seen.slice(-3);
  assert.deepEqual(top.args, ['one', '2026-09-06', '2026-10-05']);
  assert.match(top.sql, /LIMIT 8/);
  assert.match(top.sql, /ORDER BY hits DESC, value/);   // a tie never makes two stalls trade places
  /* A stall's count is its view's own row: the pairs with a page are cut at 200, the counts are not theirs. */
  assert.deepEqual(today.args, ['one', '2026-10-05']);
  assert.match(today.sql, /GROUP BY view /);
  assert.deepEqual(pages.args, ['one', '2026-10-05']);
  assert.match(pages.sql, /GROUP BY path, view ORDER BY hits DESC, path, view/);
  /* Only a `screen` event whose `view` is text is a view: counts, nothing that singles a visit out. */
  for (const st of [top, today, pages]) {
    assert.match(st.sql, /event = 'screen' AND json_type\(props, '\$\.view'\) = 'text'/);
    assert.match(st.sql, /COUNT\(\*\) AS hits/);
    for (const bad of [' ts', 'first', 'country', 'browser', 'width']) assert.ok(!st.sql.includes(bad), bad);
  }
});

test('a site with no views answers empty lists', async () => {
  const out = await scene(fakeDb([]), { site: 'one', now: NOW });
  assert.deepEqual(out.views, []);
  assert.deepEqual(out.today.views, []);
  assert.deepEqual(out.today.viewPages, []);
  assert.equal(out.today.viewsTotal, 0);
  assert.equal(out.hours.length, 24);
  assert.ok(!('live' in out));   // the count of the last 5 minutes is gone: the dashboard shows views and events
});
