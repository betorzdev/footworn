/* Footworn's Worker. Static files (the dashboard, footworn.js, privacy) are served by the assets
   binding before this runs; here live the collector (POST /c), the read API (GET /api/*), the
   Sites panel's writes (PUT/DELETE /api/site, POST/DELETE /api/icon) and its suggested look (POST /api/look), the live view's socket
   (GET /live, relayed to the `Live` Durable Object) and the nightly cron. */

import { makeHit, originAllowed, ENGAGED } from './collect.js';
import { firstToday, rotateSalt } from './visitor.js';
import { authorized } from './auth.js';
import { sites, stats, eventStats, scene, days, visits, icon } from './stats.js';
import { publish } from './live.js';
import { makeTicket, checkTicket } from './ticket.js';
import { readCapped } from './body.js';
import { validateSite, saveSite, removeSite, siteRow, fetchIcon, keepIcon, dropIcon, pageUrl } from './sites.js';
import { iconType, ICON_MAX } from './icon.js';
import { readSite, aiLook, validPalette, b64 } from './look.js';


export { Live } from './live.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY = 8192; // a real hit is under 1 KB; anything bigger is not one

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function empty(status = 204) {
  return new Response(null, { status, headers: { ...CORS, 'Cache-Control': 'no-store' } });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function collect(request, env, ctx) {
  let body;
  try {
    const text = await readCapped(request, MAX_BODY);
    if (text === null) return empty();
    body = JSON.parse(text);
  } catch (e) { return empty(); }
  if (!body || typeof body.s !== 'string') return empty();
  const site = await env.DB.prepare('SELECT id, name, origins FROM sites WHERE id = ?').bind(body.s).first();
  if (!site) return empty();
  if (!originAllowed(request.headers.get('Origin'), site.origins)) return empty();

  const ua = request.headers.get('User-Agent') || '';
  const now = Math.floor(Date.now() / 1000);
  const made = makeHit(body, { site, ua, country: request.cf && request.cf.country, now });
  if (!made.hit) return empty();
  const hit = made.hit;
  /* Only a pageview can be "the first of the day": an event is an action on a page already
     counted, so it costs one write instead of two and every SUM(first) in stats.js agrees. */
  hit.first = hit.event ? 0 : await firstToday(env.DB, { day: hit.day, site: site.id, ip: request.headers.get('CF-Connecting-IP'), ua });
  /* A reload (`rl`, from the tracker) is the same visit again: dropped, unless it is this
     visitor's first pageview of the day (a tab left open overnight, a phone restoring a tab). */
  if (body.rl === 1 && !hit.event && !hit.first) return empty();
  await env.DB.prepare(`INSERT INTO hits (site, ts, day, path, event, props, ref, browser, os, device, width, country, lang, first)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(hit.site, hit.ts, hit.day, hit.path, hit.event, hit.props ? JSON.stringify(hit.props) : null, hit.ref,
          hit.browser, hit.os, hit.device, hit.width, hit.country, hit.lang, hit.first)
    .run();
  /* After the write, never instead of it: a live view that is down costs nothing but the show.
     `$engaged` stays out: seconds after its pageview, it would join two rows into one person. */
  if (env.LIVE && ctx && hit.event !== ENGAGED) ctx.waitUntil(publish(env, hit).catch(e => logError('live', e)));
  return empty();
}

function range(url) {
  const today = new Date().toISOString().slice(0, 10);
  let from = url.searchParams.get('from'), to = url.searchParams.get('to');
  if (!DAY.test(to || '')) to = today;
  if (!DAY.test(from || '')) from = new Date(Date.parse(to) - 29 * 86400000).toISOString().slice(0, 10);
  if (from > to) [from, to] = [to, from];
  return { from, to };
}

/* The Sites panel's writes, behind the same token. No cross-site request can make one: each
   needs the Authorization header and a JSON or image body, which a browser preflights, and
   /api/* answers no CORS headers, so the preflight fails anywhere but the dashboard's own origin. */
async function writeSite(request, env, url) {
  const db = env.DB;
  if (url.pathname === '/api/site') {
    if (request.method === 'PUT') {
      let body;
      try { body = JSON.parse(await readCapped(request, MAX_BODY)); } catch (e) { return json({ error: 'a site is a JSON object' }, 400); }
      const v = validateSite(body);
      if (v.error) return json({ error: v.error }, 400);
      if (!(await saveSite(db, v.site, { create: body.create === true }))) return json({ error: `there is a site "${v.site.id}" already: edit it, or pick another id` }, 409);
      return json({ ok: true, site: (await sites(db)).find(s => s.id === v.site.id) });
    }
    if (request.method === 'DELETE') {
      const id = url.searchParams.get('site');
      if (!id || !(await siteRow(db, id))) return json({ error: 'not found' }, 404);
      await removeSite(db, id);
      return json({ ok: true });
    }
    return json({ error: 'method' }, 405);
  }
  if (url.pathname === '/api/icon') {
    const id = url.searchParams.get('site');
    const row = id && await siteRow(db, id);
    if (!row) return json({ error: 'not found' }, 404);
    if (request.method === 'DELETE') { await dropIcon(db, id); return json({ ok: true }); }
    if (request.method !== 'POST') return json({ error: 'method' }, 405);
    const ct = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
    if (ct.startsWith('image/')) {
      /* a file the owner chose: its bytes say what it is, never its name or its header */
      const bytes = await readCapped(request, ICON_MAX, { bytes: true });
      if (!bytes) return json({ error: `the file is over ${ICON_MAX / 1024} KB` }, 400);
      const type = iconType(bytes);
      if (!type) return json({ error: 'not a PNG, ICO or JPEG' }, 400);
      await keepIcon(db, id, bytes, type);
      return json({ ok: true, icon: { type, bytes: bytes.length } });
    }
    /* fetched from the site: the page given, or the first allowed origin's front page */
    let body = {};
    try { body = JSON.parse((await readCapped(request, MAX_BODY)) || '{}') || {}; } catch (e) { return json({ error: 'a JSON body' }, 400); }
    const page = body.page ? pageUrl(body.page) : pageUrl(row.origins.split(/\s+/)[0] + '/');
    if (!page) return json({ error: 'page: an http(s) URL' }, 400);
    const got = await fetchIcon(fetch, page);
    if (!got) return json({ error: `no usable icon at ${page}: a PNG, ICO or JPEG of ${ICON_MAX / 1024} KB or less, linked as its icon or at /favicon.ico` }, 422);
    await keepIcon(db, id, got.bytes, got.type);
    return json({ ok: true, icon: { type: got.type, bytes: got.bytes.length, url: got.url } });
  }
  /* A look for a village, read from the site's own public page (the Sites panel's Suggest): its
     hints and its icon always, Claude's reading of them when the Worker has a key. Stores nothing. */
  if (url.pathname === '/api/look' && request.method === 'POST') {
    let body;
    try { body = JSON.parse(await readCapped(request, MAX_BODY)) || {}; } catch (e) { return json({ error: 'a JSON body' }, 400); }
    const page = pageUrl(body.page);
    if (!page) return json({ error: 'page: an http(s) URL' }, 400);
    const palette = validPalette(body.palette);
    const key = env.ANTHROPIC_API_KEY;
    const site = await readSite(fetch, page, { og: !!(key && palette) });
    const ai = !key ? {} : palette ? await aiLook(fetch, key, { ...site, palette }) : { aiError: 'the dashboard sent no usable palette' };
    return json({ hints: site.hints, icon: site.icon ? { type: site.icon.type, data: b64(site.icon.bytes), url: site.icon.url } : null, ai: ai.ai || null, ...(ai.aiError ? { aiError: ai.aiError } : {}) });
  }
  return json({ error: 'method' }, 405);   // every other path under /api/ is a read
}

async function api(request, env, url) {
  if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
  if (request.method !== 'GET') return writeSite(request, env, url);
  if (url.pathname === '/api/sites') return json(await sites(env.DB));
  if (url.pathname === '/api/live-ticket') return json({ ticket: await makeTicket(env.ADMIN_TOKEN) });
  const site = url.searchParams.get('site');
  if (!site) return json({ error: 'site' }, 400);
  if (url.pathname === '/api/stats') return json(await stats(env.DB, { site, ...range(url) }));
  if (url.pathname === '/api/scene') {
    const day = url.searchParams.get('day');   // a day before today: the village as it was; anything else is today
    return json(await scene(env.DB, { site, day: DAY.test(day || '') ? day : undefined }));
  }
  if (url.pathname === '/api/icon') {
    const ic = await icon(env.DB, site);
    if (!ic) return json({ error: 'not found' }, 404);
    /* the site's own icon, kept as an image (src/icon.js): served as one, never run as a page */
    return new Response(ic.bytes, { headers: { 'Content-Type': ic.type, 'Cache-Control': 'private, no-cache', 'Content-Security-Policy': "default-src 'none'", 'X-Content-Type-Options': 'nosniff' } });
  }
  if (url.pathname === '/api/days') return json(await days(env.DB, { site, ...range(url) }));
  if (url.pathname === '/api/visits') return json(await visits(env.DB, { site }));
  if (url.pathname === '/api/event') {
    const name = url.searchParams.get('name');
    if (!name) return json({ error: 'name' }, 400);
    return json(await eventStats(env.DB, { site, name, ...range(url) }));
  }
  return json({ error: 'not found' }, 404);
}

/* Drops hits older than RETENTION_MONTHS, rotates the salt and forgets today's hashes. */
export async function nightly(env, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  await rotateSalt(env.DB, day);
  const months = parseInt(env.RETENTION_MONTHS, 10) || 25;
  const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, now.getUTCDate())).toISOString().slice(0, 10);
  await env.DB.prepare('DELETE FROM hits WHERE day < ?').bind(cutoff).run();
}

/* One structured line per failure; Workers Logs indexes the fields. Nothing about the visitor. */
function logError(route, e) {
  console.error(JSON.stringify({ level: 'error', route, error: e && e.message ? e.message : String(e) }));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/c') {
      if (request.method === 'OPTIONS') return empty();
      if (request.method !== 'POST') return empty(405);
      /* A failure here (D1 down, say) is still a 204: the tracker must never see an error. */
      try { return await collect(request, env, ctx); } catch (e) { logError('/c', e); return empty(); }
    }
    /* The live view's socket: the ticket from /api/live-ticket, then the Durable Object. */
    if (url.pathname === '/live') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
      if (!env.LIVE || !(await checkTicket(url.searchParams.get('ticket'), env.ADMIN_TOKEN))) return new Response('Unauthorized', { status: 401 });
      return env.LIVE.get(env.LIVE.idFromName('live')).fetch(request);
    }
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'PUT', 'POST', 'DELETE'].includes(request.method)) return json({ error: 'method' }, 405);
      try { return await api(request, env, url); } catch (e) { logError(url.pathname, e); return json({ error: 'internal' }, 500); }
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(nightly(env));
  },
};
