#!/usr/bin/env node
/* `npm run dev`: gets the local setup in place, then starts `wrangler dev`. Every step is
   idempotent, so it is safe to run each time: `.dev.vars` with a random token if missing, the
   local D1 migrated, the demo site registered, and the server on http://localhost:8787.
   Extra arguments go to wrangler (`npm run dev -- --port 8788`, or `--port=8788`). */
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/* The port is read here too, because the demo site is registered with it as its origin: a
   port wrangler knows and this script does not would drop every hit from /demo silently. */
let port = '8787';
const args = [];
for (let i = 0; i < process.argv.length - 2; i++) {
  const a = process.argv[i + 2];
  if (a === '--port' || a === '-p') port = process.argv[i + 3], i++;
  else if (a.startsWith('--port=')) port = a.slice(7);
  else args.push(a);
}
if (!/^\d+$/.test(port || '')) { console.error(`dev: --port needs a number, got "${port}"`); process.exit(2); }

/* wrangler's own entry, not npx's wrapper (as tools/smoke.js does): the child is wrangler itself,
   so a signal to this script reaches it and workerd lets go of the port. */
const WRANGLER = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
if (!existsSync(WRANGLER)) { console.error('dev: wrangler is not installed; run `npm install` first'); process.exit(1); }

function run(label, cmd, argv) {
  const r = spawnSync(cmd, argv, { stdio: 'pipe', encoding: 'utf8' });
  if (r.error) { console.error(`dev: ${label} could not start: ${r.error.message}`); process.exit(1); }
  if (r.status !== 0) { console.error(`dev: ${label} failed\n${r.stdout}${r.stderr}`); process.exit(r.status ?? 1); }
}

if (!existsSync('.dev.vars')) {
  const token = randomUUID();
  writeFileSync('.dev.vars', `# Local only; wrangler dev reads it. In production: wrangler secret put ADMIN_TOKEN\nADMIN_TOKEN=${token}\n`);
  console.log(`dev: wrote .dev.vars with a new token`);
}
run('migrate', process.execPath, [WRANGLER, 'd1', 'migrations', 'apply', 'DB', '--local']);
run('site:add', process.execPath, ['tools/site-add.js', 'demo', 'Demo', `http://localhost:${port}`]);

const token = /^ADMIN_TOKEN=(.*)$/m.exec(readFileSync('.dev.vars', 'utf8'))?.[1]?.trim();
console.log(`dev: demo page   http://localhost:${port}/demo`);
console.log(`dev: dashboard   http://localhost:${port}/#token=${token || '<ADMIN_TOKEN from .dev.vars>'}`);

const dev = spawn(process.execPath, [WRANGLER, 'dev', '--port', port, ...args], { stdio: 'inherit' });
dev.on('error', e => { console.error(`dev: wrangler could not start: ${e.message}`); process.exit(1); });
dev.on('exit', code => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => dev.kill(sig));
