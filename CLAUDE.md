# Footworn — project instructions

A cookie-free visit counter for static sites, as a Cloudflare Worker: the collector, a 1 KB
tracker, a D1 database, a read API and a dashboard. Built for the Hallownest and Pharloom
calculators, but it knows nothing about them: any site with an id and an allowed origin can use it.
`README.md` is the tour and the deploy steps; `docs/privacy.md` is the record of what is stored
and why that is exempt from consent; these are the rules for working on it.

## Hard constraints

- **Zero runtime dependencies.** `wrangler` is the only dev dependency. The Worker is plain
  ES modules (`src/`); the pages in `public/` are classic scripts with no framework and no build.
- **Nothing identifying is ever stored.** No cookies, no storage in the browser, no IP, no
  User-Agent, no hash in `hits`. The daily visitor flag works as `docs/privacy.md` describes:
  change it only with that file. Every new stored field has to be on the AEPD's list there.
- **A hit that isn't valid is dropped silently** (204, nothing logged): unknown site, wrong
  Origin, bot, bad body. The tracker must never break the host page: everything in `try/catch`,
  `sendBeacon` first, `fetch keepalive` after.
- **Every colour, typeface and spacing of the dashboard comes from `public/tokens.css`.**
- **`localStorage` always inside `try/catch`.**
- **The repo is in English**: code, comments, tests, docs, commit messages. The dashboard is
  English only.

## When you finish

- `npm test` (`node --test`, no dependencies) for `src/`.
- `npm run smoke`: boots `wrangler dev` on a throwaway local D1 (`.wrangler/smoke`), posts hits
  as two sites and a bot would, runs the cron, and checks the API's numbers end to end.
- To look at it: `npm run dev`, add the demo site once
  (`npm run site:add -- demo Demo http://localhost:8787`), open `http://localhost:8787/demo`
  to fire hits and `http://localhost:8787/` with the token from `.dev.vars`.
- Deploys are the user's call (`npm run deploy`); never deploy or commit without being asked.
