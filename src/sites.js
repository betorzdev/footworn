/* The Sites panel's writes (PUT and DELETE /api/site, POST and DELETE /api/icon): a site checked
   and saved, a site removed with its hits, its icon fetched from its own page or kept from a
   file. What `tools/site-add.js` and `tools/site-icon.js` do from the shell, for the dashboard.
   Nothing here is about a visitor: a site's row is its owner's configuration (docs/privacy.md). */

import { STYLES, findIcons, iconType, ICON_MAX } from './icon.js';
import { readCapped } from './body.js';

export const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;   // what `data-site` carries: never changed once pages carry it
const NAME_MAX = 80, ORIGINS_MAX = 20;
const PAGE_MAX = 512 * 1024;   // how much of a site's page is read for its <link rel="icon">: its head is in there
export const LOOK = { tint: [1, 8], hue: [0, 359], shade: [-40, 40] };   // the range of each number of a look

/* A posted site → { site } ready for `saveSite`, or { error } to show the owner. `origins` is an
   array or a space-separated string; each becomes an http(s) Origin (scheme, host, port), as
   pasted from the address bar too ("https://Site.example/" is "https://site.example"), but never
   from a URL with a path, a query or credentials. The look's numbers may be null, never out of range. */
export function validateSite(body) {
  if (!body || typeof body !== 'object') return { error: 'a site is a JSON object' };
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!ID.test(id)) return { error: 'id: lowercase letters, digits, - and _, 64 at most, starting with a letter or a digit' };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > NAME_MAX) return { error: `name: 1 to ${NAME_MAX} characters` };
  const list = Array.isArray(body.origins) ? body.origins : typeof body.origins === 'string' ? body.origins.split(/\s+/) : [];
  const given = list.map(o => String(o).trim()).filter(Boolean), origins = [];
  if (!given.length) return { error: 'origins: at least one, like https://your-site.example' };
  for (const o of given) {
    let u;
    try { u = new URL(o); } catch (e) { return { error: `origins: "${o}" is not a URL` }; }
    if (!/^https?:$/.test(u.protocol) || u.pathname !== '/' || u.search || u.hash || u.username || u.password || o.includes('?') || o.includes('#'))
      return { error: `origins: "${o}" is not an origin (scheme://host[:port], no path, http or https)` };
    if (!origins.includes(u.origin)) origins.push(u.origin);
  }
  if (origins.length > ORIGINS_MAX) return { error: `origins: ${ORIGINS_MAX} at most` };
  const style = body.style == null || body.style === '' ? null : body.style;
  if (style !== null && !STYLES.includes(style)) return { error: `style: one of ${STYLES.join(', ')}` };
  const look = {};
  for (const k of Object.keys(LOOK)) {
    const v = body[k], [lo, hi] = LOOK[k];
    if (v == null || v === '') { look[k] = null; continue; }
    if (!Number.isInteger(v) || v < lo || v > hi) return { error: `${k}: a whole number from ${lo} to ${hi}` };
    look[k] = v;
  }
  return { site: { id, name, origins: origins.join(' '), style, ...look } };
}

/* A new site (`create`): inserted, or false when the id is taken, so a stale list in the dashboard
   never overwrites a site it did not know of. Otherwise the site is updated (everything but its
   icon), or inserted if it is gone. */
export async function saveSite(db, s, { create = false } = {}) {
  if (create) {
    const r = await db.prepare('INSERT INTO sites (id, name, origins, style, tint, hue, shade) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO NOTHING')
      .bind(s.id, s.name, s.origins, s.style, s.tint, s.hue, s.shade).run();
    return !!(r && r.meta && r.meta.changes);
  }
  await db.prepare(`INSERT INTO sites (id, name, origins, style, tint, hue, shade) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                     ON CONFLICT(id) DO UPDATE SET name = excluded.name, origins = excluded.origins, style = excluded.style,
                                                   tint = excluded.tint, hue = excluded.hue, shade = excluded.shade`)
    .bind(s.id, s.name, s.origins, s.style, s.tint, s.hue, s.shade).run();
  return true;
}

/* The site and everything counted for it: without the site nobody could read its hits. A busy
   site's hits go in rounds, each well inside a query's limits; the site itself goes last, with
   whatever came in meanwhile, so a removal cut short leaves it there to be removed again. */
export const REMOVE_CHUNK = 5000;
export async function removeSite(db, id) {
  for (;;) {
    const r = await db.prepare(`DELETE FROM hits WHERE id IN (SELECT id FROM hits WHERE site = ? LIMIT ${REMOVE_CHUNK})`).bind(id).run();
    if (!r || !r.meta || r.meta.changes < REMOVE_CHUNK) break;
  }
  return db.batch([
    db.prepare('DELETE FROM hits WHERE site = ?').bind(id),
    db.prepare('DELETE FROM seen WHERE site = ?').bind(id),
    db.prepare('DELETE FROM sites WHERE id = ?').bind(id),
  ]);
}

export async function siteRow(db, id) {
  return db.prepare('SELECT id, name, origins FROM sites WHERE id = ?').bind(id).first();
}

/* The page's icon, as `tools/site-icon.js` finds it: its <link rel="icon"> (the largest up to
   256 px), then /favicon.ico, the first that is a PNG, ICO or JPEG of 40 KB or less. `fetchFn`
   is the platform's fetch (or a stand-in in the tests). { bytes, type, url }, or null. */
export async function fetchIcon(fetchFn, page) {
  let html = '', base = page;
  try {
    const r = await fetchFn(page, { redirect: 'follow', headers: { Accept: 'text/html' } });
    if (r.ok) { html = (await readCapped(r, PAGE_MAX, { head: true })) || ''; base = r.url || page; }   // the links are in its head: a long page is read that far
  } catch (e) { /* no page: /favicon.ico is still worth a try */ }
  for (const url of findIcons(html, base)) {
    try {
      const r = await fetchFn(url, { redirect: 'follow' });
      if (!r.ok) continue;
      const bytes = await readCapped(r, ICON_MAX, { bytes: true });
      const type = bytes && iconType(bytes);
      if (type) return { bytes, type, url };
    } catch (e) { /* the next candidate */ }
  }
  return null;
}

/* The icon as kept: an ArrayBuffer of its own, the shape D1 stores as a BLOB. */
export function keepIcon(db, id, bytes, type) {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return db.prepare('UPDATE sites SET icon = ?, icon_type = ? WHERE id = ?').bind(buf, type, id).run();
}

export function dropIcon(db, id) {
  return db.prepare('UPDATE sites SET icon = NULL, icon_type = NULL WHERE id = ?').bind(id).run();
}

/* A page URL the owner gave for the icon: http(s) only, or null. */
export function pageUrl(s) {
  try { const u = new URL(String(s)); return /^https?:$/.test(u.protocol) ? u.href : null; } catch (e) { return null; }
}
