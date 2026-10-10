import test from 'node:test';
import assert from 'node:assert/strict';
import { scene, days } from '../src/stats.js';

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

test('the views of a site: every one of the 30 days, and today per page', async () => {
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

  const byView = st => st.sql.includes("json_extract(props, '$.view')");
  const top = db.seen.find(st => byView(st) && st.sql.includes('BETWEEN')), today = db.seen.find(st => byView(st) && st.sql.includes('GROUP BY view ')),
    pages = db.seen.find(st => byView(st) && st.sql.includes('GROUP BY path, view'));
  assert.deepEqual(top.args, ['one', '2026-09-06', '2026-10-05']);
  assert.match(top.sql, /LIMIT 200/);   // every view, no grouping: the cut is a safety net
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

test('a past day: the village as that day ended', async () => {
  const answers = [];
  answers[2] = [{ hits: 5, visitors: 3 }];
  answers[5] = [{ visitors: 7 }];
  answers[6] = [{ day: '2026-09-20', hour: 23, hits: 2 }, { day: '2026-09-19', hour: 0, hits: 4 }];
  const db = fakeDb(answers);
  const out = await scene(db, { site: 'one', day: '2026-09-20', now: NOW });
  assert.equal(out.day, '2026-09-20');
  assert.equal(out.past, true);
  assert.equal(out.today.hits, 5);
  assert.equal(out.yesterday.visitors, 7);
  assert.deepEqual(out.hours[23], { hour: 23, today: 2, yesterday: 0 });
  assert.deepEqual(out.hours[0], { hour: 0, today: 0, yesterday: 4 });
  const batch = db.seen.slice(1);   // after loadsSince
  /* The houses, gates and stalls of the 30 days that end on it; the counts of that day alone. */
  assert.deepEqual(batch[0].args, ['one', '2026-08-22', '2026-09-20']);
  assert.deepEqual(batch[2].args, ['one', '2026-09-20']);
  /* The day before, whole: up to its last second, not up to this time of day. */
  assert.deepEqual(batch[5].args, ['one', '2026-09-19', Date.UTC(2026, 8, 20) / 1000 - 1]);
  assert.deepEqual(batch[6].args, ['one', '2026-09-20', '2026-09-19']);
});

test('today, a day to come, a day that is no date or no day at all: today', async () => {
  for (const day of [undefined, '2026-10-05', '2026-10-06', '2026-13-45', '2026-02-31']) {
    const db = fakeDb([]);
    const out = await scene(db, { site: 'one', day, now: NOW });
    assert.equal(out.day, '2026-10-05');
    assert.equal(out.past, false);
    assert.deepEqual(db.seen[6].args, ['one', '2026-10-04', Math.floor(NOW / 1000) - 86400]);
  }
});

test('the month: every pageview and view of the 30 days, for the size of the village', async () => {
  const answers = [];
  answers[11] = [{ hits: 120, views: 340 }];
  const db = fakeDb(answers);
  const out = await scene(db, { site: 'one', now: NOW });
  assert.deepEqual(out.month, { hits: 120, views: 340 });
  const st = db.seen.find(st => !st.sql.includes('GROUP BY') && st.sql.includes('BETWEEN'));
  assert.deepEqual(st.args, ['one', '2026-09-06', '2026-10-05']);
  assert.match(st.sql, /SUM\(event IS NULL\) AS hits, SUM\(event = 'screen' AND json_type\(props, '\$\.view'\) = 'text'\) AS views/);
  assert.ok(!st.sql.includes('LIMIT'));   // a total, not a list cut at 200
  for (const bad of [' ts', 'first', 'country', 'browser', 'width']) assert.ok(!st.sql.includes(bad), bad);
  /* nothing in the 30 days: SUM over no rows is null, the answer zeros */
  assert.deepEqual((await scene(fakeDb([[], [], [], [], [], [], [], [], [], [], [], [{ hits: null, views: null }]]), { site: 'one', now: NOW })).month, { hits: 0, views: 0 });
  /* a past day: the 30 days that end on it */
  const past = fakeDb([]);
  await scene(past, { site: 'one', day: '2026-09-20', now: NOW });
  assert.deepEqual(past.seen.find(st => !st.sql.includes('GROUP BY') && st.sql.includes('BETWEEN')).args, ['one', '2026-08-22', '2026-09-20']);
});

test('the days of the history strip: counts per day, nothing else', async () => {
  const rows = [{ day: '2026-10-04', visitors: 3, hits: 5 }, { day: '2026-10-05', visitors: 1, hits: 1 }];
  const seen = {};
  const db = { prepare(sql) { seen.sql = sql; return { bind(...args) { seen.args = args; return { all: async () => ({ results: rows }) }; } }; } };
  const out = await days(db, { site: 'one', from: '2026-09-06', to: '2026-10-05' });
  assert.deepEqual(out, { site: 'one', from: '2026-09-06', to: '2026-10-05', days: rows });
  assert.deepEqual(seen.args, ['one', '2026-09-06', '2026-10-05']);
  assert.match(seen.sql, /SUM\(first\) AS visitors, COUNT\(\*\) AS hits/);
  assert.match(seen.sql, /event IS NULL GROUP BY day ORDER BY day/);
  for (const bad of [' ts', 'country', 'browser', 'width', 'path']) assert.ok(!seen.sql.includes(bad), bad);
});

test('yesterday by page: the pageviews of each page up to this time yesterday', async () => {
  const answers = [];
  answers[10] = [{ path: '/', hits: 7 }, { path: '/map/', hits: 2 }];
  const db = fakeDb(answers);
  const out = await scene(db, { site: 'one', now: NOW });
  assert.deepEqual(out.yesterday.pages, answers[10]);
  const yesterdayPages = d => d.seen.find(st => st.sql.includes('GROUP BY path ORDER BY hits DESC, path') && st.args.length === 3);
  const st = yesterdayPages(db);
  assert.deepEqual(st.args, ['one', '2026-10-04', Math.floor(NOW / 1000) - 86400]);
  assert.match(st.sql, /event IS NULL/);   // pageviews, not events
  assert.match(st.sql, /GROUP BY path ORDER BY hits DESC, path LIMIT 200/);
  for (const bad of ['first', 'country', 'browser', 'width']) assert.ok(!st.sql.includes(bad), bad);
  /* a past day: the whole day before it */
  const past = fakeDb([]);
  await scene(past, { site: 'one', day: '2026-09-20', now: NOW });
  assert.deepEqual(yesterdayPages(past).args, ['one', '2026-09-19', Date.parse('2026-09-20') / 1000 - 1]);
});
