#!/usr/bin/env bash
# PostToolUse(Bash): after a feature-branch push, auto-open a PR against main if one doesn't exist yet.
cmd=$(node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(JSON.parse(d).tool_input.command||'')}catch(e){console.log('')}})")

case "$cmd" in
  *"git push"*) ;;
  *) exit 0 ;;
esac

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root" || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
[ -z "$branch" ] && exit 0
[ "$branch" = "main" ] && exit 0
[ "$branch" = "master" ] && exit 0

command -v gh >/dev/null 2>&1 || exit 0

# Confirm the push actually landed on the remote before doing anything.
git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1 || exit 0

existing=$(gh pr list --head "$branch" --json number --jq 'length' 2>/dev/null || echo 0)
[ "${existing:-0}" != "0" ] && exit 0

merge_base=$(git merge-base main HEAD 2>/dev/null)
if [ -z "$merge_base" ]; then
  pr_url=$(gh pr create --fill --base main --head "$branch" 2>/dev/null | tail -1)
else
  subjects=$(git log --reverse --format='%s' "$merge_base..HEAD" 2>/dev/null)
  count=$(printf '%s\n' "$subjects" | grep -c .)
  body=$(printf '%s\n' "$subjects" | sed 's/^/- /')
  if [ "$count" -le 1 ]; then
    # A single commit's subject is a legitimate title for a PR that is
    # currently exactly that one commit.
    pr_url=$(gh pr create --base main --head "$branch" --title "$subjects" --body "$body" 2>/dev/null | tail -1)
  else
    # No single commit subject represents an accumulated multi-commit
    # branch - guessing one (oldest, newest, whatever) just produces a
    # confidently wrong title nobody notices. Open as a draft with a
    # title that is unmistakably a placeholder, so the "needs a real
    # title" signal lives on the PR itself (gh pr list / the PR page),
    # not in a hook message that may never reach the calling agent.
    pr_url=$(gh pr create --draft --base main --head "$branch" --title "[needs title] $branch" --body "$body" 2>/dev/null | tail -1)
  fi
fi
if [ -n "$pr_url" ]; then
  printf '{"systemMessage":"Opened PR for %s: %s"}\n' "$branch" "$pr_url"
fi

exit 0
