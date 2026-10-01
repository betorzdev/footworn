#!/usr/bin/env node
/* Adds (or updates) a site in D1. Local by default; --remote for the deployed database.
     npm run site:add -- hallownest "Hallownest Calculator" https://betorzdev.github.io
     npm run site:add -- hallownest "Hallownest Calculator" "https://a.example https://b.example" --remote */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const persistAt = args.indexOf('--persist-to');
const persist = persistAt >= 0 ? args[persistAt + 1] : null;
const rest = args.filter((a, i) => a !== '--remote' && a !== '--persist-to' && !(persistAt >= 0 && i === persistAt + 1));
const [id, name, origins] = rest;
if (!id || !name || !origins) {
  console.error('usage: npm run site:add -- <id> <name> "<origin> [<origin>…]" [--remote]');
  process.exit(2);
}
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const sql = `INSERT INTO sites (id, name, origins) VALUES (${q(id)}, ${q(name)}, ${q(origins)})
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, origins = excluded.origins;`;
const argv = ['wrangler', 'd1', 'execute', 'DB', remote ? '--remote' : '--local', '--command', sql];
if (persist) argv.push('--persist-to', persist);
const r = spawnSync('npx', argv, { stdio: 'inherit' });
process.exit(r.status);
