#!/usr/bin/env bash
# PreToolUse(Bash) guard: block `git push` that would land on main/master directly — PRs only.
cmd=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input.command||'')}catch(e){console.log('')}})")

case "$cmd" in
  *"git push"*) ;;
  *) exit 0 ;;
esac

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root" || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

target_main=0
case " $cmd " in
  *" main "*|*":main"*|*" master "*|*":master"*) target_main=1 ;;
esac

if [ "$branch" = "main" ] || [ "$branch" = "master" ] || [ "$target_main" = "1" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Direct push to main/master is not permitted. Push your feature branch and open a PR instead."}}\n'
  exit 0
fi

exit 0
