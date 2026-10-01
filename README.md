# Footworn

A small visit counter for static sites that sets no cookies, keeps no IP and needs no consent
banner. One Cloudflare Worker (free plan) with a D1 database: the collector, a 1 KB tracker, a
JSON API and a dashboard. Made for the
[Hallownest](https://github.com/betorzdev/hallownest-calculator) and
[Pharloom](https://github.com/betorzdev/pharloom-calculator) calculators, with nothing of them in it.

What it shows, per site and day range: visitors and pageviews by day, pages, referrers,
countries, languages, browsers, systems, devices, and **events with properties** (which screen
was opened, in which language, from which page). What it never stores is in
[`docs/privacy.md`](docs/privacy.md).

## Wire a site

```html
<script async src="https://footworn.<account>.workers.dev/footworn.js" data-site="your-site"></script>
```

That counts a pageview on load. From the page's own code:

```js
footworn.event('screen', { view: 'combat', lang: 'es' });   // an action, with up to 10 short properties
footworn.count('/other-page/');                              // a pageview by hand (hash routing, say)
```

The script sends nothing over `file://`, on localhost (unless `data-local="1"`), inside an
iframe, or from a browser driven by automation; `data-auto="0"` skips the pageview on load.
Without the script (blocked, offline) `window.footworn` is undefined, so call it as
`window.footworn && footworn.event(...)`.

The site has to be registered with its allowed origins, or its hits are dropped:

```sh
npm run site:add -- hallownest "Hallownest Calculator" https://betorzdev.github.io --remote
```

## Run it locally

```sh
npm install
cp .dev.vars.example .dev.vars        # the dashboard's token
npm run migrate:local                 # creates the local D1
npm run site:add -- demo Demo http://localhost:8787
npm run dev                           # http://localhost:8787
```

`/demo` fires a pageview and has buttons for events; `/` is the dashboard (paste the token from
`.dev.vars`, or open `/#token=…` once: it's saved in the browser and the URL is cleaned;
`&site=<id>&event=<name>` pick what opens first); `/privacy` is the public notice. `curl http://localhost:8787/cdn-cgi/local/scheduled`
runs the nightly cron by hand.

## Deploy (once)

1. A Cloudflare account (the Workers Free plan asks for no card) and `npx wrangler login`.
2. `npx wrangler d1 create footworn --location weur` and paste the printed `database_id` into
   `wrangler.toml` (keep `weur`: the data stays in Western Europe).
3. `npm run migrate` (applies `migrations/` to the remote database).
4. `npx wrangler secret put ADMIN_TOKEN` (a long random string; it's the dashboard's password).
5. `npm run deploy` → `https://footworn.<account>.workers.dev`.
6. Register each site with `npm run site:add -- <id> "<name>" "<origin> [<origin>…]" --remote`.

Free plan room: 100 000 requests/day and 100 000 D1 writes/day; a pageview costs two writes and
an event one, so about 50 000 pageviews a day. Retention is `RETENTION_MONTHS` in `wrangler.toml` (25, the AEPD's cap).

## API

`Authorization: Bearer <ADMIN_TOKEN>`; dates `YYYY-MM-DD`, UTC; default range the last 30 days.

- `GET /api/sites` → `[{ id, name }]`
- `GET /api/stats?site=&from=&to=` → `{ totals: { hits, visitors, events }, days: [{ day, hits, visitors, events }], path, ref, browser, os, device, country, lang, events }` — each dimension `[{ value, hits, visitors }]`, top 30.
- `GET /api/event?site=&name=&from=&to=` → `{ totals, days, paths, props: { key: [{ value, hits }] } }`
- `POST /c` — what the tracker sends: `{ s, p, r, w, l, e?, props? }`, under 8 KB; always `204`.

## Layout

```
src/index.js      the Worker: /c, /api/*, the nightly cron (export default { fetch, scheduled })
src/collect.js    a posted body → a row of hits (validation, referrer, device, props)
src/ua.js         User-Agent → browser/OS families; the bot filter
src/visitor.js    the daily salt and the "first today" flag
src/stats.js      the API's queries
src/auth.js       the bearer check
public/           footworn.js, the dashboard (index.html, app.js, style.css, tokens.css), privacy, demo,
                  _headers (nosniff and no-referrer everywhere; the dashboard's CSP: no inline code, no framing)
migrations/       the D1 schema
test/             node --test
tools/            site-add.js, smoke.js
```

## Checks

`npm test` (unit) and `npm run smoke` (end to end on a throwaway local D1 through `wrangler dev`).
