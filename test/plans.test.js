import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { stats, eventStats, scene, used, days, visits } from '../src/stats.js';

/* D1 bills every row a query reads, and the dashboard left open asks again and again: each read
   of `hits` has to be held to its days by an index, never to every row the site ever had. The
   statements are the API's own, planned by SQLite on the schema the migrations build (D1 keeps
   no statistics, and neither does this). */
const sqlite = new DatabaseSync(':memory:');
for (const f of readdirSync(new URL('../migrations/', import.meta.url)).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));

/* A D1 stand-in that keeps every statement and answers one empty row. */
function recorder() {
  const seen = [];
  const st = (sql, args) => ({ sql, args, first: async () => null, all: async () => ({ results: [] }) });
  return {
    seen,
    prepare(sql) { return { bind(...args) { const s = st(sql, args); seen.push(s); return s; } }; },
    batch: async list => list.map(() => ({ results: [{}] })),
  };
}

const NOW = Date.UTC(2026, 9, 5, 12, 0, 30);
const range = { site: 'one', from: '2026-09-06', to: '2026-10-05' };

test('every read of hits is held to its days by an index', async () => {
  const db = recorder();
  await stats(db, range);
  await eventStats(db, { ...range, name: 'copy' });
  await scene(db, { site: 'one', now: NOW });
  await used(db, { site: 'one', now: NOW });
  await days(db, range);
  await visits(db, { site: 'one', now: NOW });
  assert.ok(db.seen.length > 30);
  for (const { sql, args } of db.seen) {
    const plan = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map(r => r.detail);
    const reads = plan.filter(d => /^(SCAN|SEARCH) hits\b/.test(d));
    assert.ok(reads.length, sql);
    /* the day `$engaged` started: the first entry of (site, event, day), one row */
    if (/MIN\(day\)/.test(sql)) { assert.deepEqual(reads, ['SEARCH hits USING COVERING INDEX hits_site_event (site=? AND event=?)']); continue; }
    for (const d of reads) assert.match(d, /^SEARCH hits USING .*\bday[=><]/, `${d}\n${sql}`);
  }
});
