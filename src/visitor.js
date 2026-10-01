/* "Is this the visitor's first hit today?" without storing anyone. The hash of salt + site +
   IP + User-Agent goes into `seen`; the salt is random, lives in `meta` for one UTC day and is
   replaced by the nightly cron, which also empties `seen`. After that nothing can be recomputed.
   The same idea as GoatCounter's 8-hour memory, with nothing kept past the day. */

const SALT_KEY = 'salt', DAY_KEY = 'salt_day';

function randomSalt() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

function hex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return hex(new Uint8Array(buf));
}

/* The salt for `day` ("2026-10-01"). If the stored one is from another day (the cron missed, or
   the first hit ever), it's rotated here and `seen` is wiped, exactly as the cron would. */
export async function saltFor(db, day) {
  const rows = await db.prepare('SELECT key, value FROM meta WHERE key IN (?, ?)').bind(SALT_KEY, DAY_KEY).all();
  const meta = Object.fromEntries((rows.results || []).map(r => [r.key, r.value]));
  if (meta[SALT_KEY] && meta[DAY_KEY] === day) return meta[SALT_KEY];
  return rotateSalt(db, day);
}

export async function rotateSalt(db, day) {
  const salt = randomSalt();
  await db.batch([
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(SALT_KEY, salt),
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(DAY_KEY, day),
    db.prepare('DELETE FROM seen'),
  ]);
  return salt;
}

/* 1 if this is the first hit of the day for this visitor on this site, else 0. */
export async function firstToday(db, { day, site, ip, ua }) {
  const salt = await saltFor(db, day);
  const hash = await sha256(`${salt}|${site}|${ip || ''}|${ua || ''}`);
  const r = await db.prepare('INSERT OR IGNORE INTO seen (site, hash) VALUES (?, ?)').bind(site, hash).run();
  const changes = r.meta ? r.meta.changes : 0;
  return changes ? 1 : 0;
}
