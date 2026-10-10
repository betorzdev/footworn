/* The kits a village can be built in: the keys of KIT in public/village.js, which draws one it
   does not know as alpine. `site:add --style` takes only these. */
export const STYLES = ['alpine', 'stone', 'citadel', 'umbra'];

/* The pieces of a village that can be set apart from its kit, each by name: PIECES in
   public/village.js says what each name builds. A site keeps only those it sets (`pieces`). */
export const PIECES = {
  spire: ['pyramid', 'needle', 'belfry', 'iron'],
  wall: ['palisade', 'rampart', 'battlement', 'iron'],
  roofs: ['gentle', 'steep', 'low', 'tall'],
  shade: ['none', 'half', 'deep'],
  motes: ['none', 'some'],
};

/* A site's icon: where its page says it is, and whether what came back is an image Footworn
   keeps. Used by `npm run site:icon`; the Worker only serves what was kept (/api/icon). */

export const ICON_MAX = 40 * 1024;   // a D1 statement holds about 100 KB, and the icon goes in as hex

/* The icons a page links to, best first: the largest of 256 px or less, then the rest, then
   /favicon.ico. Absolute URLs, resolved against `base`. */
export function findIcons(html, base) {
  const found = [];
  for (const tag of String(html).match(/<link\b[^>]*>/gi) || []) {
    const rel = attr(tag, 'rel').toLowerCase().split(/\s+/);
    if (!rel.includes('icon') && !rel.includes('apple-touch-icon')) continue;
    const href = attr(tag, 'href');
    if (!href) continue;
    let url;
    try { url = new URL(href, base).href; } catch (e) { continue; }
    if (!/^https?:/.test(url)) continue;
    const size = Math.max(0, ...attr(tag, 'sizes').split(/\s+/).map(s => parseInt(s, 10) || 0));
    found.push({ url, size: size || (rel.includes('apple-touch-icon') ? 180 : 32) });
  }
  found.sort((a, b) => fit(b.size) - fit(a.size));
  const urls = found.map(f => f.url);
  try { urls.push(new URL('/favicon.ico', base).href); } catch (e) { /* no base */ }
  return [...new Set(urls)];
}
function fit(size) { return size <= 256 ? size : -size; }   // bigger is better up to 256; past it, behind every smaller one
export function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
}

/* The media type of a kept icon, told by its first bytes (never by what the server said), or
   null: too big, empty, or not one of PNG, ICO, JPEG. No SVG: it is a document, and served from
   the dashboard's own origin it could run code there. */
/* An image to look at (a page's og:image, for the suggested look): PNG, JPEG, GIF or WebP by its
   first bytes, at most `max`; never kept. */
export function imageType(bytes, max) { return sniff(bytes, max, ['image/png', 'image/jpeg', 'image/gif', 'image/webp']); }

export function iconType(bytes) { return sniff(bytes, ICON_MAX, ['image/png', 'image/x-icon', 'image/jpeg']); }

/* What the first bytes say an image is, among `allowed`, when it is not empty and at most `max`. */
function sniff(bytes, max, allowed) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!b.length || b.length > max) return null;
  const type = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 ? 'image/png'
    : b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00 ? 'image/x-icon'
    : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
    : b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 ? 'image/gif'
    : b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 ? 'image/webp'
    : null;
  return type && allowed.includes(type) ? type : null;
}
