#!/usr/bin/env bash
# Stop: what is stored is documented in docs/privacy.md (CLAUDE.md). If the visitor flag or the
# schema changed in this session and the notice did not, Claude is sent back to update it.
input=$(cat)
# A second run after this hook already blocked once: let the turn end.
printf '%s' "$input" | grep -q '"stop_hook_active":[[:space:]]*true' && exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
changed=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null | sort -u)
if printf '%s\n' "$changed" | grep -Eq '^(src/visitor\.js|migrations/.*\.sql)$' && ! printf '%s\n' "$changed" | grep -q '^docs/privacy\.md$'; then
  echo "src/visitor.js or migrations/ changed but docs/privacy.md did not. Update the privacy notice to match what is stored, or explain why nothing stored changed." >&2
  exit 2
fi
exit 0
