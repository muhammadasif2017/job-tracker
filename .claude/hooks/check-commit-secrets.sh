#!/usr/bin/env bash
# PreToolUse(Bash) guard: block `git commit` if staged changes include .env files or secret-looking content.
cmd=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input.command||'')}catch(e){console.log('')}})")

case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

envfiles=$(git diff --cached --name-only 2>/dev/null | grep -E '(^|/)\.env($|\.[^.]+$)' | grep -vE '\.env\.(example|sample|template)$')
if [ -n "$envfiles" ]; then
  reason="Blocked: .env file(s) staged for commit: $(echo "$envfiles" | tr '\n' ' ')"
  reason=$(printf '%s' "$reason" | sed 's/"/\\"/g')
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}\n' "$reason"
  exit 0
fi

secrets=$(git diff --cached 2>/dev/null | grep -E 'AKIA[0-9A-Z]{16}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-ant-api03-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|ghp_[A-Za-z0-9]{36}|AIza[0-9A-Za-z_-]{35}')
if [ -n "$secrets" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: possible secret pattern found in staged diff. Review before committing."}}\n'
  exit 0
fi

exit 0
