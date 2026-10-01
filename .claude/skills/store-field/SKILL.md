---
name: store-field
description: Add, change or remove a field that Footworn stores (a column in hits, the visitor flag, an event property rule). Use whenever a change touches what is written to D1, so the privacy notice, the migration and the tests move together.
---

# Changing what is stored

Footworn's whole premise is that nothing identifying is kept and that every stored field is on the
AEPD's audience-measurement list (`docs/privacy.md` explains both). A stored field is never added
on its own; these steps go together and a Stop hook checks that `docs/privacy.md` moved with
`src/visitor.js` and `migrations/`.

1. **Is it allowed?** Open `docs/privacy.md` and find the field, or its category, in the AEPD list
   quoted there. If it is not on it, stop and say so: the answer is to not store it, not to
   argue it in. Never a cookie, browser storage, IP, User-Agent string, or a hash kept past the day.
2. **Migration**: a new numbered file in `migrations/` (`wrangler d1 migrations create DB <name>`
   prints the next number), additive and idempotent. Existing files are never edited.
3. **Code**: `src/collect.js` turns the posted body into a row; keep the validation strict and
   the failure silent (bad field → field dropped or hit dropped, still `204`). `src/stats.js`
   exposes it to the API only if the dashboard will show it.
4. **Tests**: `test/collect.test.js` for the parsing, with a bad-input case; `tools/smoke.js`
   if the API output changes.
5. **Privacy notice**: `docs/privacy.md` and `public/privacy.html` list the field, why it is
   on the list, and the retention. The two must say the same thing.
6. **Docs**: the API section of `README.md` if the response shape changed.
7. Run `npm test` and `npm run smoke`; both migrations (`npm run migrate:local`) and the
   remote one (`npm run migrate`, the user's call) are needed before deploy.
