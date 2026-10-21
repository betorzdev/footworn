import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { ZONE, offsetAt, dayOf, dayStart, fromWall, HOUR_SQL } from '../src/clock.js';

/* The time zone data's answer, to hold the hand-made rule to. */
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
function wall(secs) { const p = {}; for (const x of fmt.formatToParts(secs * 1000)) p[x.type] = x.value; return { day: `${p.year}-${p.month}-${p.day}`, hour: +p.hour }; }

/* Every hour from 2024 to 2030, and the minutes either side of each change. */
const FROM = Date.UTC(2024, 0, 1) / 1000, TO = Date.UTC(2031, 0, 1) / 1000;
const moments = [];
for (let t = FROM; t < TO; t += 3600) moments.push(t, t + 1800);
for (let y = 2024; y <= 2030; y++) for (const m of [2, 9]) {
  const end = new Date(Date.UTC(y, m + 1, 0)), change = Date.UTC(y, m + 1, -end.getUTCDay(), 1) / 1000;
  moments.push(change - 1, change, change + 1);
}

test("the rule is Madrid's, as the time zone data has it", () => {
  for (const t of moments) {
    const w = wall(t);
    assert.equal(dayOf(t), w.day, `day at ${t}`);
    assert.equal(new Date((t + offsetAt(t)) * 1000).getUTCHours(), w.hour, `hour at ${t}`);
  }
});

test("a day starts at Madrid's midnight, summer and winter", () => {
  assert.equal(dayStart('2026-10-21'), Date.UTC(2026, 9, 20, 22) / 1000);
  assert.equal(dayStart('2026-12-01'), Date.UTC(2026, 10, 30, 23) / 1000);
  assert.equal(dayStart('2026-03-29'), Date.UTC(2026, 2, 28, 23) / 1000);   // the day the clocks go forward
  assert.equal(dayStart('2026-10-26'), Date.UTC(2026, 9, 25, 23) / 1000);   // the day after they go back
  assert.equal(dayOf(dayStart('2026-10-21')), '2026-10-21');
  assert.equal(dayOf(dayStart('2026-10-21') - 1), '2026-10-20');
  /* a wall-clock time: 10:00 on the day the clocks go back is 25 hours after 10:00 the day before */
  assert.equal(fromWall(Date.UTC(2026, 9, 25, 10) / 1000) - fromWall(Date.UTC(2026, 9, 24, 10) / 1000), 25 * 3600);
});

test('the dashboard keeps the same clock', () => {
  const window = {};
  vm.runInNewContext(readFileSync(new URL('../public/clock.js', import.meta.url), 'utf8'), { window });
  for (const t of moments) {
    assert.equal(window.FootwornClock.day(t * 1000), dayOf(t), `day at ${t}`);
    assert.equal(window.FootwornClock.wall(t * 1000).getUTCHours(), wall(t).hour, `hour at ${t}`);
  }
});

/* The SQL, run on SQLite itself: D1 is SQLite. */
function hitsDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE hits (ts INTEGER NOT NULL, day TEXT NOT NULL)');
  const put = db.prepare('INSERT INTO hits (ts, day) VALUES (?, ?)');
  for (const t of moments) put.run(t, 'utc');
  return db;
}

test("HOUR_SQL reads Madrid's hour from ts", () => {
  const db = hitsDb();
  const rows = db.prepare(`SELECT ts, ${HOUR_SQL} AS hour FROM hits`).all();
  for (const r of rows) assert.equal(r.hour, wall(r.ts).hour, `hour at ${r.ts}`);
});

test("the migration gives every kept hit its Madrid day", () => {
  const db = hitsDb();
  db.exec(readFileSync(new URL('../migrations/0005_madrid_days.sql', import.meta.url), 'utf8'));
  for (const r of db.prepare('SELECT ts, day FROM hits').all()) assert.equal(r.day, dayOf(r.ts), `day at ${r.ts}`);
});
