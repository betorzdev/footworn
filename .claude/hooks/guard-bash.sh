#!/usr/bin/env bash
# PreToolUse on Bash: deploys, commits and pushes are the user's (CLAUDE.md). Exit 2 blocks the call.
# Only the start of a command counts (line start, or after && || ; | or an opening paren), so a
# heredoc or an echo that merely mentions the words goes through. Options between the verb and
# the subcommand (git -C . push, npm run --silent deploy) still match; a `sh -c '…'` is scanned
# whole, since its string is a command of its own.
cmd=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input.command||"")}catch(e){}})')
start='(^|&&|\|\|?|;|\()[[:space:]]*(npx[[:space:]]+)?'
opts='([[:space:]]+-[^|&;]*)?[[:space:]]+'
verbs="(wrangler${opts}deploy|npm[[:space:]]+run${opts}deploy|git${opts}(commit|push))([^a-z-]|$)"
if printf '%s\n' "$cmd" | grep -Eq "${start}${verbs}" ||
   { printf '%s\n' "$cmd" | grep -Eq '(^|&&|\|\|?|;|\()[[:space:]]*(ba|z|da)?sh[[:space:]]+-c' && printf '%s\n' "$cmd" | grep -Eq "$verbs"; }; then
  echo "Blocked by .claude/hooks/guard-bash.sh: deploys, commits and pushes are the user's. Propose the command instead." >&2
  exit 2
fi
exit 0
