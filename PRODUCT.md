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
for the admin token once, keeps it in `localStorage`, and reads `/api/stats` and `/api/event`.
The view lives in the query string, so a URL is a bookmark to a site, range and open event.
`/demo` fires pageviews and events during local development; `/privacy` is the public notice.

## Capabilities and Constraints

- Shows, per site and range (7, 30, 90 days or custom): totals (visitors, pageviews, events),
  a day chart (pageviews as bars, visitors as a line), and top-30 tables for pages, referrers,
  events, countries, languages, browsers, systems, devices. An event opens a detail with its own
  day chart, pages and property breakdowns.
- Zero runtime dependencies, no framework, no build: classic scripts and plain CSS. The
  dashboard's CSP allows no inline code, so no inline styles or scripts.
- Every colour, typeface and spacing of the dashboard comes from `public/tokens.css`, the only
  design source; there is no DESIGN.md by decision (`docs/backlog.md`).
- Web fonts are possible only if self-hosted or allowed by `public/_headers`; the current CSP
  allows no external origins.
- English only. One scheme, light: the green ruled paper (since 2026-10-01); a dark scheme via
  `prefers-color-scheme` is in the backlog.

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
