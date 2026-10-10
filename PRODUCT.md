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
for the admin token once, keeps it in `localStorage`, reads `/api/scene` for the village and
`/api/stats` and `/api/event` for the ledger, and listens on `/live` (a WebSocket relayed by the
`Live` Durable Object, opened with a 60-second ticket). The view lives in the query string, so a
URL is a bookmark to a site, the open ledger, its range and an open event.
`/demo` fires pageviews and events during local development; `/privacy` is the public notice.

## Capabilities and Constraints

- The village (since 2026-10-05, replacing the bay; the owner asked for 3D and picked the clock
  square of three village options, then three art directions after web research): snowed-in
  villages on a polar winter day, one per site, side by side in a valley with a frozen lake
  under the mountains. In each, a house per page
  (every page of the last 30 days) in a ring round a clock square, storeys today's pageviews on
  one scale for every site, warm windows from the ground up for the share of loads used
  (`$engaged`), a brass band at yesterday's storeys up to this time (on a rod over the roof when
  yesterday was taller), the way to its door as wide and worn as today's visits, with their
  footprints; 24 street lamps round the square for today's pageviews by UTC hour, a brass ring
  at yesterday's, the current hour glowing; a gate per referrer (every one, then direct) in the
  wall, as wide as today's arrivals, with the footprints of who came through it; a market stall per view opened inside a page (`screen`
  events with a `view`, since 2026-10-05; the owner asked for the views in the scene and picked
  the market of three options; since 2026-10-06 every view, in rows of 10, 16, 22 round the
  tower: the owner wants nothing grouped, so the lamps and the houses move out as the counts
  need; since 2026-10-10 the village is as big as the site's visits, the 30 days' pageviews
  and views in steps of ×3 from 10, the busier site always the wider, the houses on rings
  when one is not enough and fields filling the rest: the owner's sites have few visits, so
  the steps start low) round the clock tower, the green
  lanterns lit on a pole beside it, from the ground up, today's opens on one scale for every
  site, boarded up when nobody opened it; the clock telling the UTC time on a 24-hour dial, like the
  ring of lamps (midnight at the top), under a pennant in the village's colour; every live pageview a villager (a scarf and a hat in its gate's colour) walking from its
  gate to its house and leaving steps that fade in a minute, every
  view opened one walking from that house to the stall, every other event fireworks over the
  roof; a sign per village (visitors, change against
  yesterday, views, other events, used). Clicking a village flies the camera in; drag turns, wheel or pinch
  zooms. Each village is built in its site's kit (since 2026-10-06; the owner wanted the villages
  to differ and to carry each site's look, set by them, never guessed): alpine (timber, a
  palisade with towers), stone (pale stone, slate spires, a rampart with round towers, cold lamps),
  citadel (red roofs, a belfry, battlements) and umbra (asked for a dark mood: near-black slate,
  an iron fence, pale light, motes, and a village that casts its own shade, so it sits in
  half-light even at noon); the walls about three times the old low wall, as the owner found it
  too small; the counts read the same in every kit. The site's own icon flies on a long banner (since the same evening: the first, a square
  of the site's colour, put Pharloom's black icon on orange; now the cloth is the icon's own
  ground, or a dark one, the icon trimmed to its mark, the site's colour a thin band) over
  its tower and sits on its sign (`site:icon` fetches it once; the Worker serves it, since the
  CSP only loads the dashboard's own images and blobs). The objects (since 2026-10-06, a round on each thing; the owner took every proposal):
  timber-framed houses with windows on all four sides, because the plain boxes hid the used
  share on their backs; no garlands, which turned a busy market into a web; the old palisade of
  stakes gave way to a low wall that same day, then to each kit's own taller wall with towers; and what is not a count
  varies by the page's seed (width, gable or hip roof, the colour of door and shutters, a
  balcony, a woodpile or a bench), so no two houses are alike. Warm pools of light on the snow, ink outlines, smoke and snowfall; at UTC
  midnight the windows go dark. The look (since 2026-10-06; the owner asked for something more
  attractive and spectacular that still costs next to nothing at rest, and picked "polar day" of
  three options, with the sky by the clock): the village photographed like a scale model (a
  lens that blurs what is off the plane in focus, the glow of lamps and windows, contact
  shadows, snow with drifts and glitter, long soft shadows), the camera low enough for the
  mountains and the sky to be in the picture, the lake mirroring them, and a light that follows
  the viewer's own clock through a polar winter day: a low golden sun from 10:30 to 14:30, dusk,
  the blue hour, the night with its aurora from 20:00 to 5:30, the blue hour again, dawn. The sun
  never clears the mountains by much, so the lit windows (the used share) read at any hour.
  `?hour=13.5` holds the clock there. WebGL2 written by hand (`public/gl.js`, the scene in
  `public/village.js`); without WebGL2 a note sends the owner to the ledger. The rule behind it:
  atmosphere in the light, a chart's structure in the forms (storeys compare as bars, one channel
  per metric, a number beside each), and real rendering craft (light, shadow, outline), because
  flat-shaded boxes read as ugly.
