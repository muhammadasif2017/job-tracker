#!/usr/bin/env bash
# PreToolUse(Bash) guard: never allow `git commit` to land directly on main/master.
# Auto-creates and switches to a feature branch (staged/uncommitted changes carry over) first.
# Branch name is slugified from the commit message subject line, not a timestamp.
#
# The hook runs before the command, in the session's working directory. So it
# judges the branch the commit will actually land on, not whatever that
# directory happens to have checked out:
#   - `cd <dir> && git commit` / `git -C <dir> commit` checks <dir>, not the
#     session directory (a commit made in another worktree used to create a
#     stray branch in the main checkout);
#   - a command that switches or creates its own branch before committing
#     (`git switch -c x && git commit`) is left alone (it used to get an empty
#     branch created and immediately abandoned);
#   - a command that switches to main before committing is denied, since a
#     branch created now would be switched away from before the commit runs.
read_input() {
  node -e "$(cat <<'JS'
let d = '';
process.stdin.on('data', (c) => (d += c));
process.stdin.on('end', () => {
  const out = (isCommit, slug, dir, mode) =>
    process.stdout.write([isCommit, slug, dir, mode].join('\n') + '\n');
  try {
    const cmd = JSON.parse(d).tool_input.command || '';
    const unquote = (s) => s.replace(/^(["'])([\s\S]*)\1$/, '$2');

    const commit = cmd.match(
      /\bgit\s+(?:-C\s+("[^"]*"|'[^']*'|\S+)\s+)?commit\b/,
    );
    if (!commit) return out('0', 'update', '', '');
    const prefix = cmd.slice(0, commit.index);

    let msg = '';
    let m = cmd.match(/-m\s+"\$\(cat <<'EOF'\n([\s\S]*?)\nEOF/);
    if (m) msg = m[1].split('\n')[0];
    if (!msg) {
      m = cmd.match(/-m\s+"([^"]+)"/) || cmd.match(/-m\s+'([^']+)'/);
      if (m) msg = m[1].split('\n')[0];
    }
    const fullSlug = msg
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    const MAX_LEN = 40;
    let slug = fullSlug;
    if (slug.length > MAX_LEN) {
      // Hard char-slicing lands mid-word or leaves a stray trailing word
      // wherever position 40 happens to fall (e.g. '...fetching-and',
      // '...branches-from') — cut back to the last full word boundary
      // instead so the name always ends cleanly.
      const cut = slug.slice(0, MAX_LEN);
      const lastDash = cut.lastIndexOf('-');
      slug = lastDash > 0 ? cut.slice(0, lastDash) : cut;
    }
    // A word-complete cut can still land on a preposition/conjunction
    // ('...branches-from', '...fetching-and') — technically whole, but
    // reads exactly like a truncated fragment. Strip trailing filler words.
    const STOPWORDS = new Set(['a','an','the','and','or','but','to','of','in','on','at','for','from','with','by','is','are']);
    const parts = slug.split('-');
    while (parts.length > 1 && STOPWORDS.has(parts[parts.length - 1])) {
      parts.pop();
    }
    slug = parts.join('-') || 'update';

    // Where the commit runs: `git -C <dir> commit`, else the last `cd <dir>`
    // before it, else the session directory.
    let dir = commit[1] ? unquote(commit[1]) : '';
    if (!dir) {
      const cds = [
        ...prefix.matchAll(/(?:^|[;&|(]\s*)cd\s+("[^"]*"|'[^']*'|[^\s;&|)]+)/g),
      ];
      if (cds.length) dir = unquote(cds[cds.length - 1][1]);
    }

    // Whether the command picks its own branch before committing. The last
    // switch/checkout wins. `git checkout -- <path>` restores files and
    // does not change branch, so it is ignored.
    let mode = '';
    const switches = [
      ...prefix.matchAll(
        /\bgit\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)\s+)?(?:switch|checkout)\b([^;&|]*)/g,
      ),
    ];
    if (switches.length) {
      const args = switches[switches.length - 1][1].trim().split(/\s+/).filter(Boolean);
      const creates = args.some((a) =>
        /^(-[cCbB]|--create|--force-create|--orphan)$/.test(a),
      );
      const target = args.find((a) => !a.startsWith('-'));
      if (!args.includes('--')) {
        if (creates) mode = 'self';
        else if (target) mode = /^(main|master)$/.test(target) ? 'main' : 'self';
      }
    }

    out('1', slug, dir, mode);
  } catch (e) {
    out('0', 'update', '', '');
  }
});
JS
)"
}

mapfile -t input_lines < <(read_input)
is_commit="${input_lines[0]}"
slug="${input_lines[1]}"
target_dir="${input_lines[2]}"
mode="${input_lines[3]}"

if [ "$is_commit" != "1" ]; then
  exit 0
fi

# The command switches to or creates a non-main branch itself before committing.
if [ "$mode" = "self" ]; then
  exit 0
fi

if [ -n "$target_dir" ]; then
  cd "$target_dir" 2>/dev/null || exit 0
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root" || exit 0

if [ "$mode" = "main" ]; then
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"This command switches to main/master and then commits. Commit on a feature branch instead."}}\n'
  exit 0
fi

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
