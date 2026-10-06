/* The dashboard's reads. Every answer is a count per day or per value of one dimension (what the
   AEPD's guide calls "por página y agregadas diariamente"), with one exception, `visits`: today's
   visits one by one, rounded so that a row is not a fingerprint (docs/privacy.md). */

const TOP = 30;
const SCENE = 200;   // the village draws every page, referrer and view, of the month and of today: each list is cut here for safety

export async function sites(db) {
  const r = await db.prepare('SELECT id, name FROM sites ORDER BY name').all();
  return r.results || [];
}

const DIMS = ['path', 'ref', 'browser', 'os', 'device', 'country', 'lang'];

/* The site's own events, and the tracker's `$engaged` (a load where the page was used, not just
   opened: src/collect.js). `$engaged` is never an event on the dashboard, only the "used" rate. */
const USER = "(event IS NOT NULL AND event NOT LIKE '$%')";
const ENGAGED = "(event IS '$engaged')";  // IS, not =: 0 on a pageview, never NULL

/* The "used" rate counts only pageviews since the tracker first sent `$engaged` for this site:
   `loads`. Older pageviews could never have one, and would dilute the rate. Returns the SQL
   expression; a site that never sent one has no loads, and so no rate. */
async function loadsSince(db, site) {
  const first = await db.prepare(`SELECT MIN(day) AS day FROM hits WHERE site = ?1 AND event = '$engaged'`).bind(site).first();
  const since = first && /^\d{4}-\d{2}-\d{2}$/.test(first.day) ? first.day : '9999-12-31';  // spliced into SQL: a day or nothing
  return `(event IS NULL AND day >= '${since}')`;
}

const DAY_MS = 86400000;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY_MS).toISOString().slice(0, 10);
const realDay = iso => { const t = Date.parse(iso); return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === iso; };   // no 31st of February

/* Totals, by day, each dimension's top values (pages with how many of their loads were used),
   the events, and three profiles the dashboard
   draws as columns: hour of the day (UTC; the dashboard shifts it), weekday (SQLite's %w, 0 is
   Sunday) and screen width in 100 px buckets. `previous` is the same totals for the period of
   the same length just before, for the change under each total. */