- Today, one by one (since 2026-10-03; two tabs since the same day, the single list read as
  confusing): a panel beside the scene (a sheet on a phone). *Visits*: newest first, live, every
  page load in bold with its referrer's gate colour, and between them, lighter and stepped in, the
  views opened in a page (`screen` events with a `view`), *Hide views* to hide those; a click
  unfolds a row with every field it holds and today's counts around it (page, referrer, country,
  device). *Events*: the same list, one row per event with its properties, under a pill per name
  with today's count that filters it, an open row linking to the ledger's event detail. Every row
  names its site. Rounded so a row is not a fingerprint (the minute, the device class, browser and
  system families; no width, no second, no id), never joining a view to a visit, empty at UTC midnight.
  Pointing at a row rings its house and gate in the scene, or a view's house and stall.
- Sound (since 2026-10-05; the owner heard three directions and picked steps and bells, one
  stroke at midnight, no wind bed), off until the dock's Sound button asks for it and remembered
  on that browser: what the scene shows, for the ear. Two steps in the snow at the gate (their
  colour is the gate), a hand bell at the door (its pitch is the page, a pentatonic scale, the
  top page the lowest; an octave answers for a new visitor), a wind chime at the stall, the
  fireworks far off, one stroke of the tower at UTC midnight; each village from its side of the
  valley. Synthesised with Web Audio (`public/sound.js`), no files. A busy moment sounds four
  cues of a kind and shows the rest. Remembered on, it waits for the first click, as browsers
  demand. With sound on, the volume is a slider that comes up over the button while the pointer
  or the keyboard's focus is on either, and for a moment after sound is switched on (all a
  touch screen gets); it never stays
  (the owner asked, 2026-10-05). The usual at 80, silence at 0, about 4 dB more at 100,
  remembered too. Wide windows only: a phone has no button and no sound.
