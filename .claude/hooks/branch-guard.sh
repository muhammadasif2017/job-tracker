#!/usr/bin/env bash
# PreToolUse(Bash) guard: never allow `git commit` to land directly on main/master.
# Auto-creates and switches to a feature branch (staged/uncommitted changes carry over) first.
cmd=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input.command||'')}catch(e){console.log('')}})")

case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root" || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  new_branch="feature/auto-$(date +%Y%m%d-%H%M%S)"
  if git checkout -b "$new_branch" >/dev/null 2>&1; then
    printf '{"systemMessage":"Branch guard: %s is protected. Created and switched to %s before committing."}\n' "$branch" "$new_branch"
  else
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"On %s and could not create a feature branch automatically. Create/checkout a branch yourself, then retry the commit."}}\n' "$branch"
  fi
fi

exit 0
