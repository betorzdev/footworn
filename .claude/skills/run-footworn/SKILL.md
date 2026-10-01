---
name: run-footworn
description: Start Footworn locally (wrangler dev on a local D1 with the demo site) to check a change in the real app, fire hits and read the API. Use for /verify, /run, or whenever a change to src/ or public/ needs to be seen working, not just unit-tested.
allowed-tools: Bash(npm run *) Bash(npx wrangler *) Bash(curl *) Bash(node tools/*)
---

# Run Footworn locally

Everything runs on a throwaway local D1 under `.wrangler/`; nothing touches the deployed Worker.

1. Unit tests first, they are instant: `npm test`.
2. Start the server in the background: `npm run dev` (port 8787). It migrates the local D1,
   registers the `demo` site and writes `.dev.vars` if missing, then prints the dashboard link.
   Wait until `curl -s -o /dev/null -w '%{http_code}' http://localhost:8787/api/sites` prints `401`.
3. Fire hits: `curl -s http://localhost:8787/demo` is the demo page; from the command line a
   pageview is
   `curl -s -X POST http://localhost:8787/c -H 'Origin: http://localhost:8787' -H 'User-Agent: Mozilla/5.0 (X11; Linux x86_64) Chrome/129.0 Safari/537.36' -d '{"s":"demo","p":"/","r":"","w":1440,"l":"en"}'`
   (always `204`, even when dropped: check the API, not the status).
4. Read the numbers with the token from `.dev.vars`:
   `curl -s http://localhost:8787/api/stats?site=demo -H "Authorization: Bearer $(sed -n 's/^ADMIN_TOKEN=//p' .dev.vars)"`.
5. The nightly cron by hand: `curl -s http://localhost:8787/cdn-cgi/local/scheduled`.
6. The dashboard is `http://localhost:8787/#token=<token>`; a screenshot there is the visual check.
7. Stop the server when done. `npm run smoke` is the end-to-end check on its own port (8799)
   and does not need the dev server.

Deploys are the user's call: never `npm run deploy`.
