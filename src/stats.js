/* The dashboard's reads. Every answer is a count per day or per value of one dimension, never a
   list of hits: what the AEPD's guide calls "por página y agregadas diariamente". */

const TOP = 30;

export async function sites(db) {
  const r = await db.prepare('SELECT id, name FROM sites ORDER BY name').all();
  return r.results || [];
}

const DIMS = ['path', 'ref', 'browser', 'os', 'device', 'country', 'lang'];

const DAY_MS = 86400000;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY_MS).toISOString().slice(0, 10);

/* Totals, by day, each dimension's top values, the events, and three profiles the dashboard
   draws as columns: hour of the day (UTC; the dashboard shifts it), weekday (SQLite's %w, 0 is
   Sunday) and screen width in 100 px buckets. `previous` is the same totals for the period of
   the same length just before, for the change under each total. */
export async function stats(db, { site, from, to }) {
  const where = 'site = ?1 AND day BETWEEN ?2 AND ?3';
  const q = sql => db.prepare(sql).bind(site, from, to);
  const dim = d => q(`SELECT ${d} AS value, COUNT(*) AS hits, SUM(first) AS visitors FROM hits
                      WHERE ${where} AND event IS NULL AND ${d} IS NOT NULL
                      GROUP BY ${d} ORDER BY hits DESC LIMIT ${TOP}`);
  const pages = `SELECT COUNT(*) AS hits, SUM(first) AS visitors FROM hits WHERE ${where} AND event IS NULL`;
  const events = `SELECT COUNT(*) AS events FROM hits WHERE ${where} AND event IS NOT NULL`;
  const len = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
  const previous = { from: addDays(from, -len), to: addDays(from, -1) };
  const pq = sql => db.prepare(sql).bind(site, previous.from, previous.to);
  const rows = await db.batch([
    q(pages),
    q(events),
    q(`SELECT day, SUM(event IS NULL) AS hits, SUM(first) AS visitors, SUM(event IS NOT NULL) AS events
       FROM hits WHERE ${where} GROUP BY day ORDER BY day`),
    ...DIMS.map(dim),
    q(`SELECT event AS value, COUNT(*) AS hits FROM hits
       WHERE ${where} AND event IS NOT NULL GROUP BY event ORDER BY hits DESC LIMIT ${TOP}`),
    q(`SELECT CAST(strftime('%H', ts, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS hits FROM hits
       WHERE ${where} AND event IS NULL GROUP BY hour ORDER BY hour`),
    q(`SELECT CAST(strftime('%w', day) AS INTEGER) AS weekday, COUNT(*) AS hits FROM hits
       WHERE ${where} AND event IS NULL GROUP BY weekday ORDER BY weekday`),
    q(`SELECT (width / 100) * 100 AS bucket, COUNT(*) AS hits FROM hits
       WHERE ${where} AND event IS NULL AND width IS NOT NULL GROUP BY bucket ORDER BY bucket`),
    pq(pages),
    pq(events),
  ]);
  const res = rows.map(r => r.results || []);
  const totals = (p, e) => ({ hits: p[0].hits || 0, visitors: p[0].visitors || 0, events: e[0].events || 0 });
  const out = { site, from, to, totals: totals(res[0], res[1]), days: res[2] };
  DIMS.forEach((d, i) => { out[d] = res[3 + i]; });
  let i = 3 + DIMS.length;
  out.events = res[i++];
  out.hours = res[i++];
  out.weekdays = res[i++];
  out.widths = res[i++];
  out.previous = { ...previous, ...totals(res[i], res[i + 1]) };
  return out;
}

/* One event: by day, by page, and each property's values. */
export async function eventStats(db, { site, name, from, to }) {
  const where = 'site = ?1 AND event = ?2 AND day BETWEEN ?3 AND ?4';
  const q = sql => db.prepare(sql).bind(site, name, from, to);
  const rows = await db.batch([
    q(`SELECT COUNT(*) AS hits FROM hits WHERE ${where}`),
    q(`SELECT day, COUNT(*) AS hits FROM hits WHERE ${where} GROUP BY day ORDER BY day`),
    q(`SELECT path AS value, COUNT(*) AS hits FROM hits WHERE ${where} GROUP BY path ORDER BY hits DESC LIMIT ${TOP}`),
    q(`SELECT je.key AS key, je.value AS value, COUNT(*) AS hits FROM hits, json_each(hits.props) AS je
       WHERE ${where} GROUP BY je.key, je.value ORDER BY je.key, hits DESC`),
  ]);
  const res = rows.map(r => r.results || []);
  const props = {};
  for (const r of res[3]) (props[r.key] = props[r.key] || []).push({ value: r.value, hits: r.hits });
  return { site, name, from, to, totals: res[0][0], days: res[1], paths: res[2], props };
}