export async function stats(db, { site, from, to }) {
  const LOADS = await loadsSince(db, site);
  const where = 'site = ?1 AND day BETWEEN ?2 AND ?3';
  const q = sql => db.prepare(sql).bind(site, from, to);
  const dim = d => d === 'path'
    ? q(`SELECT path AS value, SUM(event IS NULL) AS hits, SUM(first) AS visitors, SUM(${LOADS}) AS loads, SUM(${ENGAGED}) AS engaged FROM hits
         WHERE ${where} AND (event IS NULL OR ${ENGAGED})
         GROUP BY path HAVING hits > 0 ORDER BY hits DESC LIMIT ${TOP}`)
    : q(`SELECT ${d} AS value, COUNT(*) AS hits, SUM(first) AS visitors FROM hits
                      WHERE ${where} AND event IS NULL AND ${d} IS NOT NULL
                      GROUP BY ${d} ORDER BY hits DESC LIMIT ${TOP}`);
  const pages = `SELECT COUNT(*) AS hits, SUM(first) AS visitors, SUM(${LOADS}) AS loads FROM hits WHERE ${where} AND event IS NULL`;
  const events = `SELECT SUM(${USER}) AS events, SUM(${ENGAGED}) AS engaged FROM hits WHERE ${where} AND event IS NOT NULL`;
  const len = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS) + 1;
  const previous = { from: addDays(from, -len), to: addDays(from, -1) };
  const pq = sql => db.prepare(sql).bind(site, previous.from, previous.to);
  const rows = await db.batch([
    q(pages),
    q(events),
    q(`SELECT day, SUM(event IS NULL) AS hits, SUM(first) AS visitors, SUM(${USER}) AS events, SUM(${ENGAGED}) AS engaged
       FROM hits WHERE ${where} GROUP BY day ORDER BY day`),
    ...DIMS.map(dim),
    q(`SELECT event AS value, COUNT(*) AS hits FROM hits
       WHERE ${where} AND ${USER} GROUP BY event ORDER BY hits DESC LIMIT ${TOP}`),
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
  const totals = (p, e) => ({ hits: p[0].hits || 0, visitors: p[0].visitors || 0, events: e[0].events || 0, loads: p[0].loads || 0, engaged: e[0].engaged || 0 });
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

/* What the village draws for one site, all of it counts:
   - `pages`, `refs`: every page of the last 30 days (its houses, in a fixed order: the busiest
     first) and every referrer (its gates, plus direct), each list cut at 200;
   - `views`: every view opened inside a page in the last 30 days (a `screen` event with a
     `view`), the stalls of its market, in a fixed order, cut at 200;
   - `today`: totals (`viewsTotal` is every view opened: they are events too, and inside `events`), and per page its pageviews, `loads` and used loads (`engaged`, the used
     rate is engaged / loads, as in `stats`) and events, pageviews per referrer, `views`: how
     many times each view was opened, and `viewPages`: from which pages (the top 200 pairs, for
     the stall's tooltip; the counts are the ones in `views`);
   - `yesterday`: visitors yesterday up to this time of day, for the change on the sign, and
     the pageviews of each page up to then (`pages`, cut at 200), for the mark on its house;
   - `hours`: pageviews by UTC hour, today and yesterday, for the day's rhythm.
   With a `day` before today (`past` in the answer) it is the village as that day ended: "today"
   is that day, the 30 days are the ones that end on it, and "yesterday" the whole day before. */
export async function scene(db, { site, day, now = Date.now() }) {
  const utc = new Date(now).toISOString().slice(0, 10), past = !!day && realDay(day) && day < utc;   // a day that is no date is today
  const today = past ? day : utc, from = addDays(today, -29), yesterday = addDays(today, -1);
  const secs = Math.floor(now / 1000), LOADS = await loadsSince(db, site);
  const until = past ? Date.parse(today) / 1000 - 1 : secs - 86400;   // yesterday's last second, or this time yesterday
  const month = 'site = ?1 AND day BETWEEN ?2 AND ?3 AND event IS NULL';
  const VIEW = "event = 'screen' AND json_type(props, '$.view') = 'text'";  // a `view` that is not text is no view
  const m = sql => db.prepare(sql).bind(site, from, today);
  const d = sql => db.prepare(sql).bind(site, today);
  const rows = await db.batch([
    m(`SELECT path AS value, COUNT(*) AS hits FROM hits WHERE ${month} GROUP BY path ORDER BY hits DESC LIMIT ${SCENE}`),
    m(`SELECT ref AS value, COUNT(*) AS hits FROM hits WHERE ${month} AND ref IS NOT NULL GROUP BY ref ORDER BY hits DESC LIMIT ${SCENE}`),
    d(`SELECT SUM(event IS NULL) AS hits, SUM(first) AS visitors, SUM(${USER}) AS events, SUM(${VIEW}) AS views, SUM(${LOADS}) AS loads, SUM(${ENGAGED}) AS engaged FROM hits
       WHERE site = ?1 AND day = ?2`),
    d(`SELECT path, SUM(event IS NULL) AS hits, SUM(${LOADS}) AS loads, SUM(${ENGAGED}) AS engaged, SUM(${USER}) AS events FROM hits
       WHERE site = ?1 AND day = ?2 GROUP BY path HAVING hits > 0 OR events > 0 ORDER BY hits DESC LIMIT ${SCENE}`),
    d(`SELECT ref, COUNT(*) AS hits FROM hits WHERE site = ?1 AND day = ?2 AND event IS NULL GROUP BY ref ORDER BY hits DESC LIMIT ${SCENE}`),
    db.prepare(`SELECT SUM(first) AS visitors FROM hits WHERE site = ?1 AND day = ?2 AND ts <= ?3 AND event IS NULL`).bind(site, yesterday, until),
    db.prepare(`SELECT day, CAST(strftime('%H', ts, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS hits FROM hits
                WHERE site = ?1 AND day IN (?2, ?3) AND event IS NULL GROUP BY day, hour`).bind(site, today, yesterday),
    m(`SELECT json_extract(props, '$.view') AS value, COUNT(*) AS hits FROM hits
       WHERE site = ?1 AND day BETWEEN ?2 AND ?3 AND ${VIEW} GROUP BY value ORDER BY hits DESC, value LIMIT ${SCENE}`),
    d(`SELECT json_extract(props, '$.view') AS view, COUNT(*) AS hits FROM hits
       WHERE site = ?1 AND day = ?2 AND ${VIEW} GROUP BY view ORDER BY hits DESC, view LIMIT ${SCENE}`),
    d(`SELECT path, json_extract(props, '$.view') AS view, COUNT(*) AS hits FROM hits
       WHERE site = ?1 AND day = ?2 AND ${VIEW} GROUP BY path, view ORDER BY hits DESC, path, view LIMIT ${SCENE}`),
    db.prepare(`SELECT path, COUNT(*) AS hits FROM hits WHERE site = ?1 AND day = ?2 AND ts <= ?3 AND event IS NULL
                GROUP BY path ORDER BY hits DESC, path LIMIT ${SCENE}`).bind(site, yesterday, until),
  ]);
  const res = rows.map(r => r.results || []);
  const t = res[2][0] || {};
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, today: 0, yesterday: 0 }));
  for (const r of res[6]) if (r.hour >= 0 && r.hour < 24) hours[r.hour][r.day === today ? 'today' : 'yesterday'] = r.hits;
  return {
    site, day: today, now: secs, past,
    pages: res[0], refs: res[1], views: res[7],
    today: { hits: t.hits || 0, visitors: t.visitors || 0, events: t.events || 0, viewsTotal: t.views || 0, loads: t.loads || 0, engaged: t.engaged || 0, pages: res[3], refs: res[4], views: res[8], viewPages: res[9] },
    yesterday: { visitors: (res[5][0] && res[5][0].visitors) || 0, pages: res[10] },
    hours,
  };
}

