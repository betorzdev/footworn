import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256, saltFor, firstToday } from '../src/visitor.js';

/* A D1 stand-in with just what visitor.js uses: meta and seen. */
function fakeDb() {
  const meta = new Map(), seen = new Set();
  const stmt = sql => ({
    bind: (...args) => ({
      all: async () => ({ results: [...meta].map(([key, value]) => ({ key, value })).filter(r => args.includes(r.key)) }),
      run: async () => {
        if (sql.startsWith('INSERT OR IGNORE INTO seen')) {
          const k = args[0] + '|' + args[1];
          const had = seen.has(k); seen.add(k);
          return { meta: { changes: had ? 0 : 1 } };
        }
        if (sql.startsWith('INSERT INTO meta')) { meta.set(args[0], args[1]); return { meta: { changes: 1 } }; }
        throw new Error('unexpected ' + sql);
      },
    }),
    run: async () => { if (sql === 'DELETE FROM seen') seen.clear(); return {}; },
  });
  return {
    meta, seen,
    prepare: stmt,
    batch: async stmts => Promise.all(stmts.map(s => (s.bind ? s.run() : s.run()))),
  };
}

test('sha256 is hex and stable', async () => {
  assert.equal(await sha256('a'), 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
});

test('salt lives for a day and rotation forgets the hashes', async () => {
  const db = fakeDb();
  const s1 = await saltFor(db, '2026-10-01');
  assert.equal(s1.length, 64);
  assert.equal(await saltFor(db, '2026-10-01'), s1);
  const v = { day: '2026-10-01', site: 'x', ip: '1.2.3.4', ua: 'UA' };
  assert.equal(await firstToday(db, v), 1);
  assert.equal(await firstToday(db, v), 0);
  assert.equal(await firstToday(db, { ...v, ip: '5.6.7.8' }), 1);
  const s2 = await saltFor(db, '2026-10-02');
  assert.notEqual(s2, s1);
  assert.equal(db.seen.size, 0);
  assert.equal(await firstToday(db, { ...v, day: '2026-10-02' }), 1);
});
