#!/usr/bin/env bash
# PreToolUse on Bash: commits, tags, pull requests and releases carry the user's name only (CLAUDE.md).
# Exit 2 blocks the call. One that starts a git commit or tag, or a gh pr or release (line start, or
# after && || ; | or an opening paren; options between the verb and the subcommand still match; a
# `sh -c '…'` is scanned whole) is blocked when it adds a co-author or a "Generated with Claude"
# line, or puts another author or committer on it (--author, -c user.name/user.email, GIT_AUTHOR_*,
# GIT_COMMITTER_*).
cmd=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input.command||"")}catch(e){}})')
start='(^|&&|\|\|?|;|\()[[:space:]]*([A-Z_]+=[^[:space:]]*[[:space:]]+)*'
opts='([[:space:]]+-[^|&;]*)?[[:space:]]+'
verbs="(git${opts}(commit|tag)|gh${opts}(pr|release))([^a-z-]|$)"
if printf '%s\n' "$cmd" | grep -Eq "${start}${verbs}" ||
   { printf '%s\n' "$cmd" | grep -Eq '(^|&&|\|\|?|;|\()[[:space:]]*(ba|z|da)?sh[[:space:]]+-c' && printf '%s\n' "$cmd" | grep -Eq "$verbs"; }; then
  if printf '%s\n' "$cmd" | grep -Eiq 'co-authored-by|generated with \[?claude|noreply@anthropic\.com|--author|-c[[:space:]]+user\.(name|email)|GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL)'; then
    echo "Blocked by .claude/hooks/guard-bash.sh: commits, tags, PRs and releases carry the user's name only: no Co-Authored-By, no Claude attribution, no other author." >&2
    exit 2
  fi
fi
exit 0
