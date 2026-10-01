# Privacy: what Footworn stores, and why that needs no consent banner

Footworn is built to fit the exemption for audience measurement in Spain's LSSI art. 22.2 as the
AEPD reads it ("Guía uso de cookies para herramientas de medición de audiencia", January 2024;
the same line as the CNIL's). Under it, a counter needs no consent when its only purpose is to
measure the site's own audience, it serves the publisher alone, it produces anonymous statistics,
it never cross-references with other processing or passes data on, and it never follows a person
across sites. The guide lists what counts as strictly necessary; this is how each stored field
maps to it.

| Stored (`hits`)            | The guide's list                                                    |
|----------------------------|---------------------------------------------------------------------|
| `path`, `day`              | Audience, page by page                                              |
| `ref` (hostname only)      | Pages a link was followed from ("referrer"), per page, daily        |
| `browser`, `os`, `device`, `width` | Device type, browser and screen size, per page, daily       |
| `event`, `props`           | User actions (clicks, selections), per page, daily                  |
| `country`                  | Geographic area of origin, per page, daily                          |
| `lang`                     | Part of the browser's description (its language setting)            |
| `first`                    | The daily "unique visitor" flag (a count, not an identifier)        |

Not in the list and therefore not collected: load time, time on page, bounce, scroll depth
(allowed by the guide, just not built yet) and anything beyond it, above all session journeys
(the sequence of pages one person saw), which would need a consent banner.

## The visitor flag

`first` is decided at write time, for pageviews only (an event is an action on a page already
counted and is never a visitor): SHA-256 of `salt | site | ip | user-agent` goes into `seen`
with `INSERT OR IGNORE`; a new row means the first pageview of the day. The salt is random, lives in
`meta` for one UTC day and is replaced by the nightly cron (`src/index.js`, `nightly()`), which
also empties `seen`. The hash is never written to `hits`, the IP and the User-Agent are never
written anywhere, and after midnight nothing can be recomputed. GoatCounter keeps the same
tuple in memory for 8 hours; Plausible hashes with a daily salt as well.

## Guarantees the guide asks of the publisher

1. **Inform**: the site's privacy notice names the counter and what it collects, and links to
   `/privacy` (served from `public/privacy.html`).
2. **No long-lived identifiers**: Footworn sets nothing in the browser at all.
3. **Retention ≤ 25 months**: `RETENTION_MONTHS` in `wrangler.toml` (25), applied nightly.
4. **Review it periodically**: this file and the schema are the record of what is kept.

Cloudflare acts as a processor (its DPA covers GDPR art. 28; the D1 database is created with
`--location weur`, Western Europe). The publisher stays the controller, as with any hosted
counter; the guide's section C (an outside provider) is satisfied by the DPA plus this
configuration record.

## What the tracker sends

`{ s, p, r, w, l, e?, props? }`: site id, pathname (no query, no hash), `document.referrer`,
`innerWidth`, `navigator.language`, and for an event its name and a flat object of short strings.
The edge adds the country; the Worker reads the User-Agent and the IP only to derive browser/OS
families and the daily flag, and discards them.
