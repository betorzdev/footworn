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
| `ref` (hostname, or the link's tag) | Pages a link was followed from ("referrer"), per page, daily |
| `browser`, `os`, `device`, `width` | Device type, browser and screen size, per page, daily       |
| `event`, `props`           | User actions (clicks, selections), per page, daily                  |
| `event = '$engaged'`       | Time on page / bounce: the page was used, not just opened           |
| `country`                  | Geographic area of origin, per page, daily                          |
| `lang`                     | Part of the browser's description (its language setting)            |
| `first`                    | The daily "unique visitor" flag (a count, not an identifier)        |

Not in the list and therefore not collected: load time and scroll depth (allowed by the guide,
just not built yet) and anything beyond it, above all session journeys
(the sequence of pages one person saw), which would need a consent banner.

## The link's tag

A link can carry `?ref=` or `?utm_source=` ("reddit", "discord"); the tracker sends it and, when it
names one of a fixed list of channels (`CHANNELS` in `src/collect.js`: social networks, chat apps,
email), it is stored in `ref` in place of the referrer, so a link posted where apps send no
referrer still shows its source. Any other value is dropped and the referrer stands: a free-form
tag could be a personal referral code (`?ref=jsmith`), an identifier this exemption does not
cover, and the list makes storing one impossible rather than a matter of good practice.

## Used, not just opened

Once per page load, the tracker sends an event named `$engaged` at the first tap or key press, or
after 10 seconds with the tab visible (the clock stops while it is hidden). The state lives in
the page's memory and dies with it; nothing is written in the browser. The row is an ordinary
event row with no properties, and the dashboard turns it into one rate: loads used ÷ pageviews,
per range and per page. That is the guide's "time on page" and "bounce", reduced to a yes.

Event names starting with `$` are Footworn's own: the tracker refuses them from the page and the
collector drops any but `$engaged`. `$engaged` never reaches the live view or today's list of
visits (below): it follows its own pageview by seconds, and showing both would join two rows into
one person.

## The visitor flag

`first` is decided at write time, for pageviews only (an event is an action on a page already
counted and is never a visitor): SHA-256 of `salt | site | ip | user-agent` goes into `seen`
with `INSERT OR IGNORE`; a new row means the first pageview of the day. The salt is random, lives in
`meta` for one UTC day and is replaced by the nightly cron (`src/index.js`, `nightly()`), which
also empties `seen`. A reload (the tracker marks it `rl`, read from the browser's own navigation
type, nothing stored) goes through the same check and is kept only when it comes out first: a
tab left open overnight counts as that day's visit, a refresh within the day counts nothing. The hash is never written to `hits`, the IP and the User-Agent are never
written anywhere, and after midnight nothing can be recomputed. GoatCounter keeps the same
tuple in memory for 8 hours; Plausible hashes with a daily salt as well.

## Today's visits, one by one

Besides the counts, the dashboard lists today's visits one by one, as they arrive and as a
history of the day. These are the only places where Footworn hands out a hit on its own rather
than a count, so they are kept narrow.

**Why rounded.** A row with every stored field at full precision (the second, the width to the
pixel, the language, browser, system and country) can single a person out on a small site
without any id. So a row leaves the database rounded, and these never leave it this way: the
width (a row says phone, tablet or desktop), the second (a row says the minute), the row id, and
anything that would join two rows. There is no journey: nothing tells that two rows are the same
person.

- **The history** (`GET /api/visits`, `visits` in `src/stats.js`): today's rows (UTC), newest
  first, at most 2000 per site: the minute, `path`, `ref` (hostname), `device`, the `browser` and
  `os` families, `lang`, `country`, `first`, and for an event its name and properties. At UTC
  midnight the list empties, as the village's windows go dark; earlier days are only counts.
  The dashboard can turn the village back to any of them (`GET /api/scene` with a `day`, and
  `GET /api/days` for its strip of days): counts again, per day, with no list of visits.
- **The live view** (`/live`, `liveMessage` in `src/live.js`): the same fields, the moment each
  hit is counted. The message carries the second in `t`, which the page needs to tell a live hit
  from one it already loaded, and which its own arrival gives away anyway; the page shows the
  minute. The `Live` Durable Object relays each message to the sockets open at that moment and
  forgets it; it has no storage of its own.
- **Who sees them**: only dashboards holding the admin token. The API takes it as a bearer; the
  socket opens with a ticket the API signs under it, good for 60 seconds (`src/ticket.js`), so
  the token never travels in a URL.
- **Why that still fits the exemption**: every field is one already stored and listed above,
  seen only by the publisher, for the site's own audience, never joined to anything else, never
  followed across pages or days. Rounding keeps a row from working as a fingerprint. A publisher
  who wants less can drop fields from `visits` and `liveMessage` (the country first); the counts
  are unaffected.

Everything else the API answers is a count: per day, per value of one dimension, or, for an
event and for a view opened inside a page, per page and per property value as well.

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
