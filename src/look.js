/* The look a site's village could wear, read from the site itself (POST /api/look, the Sites
   panel's "Suggest from the site"): what its own public page says about itself (`readHints`), its
   icon, and, when the Worker has an ANTHROPIC_API_KEY, Claude's reading of all of it (`aiLook`).
   Nothing is stored and nothing about a visitor is involved: only the site's own public page. The
   colour rules that always answer run in the dashboard (public/look.js), on the icon's pixels. */

import { STYLES, PIECES, attr, imageType } from './icon.js';
import { LOOK, fetchPage, pickIcon, validPieces } from './sites.js';
import { readCapped } from './body.js';

const OG_MAX = 1024 * 1024;   // an og:image is looked at, never kept: past this it is skipped
export const MODEL = 'claude-opus-5-5';
const API = 'https://api.anthropic.com/v1/messages';
const AI_MS = 25000;
const HEX = /^#[0-9a-f]{6}$/i;

/* What a page's head says about how it looks: { title, description, lang, themeColor, scheme, ogImage }. */
export function readHints(html, base) {
  const h = String(html);
  const metas = h.match(/<meta\b[^>]*>/gi) || [];
  const meta = name => metas.filter(t => (attr(t, 'name') || attr(t, 'property')).toLowerCase() === name);
  const content = t => attr(t, 'content').trim();
  const themes = meta('theme-color');
  /* the one for any scheme, or for a light one; the first otherwise */
  const theme = themes.find(t => !attr(t, 'media')) || themes.find(t => /light/i.test(attr(t, 'media'))) || themes[0];
  const title = (/<title[^>]*>([^<]*)<\/title>/i.exec(h) || [])[1];
  const htmlTag = (/<html\b[^>]*>/i.exec(h) || [''])[0];
  const scheme = (meta('color-scheme')[0] && content(meta('color-scheme')[0])) || (/color-scheme\s*:\s*([a-z ]+)/i.exec(attr(htmlTag, 'style')) || [])[1] || '';
  let og = meta('og:image')[0] && content(meta('og:image')[0]);
  try { og = og ? new URL(og, base).href : null; if (og && !/^https?:/.test(og)) og = null; } catch (e) { og = null; }
  return {
    title: clip(decode(title || ''), 120),
    description: clip(decode(meta('description')[0] ? content(meta('description')[0]) : ''), 300),
    lang: clip(attr(htmlTag, 'lang'), 16),
    themeColor: theme ? clip(content(theme), 40) : null,
    scheme: clip(scheme.trim().toLowerCase(), 20),
    ogImage: og,
  };
}
function clip(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) : s; }
function decode(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'"); }

export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/* The page read once: its hints, its icon, and its og:image when Claude will look at it. */
export async function readSite(fetchFn, page, { og = false } = {}) {
  const { html, base } = await fetchPage(fetchFn, page);
  const hints = readHints(html, base);
  const icon = await pickIcon(fetchFn, html, base);
  let ogImage = null;
  if (og && hints.ogImage) {
    try {
      const r = await fetchFn(hints.ogImage, { redirect: 'follow' });
      const bytes = r.ok ? await readCapped(r, OG_MAX, { bytes: true }) : null;
      const type = bytes && imageType(bytes, OG_MAX);
      if (type) ogImage = { bytes, type };
    } catch (e) { /* none: the rest still speaks */ }
  }
  return { hints, icon, ogImage };
}

/* The palette the dashboard sends: the eight site colours and each kit's roof, as #rrggbb. */
export function validPalette(p) {
  const tints = p && Array.isArray(p.tints) && p.tints.length === 8 && p.tints.every(c => HEX.test(c)) ? p.tints : null;
  const roofs = {};
  for (const k of STYLES) if (p && p.roofs && HEX.test(p.roofs[k] || '')) roofs[k] = p.roofs[k];
  return tints && Object.keys(roofs).length === STYLES.length ? { tints, roofs } : null;
}

/* What each piece's options look like, for Claude: one line each, every option of PIECES (a test checks). */
export const PIECE_TEXT = {
  spire: { pyramid: 'pyramid (alpine)', needle: 'needle (stone)', belfry: 'belfry (citadel)', iron: 'iron (umbra)' },
  wall: { palisade: 'palisade (alpine)', rampart: 'rampart (stone)', battlement: 'battlement (citadel)', iron: 'iron (umbra)' },
  roofs: { gentle: 'gentle (alpine)', steep: 'steep (stone)', low: 'low (citadel, no snow)', tall: 'tall (umbra: narrow houses, no snow)' },
  shade: { none: 'none', half: 'half', deep: "deep (the village's own shade)" },
  motes: { none: 'none', some: 'some (drifting motes of light)' },
};
const PIECES_TEXT = Object.keys(PIECES).map(k => `- ${k}: ${PIECES[k].map(v => PIECE_TEXT[k] && PIECE_TEXT[k][v] || v).join(', ')}`).join('\n');

const SYSTEM = `You choose how a website's village looks in Footworn, a visit counter whose dashboard draws every site as a snowed-in 3D village on a polar winter day: a house per page, storeys and lit windows for its visits, street lamps for the hours.

Pick the look that carries the site's own mood and identity, judged from its name, description, theme colour, colour scheme, icon and preview image. Keep it legible: lamps, windows and the clock are counts and keep their own light whatever you choose; you only change the materials.

The kits (the starting point):
- alpine: timber-framed houses, warm brown and cream, gentle snowy roofs, a palisade of stakes. Cosy, rustic, friendly.
- stone: pale stone houses, steep slate roofs, a needle spire, a rampart with round towers, cold blue lamps. Austere, northern, scholarly.
- citadel: light walls, low red-tiled roofs, a belfry, battlements, warm lamps. Warm, sunny, lively.
- umbra: near-black slate, tall narrow houses, an iron spire and iron fence, pale light, drifting motes of light, a village sitting in its own shade. Dark, gothic, mysterious.

The pieces, each either "kit" (the kit's own) or one option, to mix kits when the site calls for it:
${PIECES_TEXT}

The numbers:
- hue: degrees (0 to 359) by which the kit's roofs, walls and shutters are turned round the colour wheel; 0 keeps the kit's colours. The kit's roof colour is given, so to bring the roofs to a hue H, turn by (H minus the roof's hue) modulo 360. Use 0 unless the site has a clear colour of its own.
- shade: -40 (darker) to 40 (lighter); 0 keeps the kit's.
- tint: 1 to 8, the site's colour among the eight given, for its pennant and its sign: the nearest to the site's own colour.

Prefer a kit as it is when it already fits; change pieces only for a reason you can name. "why" is one short sentence, for the owner, naming what in the site led to the choice.`;

export function schema() {
  const piece = k => ({ type: 'string', enum: ['kit', ...PIECES[k]] });
  return {
    type: 'object', additionalProperties: false,
    required: ['style', 'hue', 'shade', 'tint', 'pieces', 'why'],
    properties: {
      style: { type: 'string', enum: STYLES },
      hue: { type: 'integer' }, shade: { type: 'integer' }, tint: { type: 'integer' },
      pieces: { type: 'object', additionalProperties: false, required: Object.keys(PIECES), properties: Object.fromEntries(Object.keys(PIECES).map(k => [k, piece(k)])) },
      why: { type: 'string' },
    },
  };
}

/* The request to Claude, for the tests to read and `aiLook` to send. */
export function aiRequest({ hints, icon, ogImage, palette }) {
  const content = [];
  /* Claude reads PNG, JPEG, GIF and WebP; an ICO icon goes as words only */
  if (icon && /^image\/(png|jpeg)$/.test(icon.type)) content.push({ type: 'text', text: "The site's icon:" }, { type: 'image', source: { type: 'base64', media_type: icon.type, data: b64(icon.bytes) } });
  if (ogImage) content.push({ type: 'text', text: "The site's preview image (og:image):" }, { type: 'image', source: { type: 'base64', media_type: ogImage.type, data: b64(ogImage.bytes) } });
  content.push({ type: 'text', text: [
    'The site:',
    `- title: ${hints.title || '(none)'}`,
    `- description: ${hints.description || '(none)'}`,
    `- language: ${hints.lang || '(none)'}`,
    `- theme colour: ${hints.themeColor || '(none)'}`,
    `- colour scheme: ${hints.scheme || '(not declared)'}`,
    icon ? '' : '- no icon found',
    '',
    `Each kit's roof colour: ${STYLES.map(k => `${k} ${palette.roofs[k]}`).join(', ')}.`,
    `The eight site colours, 1 to 8: ${palette.tints.join(', ')}.`,
  ].filter(l => l !== '').join('\n') });
  return {
    model: MODEL,
    max_tokens: 4000,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: schema() } },
    fallbacks: 'default',
    messages: [{ role: 'user', content }],
  };
}

