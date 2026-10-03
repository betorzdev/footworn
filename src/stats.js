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

/* What the snowfield draws for one site, all of it counts:
   - `pages`, `refs`: the 30-day top 8 pages (standing stones) and top 5 referrers (gates);
   - `wear`: 30-day pageviews per (referrer, page), the trodden paths;
   - `today`: totals, and pageviews and events per page and per referrer;
   - `yesterday`: visitors yesterday up to this time of day, for the change in the valley;
   - `recent`: today's last 3 hours in 10-minute blocks per page, referrer, device and first,
     newest first (past the limit the oldest go), which the page turns back into footprints when
     it opens. No country here: that only comes with a live hit (src/live.js). */
export async function scene(db, { site, now = Date.now() }) {
  const today = new Date(now).toISOString().slice(0, 10), from = addDays(today, -29), yesterday = addDays(today, -1);
  const secs = Math.floor(now / 1000);
  const month = 'site = ?1 AND day BETWEEN ?2 AND ?3 AND event IS NULL';
  const m = sql => db.prepare(sql).bind(site, from, today);
  const d = sql => db.prepare(sql).bind(site, today);
  const rows = await db.batch([
    m(`SELECT path AS value, COUNT(*) AS hits FROM hits WHERE ${month} GROUP BY path ORDER BY hits DESC LIMIT 8`),
    m(`SELECT ref AS value, COUNT(*) AS hits FROM hits WHERE ${month} AND ref IS NOT NULL GROUP BY ref ORDER BY hits DESC LIMIT 5`),
    m(`SELECT ref, path, COUNT(*) AS hits FROM hits WHERE ${month} GROUP BY ref, path ORDER BY hits DESC LIMIT 400`),
    d(`SELECT SUM(event IS NULL) AS hits, SUM(first) AS visitors, SUM(event IS NOT NULL) AS events FROM hits WHERE site = ?1 AND day = ?2`),
    d(`SELECT path, SUM(event IS NULL) AS hits, SUM(event IS NOT NULL) AS events FROM hits
       WHERE site = ?1 AND day = ?2 GROUP BY path ORDER BY hits DESC LIMIT 200`),
    d(`SELECT ref, COUNT(*) AS hits FROM hits WHERE site = ?1 AND day = ?2 AND event IS NULL GROUP BY ref ORDER BY hits DESC LIMIT 200`),
    db.prepare(`SELECT SUM(first) AS visitors FROM hits WHERE site = ?1 AND day = ?2 AND ts <= ?3 AND event IS NULL`).bind(site, yesterday, secs - 86400),
    db.prepare(`SELECT (ts / 600) * 600 AS block, path, ref, device, first, COUNT(*) AS hits FROM hits
                WHERE site = ?1 AND day = ?2 AND ts > ?3 AND event IS NULL
                GROUP BY block, path, ref, device, first ORDER BY block DESC LIMIT 3000`).bind(site, today, secs - 3 * 3600),
  ]);
  const res = rows.map(r => r.results || []);
  const t = res[3][0] || {};
  return {
    site, day: today, now: secs,
    pages: res[0], refs: res[1], wear: res[2],
    today: { hits: t.hits || 0, visitors: t.visitors || 0, events: t.events || 0, pages: res[4], refs: res[5] },
    yesterday: { visitors: (res[6][0] && res[6][0].visitors) || 0 },
    recent: res[7],
  };
}
