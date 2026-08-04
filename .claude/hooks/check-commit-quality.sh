#!/usr/bin/env bash
# PreToolUse(Bash) guard: block `git commit` if staged backend/frontend .ts(x) files
# fail eslint or tsc --noEmit. Only runs against staged files in the touched package(s).
cmd=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input.command||'')}catch(e){console.log('')}})")

case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root" || exit 0

staged=$(git diff --cached --name-only --diff-filter=ACM)
backend_files=$(echo "$staged" | grep '^backend/.*\.ts$' || true)
frontend_files=$(echo "$staged" | grep -E '^frontend/.*\.tsx?$' || true)

fail_msg=""

if [ -n "$backend_files" ]; then
  rel=$(echo "$backend_files" | sed 's#^backend/##')
  out=$(cd backend && npx eslint $rel 2>&1)
  if [ $? -ne 0 ]; then
    fail_msg="${fail_msg}backend eslint failed:\n$(echo "$out" | tail -40)\n\n"
  fi
  out=$(cd backend && npx tsc --noEmit -p tsconfig.json 2>&1)
  if [ $? -ne 0 ]; then
    fail_msg="${fail_msg}backend tsc --noEmit failed:\n$(echo "$out" | tail -40)\n\n"
  fi
fi

if [ -n "$frontend_files" ]; then
  rel=$(echo "$frontend_files" | sed 's#^frontend/##')
  out=$(cd frontend && npx eslint $rel 2>&1)
  if [ $? -ne 0 ]; then
    fail_msg="${fail_msg}frontend eslint failed:\n$(echo "$out" | tail -40)\n\n"
  fi
  out=$(cd frontend && npx tsc --noEmit 2>&1)
  if [ $? -ne 0 ]; then
    fail_msg="${fail_msg}frontend tsc --noEmit failed:\n$(echo "$out" | tail -40)\n\n"
  fi
fi

if [ -n "$fail_msg" ]; then
  reason=$(printf '%s' "$fail_msg" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{process.stdout.write(JSON.stringify(d))})")
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":%s}}\n' "$reason"
  exit 0
fi

exit 0