/* Claude's answer as a look the Sites panel can apply, or null: every value checked as a saved
   site's would be (LOOK, STYLES, PIECES). */
export function aiAnswer(res) {
  if (!res || res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return null;
  const text = (res.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('');
  let a;
  try { a = JSON.parse(text); } catch (e) { return null; }
  if (!a || !STYLES.includes(a.style)) return null;
  const n = (v, k) => Number.isInteger(v) && v >= LOOK[k][0] && v <= LOOK[k][1];
  const hue = Number.isInteger(a.hue) ? ((a.hue % 360) + 360) % 360 : null;
  if (hue === null || !n(a.shade, 'shade') || !n(a.tint, 'tint')) return null;
  const pieces = validPieces(a.pieces);   // as a saved site's: "kit" is the kit's own, an unknown one is no answer
  if (pieces === undefined) return null;
  return { look: { style: a.style, hue, shade: a.shade, tint: a.tint, pieces }, why: clip(a.why, 300) };
}

/* Claude's suggestion: { ai } or { aiError }; nothing at all without a key. Never throws. */
export async function aiLook(fetchFn, key, input) {
  if (!key) return {};
  try {
    const r = await fetchFn(API, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01', 'content-type': 'application/json' },
      body: JSON.stringify(aiRequest(input)),
      signal: AbortSignal.timeout(AI_MS),
    });
    const res = await r.json().catch(() => null);
    if (!r.ok) return { aiError: (res && res.error && res.error.message ? clip(res.error.message, 160) : 'HTTP ' + r.status) };
    const ai = aiAnswer(res);
    return ai ? { ai } : { aiError: res && res.stop_reason === 'refusal' ? 'declined' : 'no usable answer' };
  } catch (e) {
    return { aiError: e && e.name === 'TimeoutError' ? 'timed out' : 'not reached' };
  }
}
