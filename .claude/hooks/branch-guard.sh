#!/usr/bin/env bash
# PreToolUse(Bash) guard: never allow `git commit` to land directly on main/master.
# Auto-creates and switches to a feature branch (staged/uncommitted changes carry over) first.
# Branch name is slugified from the commit message subject line, not a timestamp.
read_input() {
  node -e "
let d='';
process.stdin.on('data',c=>d+=c);
process.stdin.on('end',()=>{
  try {
    const cmd = JSON.parse(d).tool_input.command || '';
    const isCommit = cmd.includes('git commit') ? '1' : '0';
    process.stdout.write(isCommit + '\n');
    let msg = '';
    let m = cmd.match(/-m\s+\"\\\$\\(cat <<'EOF'\n([\s\S]*?)\nEOF/);
    if (m) msg = m[1].split('\n')[0];
    if (!msg) {
      m = cmd.match(/-m\s+\"([^\"]+)\"/) || cmd.match(/-m\s+'([^']+)'/);
      if (m) msg = m[1].split('\n')[0];
    }
    const slug = msg
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+\$/g, '')
      .slice(0, 40)
      .replace(/-+\$/, '');
    process.stdout.write((slug || 'update') + '\n');
  } catch (e) {
    process.stdout.write('0\nupdate\n');
  }
});
"
}

mapfile -t input_lines < <(read_input)
is_commit="${input_lines[0]}"
slug="${input_lines[1]}"

if [ "$is_commit" != "1" ]; then
  exit 0
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root" || exit 0

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)

if [ "$branch" = "main" ] || [ "$branch" = "master" ]; then
  new_branch="feature/${slug:-update}"
  if git rev-parse --verify --quiet "$new_branch" >/dev/null || git rev-parse --verify --quiet "refs/remotes/origin/$new_branch" >/dev/null 2>&1; then
    new_branch="${new_branch}-$(date +%H%M%S)"
  fi
  if git checkout -b "$new_branch" >/dev/null 2>&1; then
    printf '{"systemMessage":"Branch guard: %s is protected. Created and switched to %s before committing."}\n' "$branch" "$new_branch"
  else
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"On %s and could not create a feature branch automatically. Create/checkout a branch yourself, then retry the commit."}}\n' "$branch"
  fi
fi

exit 0