/* Visitors and pageviews day by day: the bars of the dashboard's history strip. A day with no
   pageview has no row. */
export async function days(db, { site, from, to }) {
  const r = await db.prepare(`SELECT day, SUM(first) AS visitors, COUNT(*) AS hits FROM hits
                              WHERE site = ?1 AND day BETWEEN ?2 AND ?3 AND event IS NULL GROUP BY day ORDER BY day`).bind(site, from, to).all();
  return { site, from, to, days: r.results || [] };
}

/* Today's visits, newest first: the one list the API gives. Rounded on the way out, so a row does
   not single anyone out: the minute, not the second; the device class, not the width; browser and
   system families; no id, so nothing joins two rows into a journey (which is why `$engaged`,
   seconds after its own pageview, is left out). Today only (UTC): at
   midnight the list empties, as the snowfield does. */
export async function visits(db, { site, now = Date.now() }) {
  const today = new Date(now).toISOString().slice(0, 10);
  const r = await db.prepare(`SELECT (ts / 60) * 60 AS minute, path, ref, device, browser, os, lang, country, first, event, props
                              FROM hits WHERE site = ?1 AND day = ?2 AND (event IS NULL OR ${USER})
                              ORDER BY ts DESC LIMIT 2000`).bind(site, today).all();
  return {
    site, day: today, now: Math.floor(now / 1000),
    visits: (r.results || []).map(v => {
      let props = null;
      if (v.props) { try { props = JSON.parse(v.props); } catch (e) { props = null; } }
      return { ...v, first: v.first ? 1 : 0, props };
    }),
  };
}
