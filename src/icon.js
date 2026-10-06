/* The kits a village can be built in: the keys of KIT in public/village.js, which draws one it
   does not know as alpine. `site:add --style` takes only these. */
export const STYLES = ['alpine', 'stone', 'citadel', 'umbra'];

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
function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : '';
}

/* The media type of a kept icon, told by its first bytes (never by what the server said), or
   null: too big, empty, or not one of PNG, ICO, JPEG. No SVG: it is a document, and served from
   the dashboard's own origin it could run code there. */
export function iconType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!b.length || b.length > ICON_MAX) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'image/x-icon';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  return null;
}
