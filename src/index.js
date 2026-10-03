/* Footworn's Worker. Static files (the dashboard, footworn.js, privacy) are served by the assets
   binding before this runs; here live the collector (POST /c), the read API (GET /api/*), the
   live view's socket (GET /live, relayed to the `Live` Durable Object) and the nightly cron. */

import { makeHit, originAllowed } from './collect.js';
import { firstToday, rotateSalt } from './visitor.js';
import { authorized } from './auth.js';
import { sites, stats, eventStats, scene, visits } from './stats.js';
import { publish } from './live.js';
import { makeTicket, checkTicket } from './ticket.js';

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

/* The body, or null past `max` bytes: read from the stream, so a body without Content-Length
   (or lying about it) never gets buffered whole. */
export async function readCapped(request, max) {
  if (Number(request.headers.get('Content-Length')) > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
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
  await env.DB.prepare(`INSERT INTO hits (site, ts, day, path, event, props, ref, browser, os, device, width, country, lang, first)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(hit.site, hit.ts, hit.day, hit.path, hit.event, hit.props ? JSON.stringify(hit.props) : null, hit.ref,
          hit.browser, hit.os, hit.device, hit.width, hit.country, hit.lang, hit.first)
    .run();
  /* After the write, never instead of it: a live view that is down costs nothing but the show. */
  if (env.LIVE && ctx) ctx.waitUntil(publish(env, hit).catch(e => logError('live', e)));
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

async function api(request, env, url) {
  if (!authorized(request, env)) return json({ error: 'unauthorized' }, 401);
  if (url.pathname === '/api/sites') return json(await sites(env.DB));
  if (url.pathname === '/api/live-ticket') return json({ ticket: await makeTicket(env.ADMIN_TOKEN) });
  const site = url.searchParams.get('site');
  if (!site) return json({ error: 'site' }, 400);
  if (url.pathname === '/api/stats') return json(await stats(env.DB, { site, ...range(url) }));
  if (url.pathname === '/api/scene') return json(await scene(env.DB, { site }));
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
      if (request.method !== 'GET') return json({ error: 'method' }, 405);
      try { return await api(request, env, url); } catch (e) { logError(url.pathname, e); return json({ error: 'internal' }, 500); }
    }
    return new Response('Not found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(nightly(env));
  },
};
