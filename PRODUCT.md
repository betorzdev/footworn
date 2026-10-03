# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the owner of a couple of static sites (the Hallownest and Pharloom calculators),
who opens the dashboard once a day or once a week, from a laptop or a phone, to see how the
sites are doing: visitors and pageviews over the range, which screens get opened, from where.
Nobody else sees the dashboard; the token is the only door.

Visitors of the host sites meet Footworn only through `/privacy`, linked from the site's own
privacy notice, when they want to know what is counted.

## Product Purpose

A visit counter for static sites that needs no consent banner: it stores nothing identifying,
so it fits the audience-measurement exemption (Spain's LSSI 22.2 as the AEPD reads it). One
Cloudflare Worker on the free plan: collector, 1 KB tracker, D1 database, JSON API, dashboard.
Success is a glance that answers "how are the sites doing" and an owner who never has to think
about cookies, consent or retention.

## Positioning

The counter whose whole data model is the regulator's list of what is strictly necessary. The
daily visitor flag is derived from a salt destroyed every night; no hash, IP or User-Agent is
ever stored. `docs/privacy.md` maps every stored column to the AEPD's list.

## Operating Context

Deployed at `footworn.<account>.workers.dev`. The dashboard (`public/index.html`, `app.js`) asks
for the admin token once, keeps it in `localStorage`, reads `/api/scene` for the bay and
`/api/stats` and `/api/event` for the ledger, and listens on `/live` (a WebSocket relayed by the
`Live` Durable Object, opened with a 60-second ticket). The view lives in the query string, so a
URL is a bookmark to a site, the open ledger, its range and an open event.
`/demo` fires pageviews and events during local development; `/privacy` is the public notice.

## Capabilities and Constraints

- The bay (since 2026-10-03, replacing the snowfield, which read as unclear): a night bay seen
  from the front, one district per site with a tower per page (30-day top 8, plus other pages),
  heights today's pageviews on one scale for every site, warm windows from the ground up for the
  share of loads used (`$engaged`), cool for the rest; a sign per district (visitors, live, used,
  change against yesterday); every live hit a light on the shore road. Clicking a district zooms
  into its skyline: towers from busiest to quietest, a lane per referrer (top 5, elsewhere,
  direct), every hit a car with a trail, every event a searchlight. Rain, reflections, always
  night; at UTC midnight the windows go dark. A 2D canvas (`public/city.js`). The rule behind it,
  from three rounds of design options: atmosphere in the light, a chart's structure in the forms
  (front views so heights compare as bars, only data objects in focus, a number beside each).
- Today, one by one (since 2026-10-03; two tabs since the same day, the single list read as
  confusing): a panel beside the scene (a sheet on a phone). *Visits*: newest first, live, every
  page load in bold with its referrer's lane colour, and between them, lighter and stepped in, the
  views opened in a page (`screen` events with a `view`), *Hide views* to hide those; a click
  unfolds a row with every field it holds and today's counts around it (page, referrer, country,
  device). *Events*: the same list, one row per event with its properties, under a pill per name
  with today's count that filters it, an open row linking to the ledger's event detail. Every row
  names its site. Rounded so a row is not a fingerprint (the minute, the device class, browser and
  system families; no width, no second, no id), never joining a view to a visit, empty at UTC midnight.
  Pointing at a row rings its tower and lane in the scene.
- The ledger, a drawer over it, per site and range (1, 7, 30, 90 days or custom): totals
  (visitors, pageviews, events), a day chart (pageviews as bars, visitors as a line), hour or
  weekday and screen-width profiles, and top-30 tables for pages, referrers, events, countries,
  languages, browsers, systems, devices. An event opens a detail with its own day chart, pages
  and property breakdowns. It is the scene's text alternative.
- Zero runtime dependencies, no framework, no build: classic scripts and plain CSS. The
  dashboard's CSP allows no inline code, so no inline styles or scripts.
- Every colour, typeface and spacing of the dashboard comes from `public/tokens.css`, the only
  design source; there is no DESIGN.md by decision (`docs/backlog.md`).
- Web fonts are possible only if self-hosted or allowed by `public/_headers`; the current CSP
  allows no external origins.
- English only. The scene has its own light (the viewer's hour); the panels and the ledger
  follow the system scheme, with a Dark/Light override.

## Brand Commitments

The name "Footworn": a path worn by feet, the trace that visits leave. No logo yet. Voice:
short, plain, factual, as in the privacy notice.

## Evidence on Hand

Real data from two sites in production since 2026-10-01; local demo data via `npm run dev`.
No logo, no illustration, no screenshots to reuse.

## Product Principles

- Nothing identifying, ever: a design never asks for a field the privacy record cannot justify.
- A glance, not a session: the owner wants the answer in seconds, on any screen.
- Honest numbers: aggregate counts, shown as what they are, never dressed as insight.
- Lightweight all the way down: the dashboard ships as a few plain files behind a strict CSP.

## Accessibility & Inclusion

Keyboard access, visible focus, reduced-motion support and screen-reader column headers are
already in place and must survive any visual change. Chart data is also available as a table.
