#!/usr/bin/env node
/* Fetches a site's icon once and keeps it in D1, for its banner and its sign in the village.
   Local by default; --remote for the deployed database.
     npm run site:icon -- hallownest                       # the page at the site's first origin
     npm run site:icon -- hallownest https://site.example/calc/ --remote
   It looks for the page's <link rel="icon"> (the largest up to 256 px), then /favicon.ico, and
   keeps the first that is a PNG, ICO or JPEG of 40 KB or less (src/icon.js). */
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findIcons, iconType } from '../src/icon.js';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const persistAt = args.indexOf('--persist-to');
const persist = persistAt >= 0 ? args[persistAt + 1] : null;
const rest = args.filter((a, i) => a !== '--remote' && a !== '--persist-to' && !(persistAt >= 0 && i === persistAt + 1));
const [id, page] = rest;
if (!id) { console.error('usage: npm run site:icon -- <id> [<page url>] [--remote]'); process.exit(2); }
const q = s => `'${String(s).replace(/'/g, "''")}'`;

function d1(more) {
  const argv = ['wrangler', 'd1', 'execute', 'DB', remote ? '--remote' : '--local', ...more];
  if (persist) argv.push('--persist-to', persist);
  return spawnSync('npx', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

let base = page;
if (!base) {
  const r = d1(['--json', '--command', `SELECT origins FROM sites WHERE id = ${q(id)}`]);
  const row = r.status ? null : (JSON.parse(r.stdout)[0] || {}).results?.[0];
  if (!row) { console.error(`no site "${id}"`); process.exit(1); }
  base = row.origins.split(/\s+/)[0] + '/';
}

let html = '';
try { const r = await fetch(base, { redirect: 'follow' }); if (r.ok) html = await r.text(); base = r.url || base; } catch (e) { console.error(`could not read ${base}: ${e.message}`); }
let kept = null;
for (const url of findIcons(html, base)) {
  try {
    const r = await fetch(url, { redirect: 'follow' });
    if (!r.ok) continue;
    const bytes = new Uint8Array(await r.arrayBuffer()), type = iconType(bytes);
    if (type) { kept = { url, bytes, type }; break; }
    console.error(`skipped ${url}: not a PNG, ICO or JPEG of 40 KB or less`);
  } catch (e) { console.error(`skipped ${url}: ${e.message}`); }
}
if (!kept) { console.error(`no usable icon found for ${base}`); process.exit(1); }

const dir = mkdtempSync(join(tmpdir(), 'footworn-icon-')), file = join(dir, 'icon.sql');
writeFileSync(file, `UPDATE sites SET icon = X'${Buffer.from(kept.bytes).toString('hex')}', icon_type = ${q(kept.type)} WHERE id = ${q(id)};\n`);
const r = d1(['--file', file]);
rmSync(dir, { recursive: true, force: true });
if (r.status) process.exit(r.status);
console.log(`${id}: kept ${kept.url} (${kept.type}, ${kept.bytes.length} bytes)`);
