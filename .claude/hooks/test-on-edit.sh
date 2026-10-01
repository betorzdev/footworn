#!/usr/bin/env bash
# PostToolUse on Edit|Write: a change under src/ or test/ runs the unit tests at once. A failure
# goes back to Claude (exit 2) with the runner's output.
file=$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s).tool_input.file_path||"")}catch(e){}})')
case "$file" in
  "$CLAUDE_PROJECT_DIR"/src/*|"$CLAUDE_PROJECT_DIR"/test/*|src/*|test/*) ;;
  *) exit 0 ;;
esac
cd "$CLAUDE_PROJECT_DIR" || exit 0
out=$(node --test test/*.test.js 2>&1) && exit 0
echo "npm test fails after editing $file:" >&2
echo "$out" | grep -vE '^\s*$' | tail -40 >&2
exit 2