- Sites (since 2026-10-07; the owner wanted adding, dressing and editing a site to be much
  simpler than three shell commands, and picked a drawer in the dock, with the real village as the
  preview, of three options: a drawer, a page of its own, editing in the valley): *Sites* in the
  dock opens a drawer like the ledger's, a card per site and one form for a new site or an edit.
  Name (the id slugged from it, fixed once saved: pages carry it), origins one per line, the kit
  as four cards with its colours, the palette turned round a hue wheel and made lighter or darker
  (the material only: roofs, timber, stone, walls, shutters, awnings; never lamps, windows, the
  clock or the motes, which are counts; the owner chose this over a free palette per site, so
  every colour is still a token turned), one of the eight site colours (stored, so adding a site
  no longer recolours the others), *Surprise me*, and the icon fetched from the site or chosen as
  a file. Every change dresses the village there and then; a new site stands as a draft village
  on the next lot, with a canned day so its kit shows houses, gates and stalls, a dashed sign that
  says "not saved yet", nobody walking in. Cancel puts the saved look back. After a save, the tag
  to paste. *Remove site…* asks for the id typed, and removes the site with its hits. Then the
  second step (the same day; the owner asked for instructions for the site's own repository, maybe
  a prompt, and picked a Wire tab of three options: the tab, a prompt alone, a FOOTWORN.md file):
  each card has *Settings* and *Wire*, and saving a new site opens *Wire*: the steps that wired the
  calculators (the tag on every page, generated pages and the 404 too; a guarded `track()`; a line
  in the privacy notice; the CSP; tagged links; the docs), each with its snippet, and one button
  that copies them as a prompt for a coding agent. The owner chose that the agent reads the code
  and proposes which views and actions to track, asking before adding more than a few. A line
  waits for the site's first live visit and turns green with its page and referrer (or says
  today's pageviews, for a site already counting): the proof the wiring works, without leaving
  the panel. The look from the site itself (the same day; the owner asked whether AI could design
  each village, and agreed on AI that chooses, never one that invents geometry or colours outside
  the tokens): *Suggest from the site* fills the form from the site's own page, by colour rules
  that always answer (theme colour, colour scheme, the icon's pixels) and, with an
  `ANTHROPIC_API_KEY` (the owner picked the Claude API), by Claude reading its title, description,
  icon and preview image for the mood; the village previews it and nothing is saved until the
  owner saves. And the pieces: the kit stays the starting point, and its spire, wall, roofs, shade
  and motes can each be set apart from it (the owner chose pieces over the kit, open to both the
  owner and the suggestion), in the kit's own colours. On a phone
  the drawer is a full sheet, so the preview shows once it is put away.
- Another day (since 2026-10-06; the owner asked to go back a day, or to any day, and picked the
  day strip of three options: a stepper, the strip, a calendar): *History* in the dock brings up
  a strip over it with the last 60 days as bars of visitors (30 on a phone, under the title),
  every bar a button, `‹ ›`, a date field for any day and *Today*. The village is then that day
  as it ended (`/api/scene?day=`): houses, gates and stalls of the 30 days up to it, that day's
  counts, every lamp lit, nothing live and no sound; the title panel wears the accent. The owner
  chose counts only for a past day: the visits panel lists nothing and offers that day in the
  ledger, so the privacy record stands as it was. The day is in the URL (`&day=`); the strip is
  remembered open or shut, and putting it away comes back to today.
- The ledger, a drawer over it, per site and range (1, 7, 30, 90 days or custom): totals
  (visitors, pageviews, events), a day chart (pageviews as bars, visitors as a line), hour or
  weekday and screen-width profiles, and top-30 tables for pages, referrers, events, countries,
  languages, browsers, systems, devices. An event opens a detail with its own day chart, pages
  and property breakdowns. It is the scene's text alternative.
- Zero runtime dependencies, no framework, no build: classic scripts and plain CSS. The
  dashboard's CSP allows no inline code, so no inline styles or scripts.
- The dashboard lives on a second screen, so it has to cost next to nothing at rest: the lit
  scene is drawn once and kept, everything costly (lens, glow, contact shadow, sky, mirror) is
  in that one drawing, a frame is that picture plus what moves (30 a second while it
  snows; with reduced motion none until a visit comes or the light has moved on, a few minutes
  apart at most), the picture's own passes (sky, mirror, glow, lens) run again every four
  seconds over the scene as it was drawn, into a second kept picture the first fades to, so the
  sky moves on (measured on 2026-10-06, headless Chrome at 1920×1080, 20 s at rest: 30 frames a
  second before and after, no drawing of the scene in either, 25 % of a core before and 26 %
  after, 27 to 29 % with the timber houses, the wall and the market of poles; two flights of
  the camera, 62 % before and 66 to 69 % after), no `backdrop-filter` over the canvas,
  and no CSS animation that runs at the screen's rate (they go in `steps()`). The sound follows
  the same rule: no bed under the cues, no audio context until sound is on, and that context
  asleep a few seconds after the last cue.
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
