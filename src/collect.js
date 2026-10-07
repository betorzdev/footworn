/* From the tracker's body to a row of `hits`. Everything the client sends is distrusted: it's
   cut to what the dashboard shows and nothing identifying survives (docs/privacy.md). */

import { isBot, parseUA } from './ua.js';

const MAX_PATH = 200, MAX_REF = 100, MAX_EVENT = 60, MAX_PROPS = 10, MAX_PROP_KEY = 32, MAX_PROP_VAL = 64, MAX_LANG = 8;
/* What an event may carry, as the Sites panel's wiring prompt tells a site's developer (public/wire.js). */
export const LIMITS = { event: MAX_EVENT, props: MAX_PROPS, key: MAX_PROP_KEY, value: MAX_PROP_VAL };
const MAX_WIDTH = 10000;   // wider than any screen; past it the number is noise
const LANG = /^[a-z]{2,3}$/; // the primary subtag of a BCP 47 tag ("es" of "es-ES"); anything else is not a language

function str(v, max) {
  if (typeof v !== 'string') return null;
  v = v.trim();
  if (!v) return null;
  return v.length > max ? v.slice(0, max) : v;
}

/* The referrer as the dashboard shows it: a hostname, without "www.". The site's own host (any
   of its allowed origins) means internal navigation and counts as none. Over 100 chars it's
   someone else's business and is dropped. */
export function refHost(ref, ownHosts) {
  if (typeof ref !== 'string' || !ref) return null;
  let host;
  try { host = new URL(ref).hostname.toLowerCase(); } catch (e) { return null; }
  if (!host) return null;
  host = host.replace(/^www\./, '');
  if (ownHosts && ownHosts.includes(host)) return null;
  return host.length > MAX_REF ? null : host;
}

/* A link's own tag (?ref= or ?utm_source=, which the tracker sends as `c`), when it names one of
   these channels; it then takes the referrer's place, so a link posted where no referrer is sent
   still shows its source. A fixed list, not any word: a personal referral code (?ref=jsmith)
   would be an identifier, and it is dropped like any other value (docs/privacy.md). */
export const CHANNELS = new Set(['reddit', 'discord', 'youtube', 'twitter', 'x', 'bsky', 'mastodon', 'threads',
  'facebook', 'instagram', 'tiktok', 'twitch', 'steam', 'telegram', 'whatsapp', 'github', 'email', 'newsletter']);
export function campaign(c) {
  if (typeof c !== 'string') return null;
  c = c.trim().toLowerCase();
  return CHANNELS.has(c) ? c : null;
}

/* Event names starting with `$` are Footworn's own; the only one is `$engaged` (the tracker's
   "used, not just opened", once per load), which carries no properties. */
export const ENGAGED = '$engaged';

export function deviceOf(width) {
  if (!Number.isFinite(width) || width <= 0) return null;
  if (width < 600) return 'phone';
  if (width < 1024) return 'tablet';
  return 'desktop';
}

/* An event's properties: a flat object, ≤ 10 keys, string values ≤ 64 chars (numbers and
   booleans become strings). Anything else is dropped key by key. Returns null if nothing is left. */
export function cleanProps(props) {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return null;
  const out = {};
  let n = 0;
  for (const k of Object.keys(props)) {
    if (n >= MAX_PROPS) break;
    const key = str(k, MAX_PROP_KEY);
    if (!key) continue;
    let v = props[k];
    if (typeof v === 'number' || typeof v === 'boolean') v = String(v);
    const val = str(v, MAX_PROP_VAL);
    if (val === null) continue;
    out[key] = val;
    n++;
  }
  return n ? out : null;
}

/* Hosts the site's allowed origins name: the referrer filter's "own". */
export function hostsOf(origins) {
  return String(origins || '').split(/\s+/).filter(Boolean).map(o => {
    try { return new URL(o).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return null; }
  }).filter(Boolean);
}

/* Exact Origin match against the site's list; both sides are normalized through URL, so a
   trailing slash or a capital in the registered origin doesn't lock the site out. */
export function originAllowed(origin, origins) {
  if (!origin) return false;
  const norm = o => { try { return new URL(o).origin; } catch (e) { return o; } };
  const want = norm(origin);
  return String(origins || '').split(/\s+/).filter(Boolean).some(o => norm(o) === want);
}

/* Reads the posted body. Returns the row to insert (without `first`, which the visitor check
   adds), or null with a reason when the hit isn't counted. `site` is the row of `sites`. */
export function makeHit(body, { site, ua, country, now }) {
  if (!body || typeof body !== 'object') return { skip: 'body' };
  if (isBot(ua)) return { skip: 'bot' };
  const path = str(body.p, MAX_PATH);
  if (!path || path[0] !== '/') return { skip: 'path' };
  const event = str(body.e, MAX_EVENT);
  if (event && event[0] === '$' && event !== ENGAGED) return { skip: 'event' };
  const w = Number.isFinite(body.w) ? Math.round(body.w) : 0;
  const width = w > 0 && w <= MAX_WIDTH ? w : null;
  const { browser, os } = parseUA(ua);
  const tag = (str(body.l, MAX_LANG) || '').split('-')[0].toLowerCase();
  const date = new Date(now * 1000);
  return {
    hit: {
      site: site.id,
      ts: now,
      day: date.toISOString().slice(0, 10),
      path: path.split('?')[0].split('#')[0],
      event,
      props: event && event !== ENGAGED ? cleanProps(body.props) : null,
      ref: campaign(body.c) || refHost(body.r, hostsOf(site.origins)),
      browser, os,
      device: deviceOf(width),
      width,
      country: typeof country === 'string' && /^[A-Z]{2}$/.test(country) ? country : null,
      lang: LANG.test(tag) ? tag : null,
    },
  };
}
