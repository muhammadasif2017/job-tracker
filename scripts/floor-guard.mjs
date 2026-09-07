#!/usr/bin/env node
// floor-guard.mjs — diff-scoped enforcement of the CONSTRAINTS.md floor.
// Usage: node scripts/floor-guard.mjs [--base <ref>]   (default base: origin/main)
// Exit: 0 clean, 1 floor violation, 2 could not run.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const base = (() => {
  const i = process.argv.indexOf('--base');
  return i > -1 ? process.argv[i + 1] : 'origin/main';
})();

const git = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
};

const mergeBase = git(['merge-base', base, 'HEAD'])?.trim();
if (!mergeBase) {
  console.error(`floor-guard: no merge base against ${base}`);
  process.exit(2);
}

const tracked = git(['diff', '--unified=0', mergeBase, '--']) ?? '';

// `git diff --no-index /dev/null <file>` is not portable (it fails on Windows),
// so read untracked files directly and synthesise the same all-added diff shape.
const untracked = (git(['ls-files', '--others', '--exclude-standard']) ?? '')
  .split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
  .map((f) => {
    let body;
    try {
      body = readFileSync(f, 'utf8');
    } catch {
      return '';
    }
    if (body.includes(String.fromCharCode(0))) return ''; // binary
    return `+++ b/${f}\n` + body.split('\n').map((l) => `+${l}`).join('\n');
  })
  .join('\n');

const diff = `${tracked}\n${untracked}`;

// One path prefix per line; a file whose path starts with an entry is exempt.
const ignores = existsSync('.constraintsignore')
  ? readFileSync('.constraintsignore', 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
  : [];
const ignored = (f) =>
  ignores.some((p) => f.replace(/^[ab]\//, '').startsWith(p.replace(/\*+$/, '')));

const added = [];
const removed = [];
let file = '';
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ ')) file = line.slice(6).replace(/\r$/, '');
  else if (line.startsWith('+') && !line.startsWith('+++')) added.push({ file, text: line.slice(1) });
  else if (line.startsWith('-') && !line.startsWith('---')) removed.push({ file, text: line.slice(1) });
}

const constraintsExistedAtBase = Boolean(
  git(['ls-tree', '--name-only', mergeBase, 'CONSTRAINTS.md'])?.trim(),
);

const findings = [];
const flag = (rule, f, text) => findings.push({ rule, file: f, text: text.trim().slice(0, 120) });

const SUPPRESSIONS =
  /@ts-ignore|@ts-nocheck|@ts-expect-error|eslint-disable|istanbul ignore|nosemgrep|gitleaks:allow/;
const STUBS =
  /throw new (Error|NotImplementedException)\(\s*['"`][^'"`]*[Nn]ot implemented|catch\s*(\(\w*\))?\s*\{\s*\}|\bTODO\b|\bFIXME\b/;
const SKIPS = /\b(it|test|describe)\.(skip|todo)\b|\bxit\(|\bxdescribe\(/;
const TEST_FILE = /\.(test|spec)\.[tj]sx?$/;

for (const { file, text } of added) {
  if (!file || file === '/dev/null' || ignored(file)) continue;
  if (/CONSTRAINTS\.md$/.test(file)) {
    // The rules document names the patterns it bans, so only its own two checks
    // (a lowered number, a new exception) apply to it. On the change that first
    // introduces the file, every row is "new" — that is the baseline, not a
    // loosened rule.
    if (constraintsExistedAtBase && /^\| *[WE]\d+ *\|/.test(text)) {
      flag('new-exception', file, text);
    }
    continue;
  }
  if (SUPPRESSIONS.test(text)) flag('silenced-checker', file, text);
  if (STUBS.test(text)) flag('unfinished-work', file, text);
  if (SKIPS.test(text)) flag('test-made-easier', file, text);
}

// Assertions pulled out of a test file that still exists. Counted per file, not
// per line: a reformat rewraps assertions across different line boundaries, which
// reads as dozens of deletions line-by-line while the count is unchanged. Only a
// net loss is a weakened test.
const ASSERTION = /\b(expect|assert)\b/;
const assertionDelta = new Map();
const countAssertions = (lines, sign) => {
  for (const { file, text } of lines) {
    const f = file.replace(/^[ab]\//, '');
    if (!f || ignored(f) || !TEST_FILE.test(f) || !ASSERTION.test(text)) continue;
    assertionDelta.set(f, (assertionDelta.get(f) ?? 0) + sign);
  }
};
countAssertions(added, 1);
countAssertions(removed, -1);
for (const [f, delta] of assertionDelta) {
  if (delta < 0) flag('assertion-removed', f, `${-delta} assertion line(s) removed, none added back`);
}

// A whole test file deleted.
const deletedTests = (git(['diff', '--name-status', '--diff-filter=D', mergeBase, '--']) ?? '')
  .split('\n')
  .map((l) => l.split('\t')[1])
  .filter((f) => f && TEST_FILE.test(f) && !ignored(f));
for (const f of deletedTests) flag('test-deleted', f, 'test file removed');

// A number in CONSTRAINTS.md that went down.
const nums = (s) => (s.match(/\d+(\.\d+)?/g) || []).map(Number);
const key = (s) => (s.split(/[|:]/)[1] ?? s.split(/[|:]/)[0]).trim();
const removedC = removed.filter((l) => /CONSTRAINTS\.md$/.test(l.file));
const addedC = added.filter((l) => /CONSTRAINTS\.md$/.test(l.file));
for (const r of removedC) {
  const a = addedC.find((x) => key(x.text) === key(r.text));
  if (a && nums(a.text).some((n, i) => nums(r.text)[i] !== undefined && n < nums(r.text)[i])) {
    flag('threshold-lowered', r.file, `${r.text}  ->  ${a.text}`);
  }
}

if (findings.length === 0) {
  console.log('floor-guard: clean');
  process.exit(0);
}
console.error(`floor-guard: ${findings.length} floor violation(s):`);
for (const f of findings) console.error(`  [${f.rule}] ${f.file}: ${f.text}`);
console.error('');
console.error('Each lowers the bar. Fix the code, or add a tracked exception to CONSTRAINTS.md.');
process.exit(1);
