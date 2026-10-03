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

## The snowfield, next (agreed 2026-10-03)

- **Replay**: a day, or a week, played back in about 20 seconds with a scrubber, from the
  10-minute blocks `/api/scene` already returns.
- **Sound**: an optional sonification, one soft note per hit (page as pitch, device as timbre).
- **Country off the live view**: a switch (a var in `wrangler.toml`) for publishers who prefer
  not to see it per visit; `docs/privacy.md` already says how.
- **Big numbers in the ledger's column charts**: the left axis clips labels past four digits
  (`frame()` in `public/ledger.js`, `L: 36`).

## Later, by anyone

- **`.claude/rules/` with path scoping** if `CLAUDE.md` grows past about 80 lines.
- **Superpowers** (Jesse Vincent) is not planned: its value is in large, multi-agent projects.
