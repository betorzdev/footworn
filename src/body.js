/* A body read with a cap. `source` is a Request or a Response: its `body` stream is read, so a
   body without Content-Length (or lying about it) never gets buffered whole. Past `max` bytes
   the answer is null, or with `{ head: true }` the first `max` bytes (the head of a long page);
   otherwise the text, or the bytes with `{ bytes: true }`. */
export async function readCapped(source, max, { bytes = false, head = false } = {}) {
  if (!head && Number(source.headers.get('Content-Length')) > max) return null;
  if (!source.body) return bytes ? new Uint8Array(0) : '';
  const reader = source.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (size + value.byteLength > max) {
      await reader.cancel();
      if (!head) return null;
      chunks.push(value.subarray(0, max - size)); size = max; break;
    }
    size += value.byteLength;
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return bytes ? all : new TextDecoder().decode(all);
}
