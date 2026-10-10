# Backlog

Agreed on 2026-10-01 after a review of what reliable sources (Anthropic's Claude Code guidance,
Simon Willison, Addy Osmani, Cloudflare's and Vercel's skills, Chartability, NN/g, Paul Bakaus'
Impeccable, Emil Kowalski) recommend for agent-assisted work and for a small analytics dashboard.
Done that day: hooks in `.claude/`, the `run-footworn` skill, CI, observability in `wrangler.toml`,
and the dashboard's keyboard access, column headers, bar contrast, chart data tables, inline
errors, loading state, URL state, reduced motion, focus rings and press feedback.

## Installed on 2026-10-01

- **Cloudflare `wrangler` and `workers-best-practices`** at user level (`~/.claude/skills/`, via
  `npx skills add cloudflare/skills -s wrangler workers-best-practices -a claude-code -g --copy`).
  User level on purpose: third-party skills stay out of the repo. The plugin route
  (`/plugin marketplace add cloudflare/skills`, `/plugin install cloudflare@cloudflare`) adds the
  Cloudflare docs MCP on top; optional.
- **`store-field`** project skill in `.claude/skills/`: the checklist for any change to what is
  stored (AEPD list, migration, tests, privacy notice).
- **Vercel `web-design-guidelines`** at user level, installed by the user and run once over
  `public/`: skip link, `name`/`autocomplete` on inputs, placeholder with an example, tap
  highlight and `touch-action` on controls, `text-wrap: balance`, curly apostrophes, `Intl`
  axis labels, error copy with a next step, `aria-live` on the totals, inline style out of
  `privacy.html`. Two rules left alone on purpose: the token field keeps `autofocus` behaviour
  (single primary input) and the day tables keep ISO dates (they are the API's key).
  Safe to remove now (`npx skills remove web-design-guidelines -g`).
- **Emil Kowalski's `mobile-native`** at user level, installed by the user and run once: hover
  gated behind `(hover: hover) and (pointer: fine)`, tap highlight off on `html`, 16px inputs on
  coarse pointers (`--fs-touch`), `user-select: none` on controls, `viewport-fit=cover` with
  safe-area padding on `.wrap`. Not applied on purpose: `overscroll-behavior: none` (the
  dashboard is a scrolling document, pull-to-refresh is welcome) and a second `theme-color`
  (one scheme). None of this reproduces in emulation: confirm on a phone. Safe to remove now
  (`npx skills remove mobile-native -g`). His animation skills are not for this dashboard.
- **Impeccable** (Paul Bakaus) at user level, installed by the user without its post-edit hook
  and run once: the deterministic detector found nothing in `public/`; the manual `audit`,
  `harden` and `polish` playbooks gave placeholder contrast, selection/caret/accent theming,
  44px controls (`--tap`), compact totals past a million, a Retry button on load errors, a
  disabled Open button while the token is checked, and a next step when no site is registered.
  Skipped on purpose: `document` (a `DESIGN.md` would duplicate `tokens.css`, which CLAUDE.md
  names as the single source) and `critique` (a scoring exercise for choosing a redesign
  direction; none is wanted). Safe to remove now: delete `~/.claude/skills/impeccable` and the
  four `~/.claude/agents/impeccable-*.md` files.

## To do, by the user (the agent's permission mode refused these installs)

- **`/security-review`** once before the next deploy: the dashboard keeps the token in the
  browser and `/c` accepts posts from anyone.
- **Verify CI**: `.github/workflows/ci.yml` has not run yet. The smoke test boots `wrangler dev`
  and uses `pgrep`; if the first run fails on the runner, that is where to look.
- **Verify traces**: `[observability.traces]` in `wrangler.toml` follows Cloudflare's skill; if
  the next deploy rejects it, drop that table and keep `[observability] enabled = true`.

## Design record (2026-10-01)

- `PRODUCT.md` at the root is the product truth Impeccable reads; keep it current when users,
  purpose or constraints change. `DESIGN.md` is still not written on purpose: `tokens.css` is
  the single design source. `.impeccable/` (the surface brief with the direction contract, the
  review screenshots) is gitignored, session material only.

## The village, next (agreed 2026-10-05, carried over from the bay)

- **Replay**: a day, or a week, played back in about 20 seconds with a scrubber (villagers and
  lamps from the hour counts, or from 10-minute blocks added back to `/api/scene`). Since
  2026-10-06 the village can be turned back to any day as it ended (`public/history.js`, the
  strip of days); the replay would play that day, with the strip as its scrubber. Still open
  there: the date field has no earliest day (a day past the retention is an empty village), and
  today's bar moves with the five-minute reload, not with each live visit.
- **Sound**: done on 2026-10-05 (`public/sound.js`; `PRODUCT.md` has what each cue is). Heard
  and left out that day: a music box (one note per hit, nothing at the gate), footsteps alone
  (no notes), twelve strokes at midnight, and a wind bed, which would keep the audio thread
  awake at rest. Still open: the live socket closes while the tab is hidden, so nothing sounds
  from a tab put away; the levels were set by measure, not on many speakers; on a wide touch
  screen the volume slider only comes up for a moment after sound is switched on.
- **Rings of houses**: done on 2026-10-10, with the village sized by its visits (steps of ×3,
  the busier site always wider) and the scene moved to the last 7 days. The fields first put in
  what is left were replaced the same day by a workshop per event (option B of `design/fields`).
  Still open there: the owner picking each event's workshop in the Sites panel (today it comes
  from the event's name), and the six kinds repeat from the seventh event on.
  Also, the five gate colours repeat from the sixth referrer on; more `--village-lane-*` tokens
  if a site with many referrers finds that confusing.
- **Sky by the clock**: done on 2026-10-06 ("polar day": `LIGHTS` and `DAY` in `public/village.js`,
  the colours of each light in `tokens.css`; `PRODUCT.md` has the look and what it costs). Seen
  that day and left out: "Storybook", the same world through a brush filter (Kuwahara), whose
  strokes barely showed. Still open: the aurora is soft curtains, not yet fine rays; the lens
  shift that brings the horizon into the picture is off on a narrow screen, which keeps the old
  high view; the cost on the GPU of one drawing of the scene, or of the sky's tick, was not measured
  (headless Chrome gave no usable timing), only Chrome's CPU and the count of drawings.
- **The Sites panel**: done on 2026-10-07 (`public/sites.js`, `src/sites.js`): add, dress, edit and
  remove a site from the dashboard, the village as the preview; the icon fetched again with one
  button. Its second step the same day: a *Wire* tab with the steps for the site's own repository
  and a prompt for a coding agent (`public/wire.js`), and a line that turns green with the first
  live visit. Seen and left out there: a prompt alone (nothing to read without an agent, no check)
  and a `FOOTWORN.md` file to drop in the site's repository (a copy that goes stale). Seen that day and left out: a settings page of its own (no preview) and editing in the
  valley (a popover on a sign: hard to find, poor on a phone); an icon from a pasted image URL; a
  free palette per site (every role editable), which would break `tokens.css` as the one source.
- **The look from the site itself**: done on 2026-10-07 (`public/look.js`, the colour rules;
  `src/look.js`, the page read and Claude's reading with an `ANTHROPIC_API_KEY`; the pieces over the
  kit, `PIECES`). Still open: a screenshot of the page (Browser Rendering) for Claude to look at,
  left out as it costs more than the icon and the preview image; and how the suggestions land on
  real sites with a key, which only the owner's first tries will tell.
- **A kit per village**: done on 2026-10-06 (`KIT` in `public/village.js`, `--style`, `site:icon`).
  Seen in that round and left out: a wall chosen apart from the kit (each kit keeps its own), and
  the old low wall. Still open: the icon is fetched once, by hand; a site that changes its icon
  needs `site:icon` again. A fifth kit is a block in `KIT` plus its tokens.
- **Country off the live view**: a switch (a var in `wrangler.toml`) for publishers who prefer
  not to see it per visit; `docs/privacy.md` already says how.
- **Big numbers in the ledger's column charts**: the left axis clips labels past four digits
  (`frame()` in `public/ledger.js`, `L: 36`).
- **Performance on weak GPUs**: done on 2026-10-05 for the resting cost (the scene is drawn once
  and kept, see the head of `public/gl.js`; `PRODUCT.md` has the rule). Still open: the camera's
  flight draws the whole scene 60 times a second, with a 2048 shadow map and, since 2026-10-06,
  the picture's passes at fewer taps; if a phone struggles there, drop the shadow map to 1024
  and `DRAFT_PX` in `gl.js`, and the contact shadow and the lens while it flies.
- **The visits list, row by row**: a live visit redraws the 200 rows of the panel (four times a
  second at most); insert the new row instead if a busy site makes that show.

## Measuring the calculators, next (agreed 2026-10-03)

Done that day: the *used* rate (`$engaged`) and link tags (`?ref=`, `?utm_source=`).

- **Funnels and a key action in the ledger**: `import-open → import-read → save-import` as ratios
  of daily counts, and one key event per site ÷ visitors. Nothing new stored.
- **Notes on the day chart**: dated marks ("patch 1.0.3", "Reddit post") to explain spikes; a
  small table and a write endpoint behind the token.
- **Google Search Console** for both calculators, by the user: the queries and impressions before
  the visit, which Footworn never sees.

## Later, by anyone

- **`.claude/rules/` with path scoping** if `CLAUDE.md` grows past about 80 lines.
- **Superpowers** (Jesse Vincent) is not planned: its value is in large, multi-agent projects.
