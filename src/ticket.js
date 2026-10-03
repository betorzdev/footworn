/* The live view's door. A browser cannot send `Authorization` on a WebSocket, and the admin token
   must never ride in a URL (logs keep URLs), so the API hands out a ticket instead: `exp.sig`,
   an HMAC-SHA-256 under ADMIN_TOKEN that is good for 60 seconds. /live checks it without state. */

const enc = new TextEncoder();
export const TICKET_LIFE = 60; // seconds

function key(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function b64u(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64u(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function makeTicket(secret, now = Math.floor(Date.now() / 1000)) {
  const exp = now + TICKET_LIFE;
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode('live.' + exp));
  return exp + '.' + b64u(sig);
}

/* True only for a ticket this secret signed that has not expired. A ticket dated further ahead
   than one life is refused too: nothing this Worker signs looks like that. */
export async function checkTicket(ticket, secret, now = Math.floor(Date.now() / 1000)) {
  if (!secret || typeof ticket !== 'string') return false;
  const m = /^(\d{10})\.([A-Za-z0-9_-]{43})$/.exec(ticket);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp < now || exp > now + TICKET_LIFE) return false;
  return crypto.subtle.verify('HMAC', await key(secret), unb64u(m[2]), enc.encode('live.' + exp));
}
