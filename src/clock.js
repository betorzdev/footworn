/* Footworn's days are Spain's: a day runs from midnight to midnight in Madrid, summer time
   included, and an hour of the day is Madrid's hour. Everything that cuts by day or by hour asks
   here. Madrid is UTC+1, and UTC+2 from the last Sunday of March to the last Sunday of October,
   both changes at 01:00 UTC (the EU's rule since 1996, Directive 2000/84/EC). Worked out by hand,
   not through Intl, so the SQL below can carry it: a test checks it against the time zone data.
   public/clock.js is the same rule for the dashboard. */

export const ZONE = 'Europe/Madrid';
const HOUR = 3600;

/* The last Sunday of `month` (0-based) in `year`, at 01:00 UTC, in unix seconds. */
function lastSunday(year, month) {
  const end = new Date(Date.UTC(year, month + 1, 0));
  return Date.UTC(year, month + 1, -end.getUTCDay(), 1) / 1000;
}

/* Summer time in `year`: [start, end) in unix seconds. */
function summer(year) { return [lastSunday(year, 2), lastSunday(year, 9)]; }

/* Madrid's offset from UTC at `secs`, in seconds. */
export function offsetAt(secs) {
  const [a, b] = summer(new Date(secs * 1000).getUTCFullYear());
  return secs >= a && secs < b ? 2 * HOUR : HOUR;
}

/* The Madrid day ("2026-10-01") of the moment `secs`. */
export function dayOf(secs) {
  return new Date((secs + offsetAt(secs)) * 1000).toISOString().slice(0, 10);
}

/* The moment, in unix seconds, Madrid's wall clock reads `wall` (unix seconds as if Madrid were
   UTC). In the hour the clocks skip it lands an hour on; in the hour they repeat, on the second. */
export function fromWall(wall) { return wall - offsetAt(wall - offsetAt(wall)); }

/* Madrid's midnight that starts `day`, in unix seconds. */
export function dayStart(day) { return fromWall(Date.parse(day) / 1000); }

/* SQL for the Madrid hour (0-23) of a row's `ts`: the same rule, worked out from the row's own
   year (from the 25th of March or October, 'weekday 0' lands on that month's last Sunday), so
   it is as long whatever the range. migrations/0005_madrid_days.sql spells out the same. */
const change = month => `CAST(strftime('%s', date(strftime('%Y', ts, 'unixepoch') || '-${month}-25', 'weekday 0')) AS INTEGER) + ${HOUR}`;
export const HOUR_SQL = `CAST(strftime('%H', ts + CASE WHEN ts >= ${change('03')} AND ts < ${change('10')} THEN ${2 * HOUR} ELSE ${HOUR} END, 'unixepoch') AS INTEGER)`;
