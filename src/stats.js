/* The dashboard's reads. Every answer is a count per day or per value of one dimension, never a
   list of hits: what the AEPD's guide calls "por página y agregadas diariamente". */

const TOP = 30;

export async function sites(db) {
  const r = await db.prepare('SELECT id, name FROM sites ORDER BY name').all();
  return r.results || [];
}

const DIMS = ['path', 'ref', 'browser', 'os', 'device', 'country', 'lang'];

export async function stats(db, { site, from, to }) {
  const where = 'site = ?1 AND day BETWEEN ?2 AND ?3';
  const q = sql => db.prepare(sql).bind(site, from, to);
  const dim = d => q(`SELECT ${d} AS value, COUNT(*) AS hits, SUM(first) AS visitors FROM hits
                      WHERE ${where} AND event IS NULL AND ${d} IS NOT NULL
                      GROUP BY ${d} ORDER BY hits DESC LIMIT ${TOP}`);
  const rows = await db.batch([
    q(`SELECT COUNT(*) AS hits, SUM(first) AS visitors FROM hits WHERE ${where} AND event IS NULL`),
    q(`SELECT COUNT(*) AS events FROM hits WHERE ${where} AND event IS NOT NULL`),
    q(`SELECT day, SUM(event IS NULL) AS hits, SUM(first) AS visitors, SUM(event IS NOT NULL) AS events
       FROM hits WHERE ${where} GROUP BY day ORDER BY day`),
    ...DIMS.map(dim),
    q(`SELECT event AS value, COUNT(*) AS hits FROM hits
       WHERE ${where} AND event IS NOT NULL GROUP BY event ORDER BY hits DESC LIMIT ${TOP}`),
  ]);
  const res = rows.map(r => r.results || []);
  const out = {
    site, from, to,
    totals: { hits: res[0][0].hits || 0, visitors: res[0][0].visitors || 0, events: res[1][0].events || 0 },
    days: res[2],
  };
  DIMS.forEach((d, i) => { out[d] = res[3 + i]; });
  out.events = res[3 + DIMS.length];
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
