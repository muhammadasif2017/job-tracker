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

# Never block branch deletion — deleting a branch is not "pushing to main",
# regardless of which branch happens to be checked out at the time.
case " $cmd " in
  *" --delete "*|*" -d "*) exit 0 ;;
esac

# Find the explicit push target, if any (e.g. `git push origin some-branch`),
# distinct from whatever branch is currently checked out. Old-style delete
# refspecs (`:branch`, empty local side) are treated as deletes and allowed.
push_args=${cmd#*git push}
explicit_target=""
for tok in $push_args; do
  case "$tok" in
    :*) exit 0 ;;                        # old-style delete refspec
    -*) continue ;;                      # flags (-u, --force, -f, --tags, ...)
    origin|upstream) continue ;;         # remote name
    *:*) explicit_target="${tok#*:}" ;;  # refspec local:remote — remote side wins
    *) [ -z "$explicit_target" ] && explicit_target="$tok" ;;
  esac
done

target_main=0
if [ -n "$explicit_target" ]; then
  case "$explicit_target" in
    main|master|refs/heads/main|refs/heads/master) target_main=1 ;;
  esac
else
  # No explicit target (bare `git push` / `git push origin`) pushes the
  # current branch.
  case "$branch" in
    main|master) target_main=1 ;;
  esac
fi

if [ "$target_main" = "1" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Direct push to main/master is not permitted. Push your feature branch and open a PR instead."}}\n'
  exit 0
fi

exit 0
