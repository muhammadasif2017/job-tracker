#!/usr/bin/env node
// coverage-diff.mjs — coverage of the lines this change added, not the whole repo.
//
// Reads the lcov both suites already write (no second test run) and intersects it
// with the diff against the base. Project coverage is a number you inherited;
// coverage of changed lines is one the change can actually move.
//
// Usage: node scripts/coverage-diff.mjs [--base <ref>] [--min <pct>] [--warn]
//   --warn  report and exit 0 (the warn phase in CONSTRAINTS.md)
// Exit: 0 clean/warn, 1 below threshold, 2 could not run.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const base = arg('--base', 'origin/main');
const min = Number(arg('--min', '80'));
const warnOnly = process.argv.includes('--warn');

const git = (args) => {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
};

const mergeBase = git(['merge-base', base, 'HEAD'])?.trim();
if (!mergeBase) {
  console.error(`coverage-diff: no merge base against ${base}`);
  process.exit(2);
}

// lcov paths are relative to each package; normalise everything to repo-relative.
const LCOV = [
  { file: 'backend/coverage/lcov.info', root: 'backend' },
  { file: 'frontend/coverage/lcov.info', root: 'frontend' },
];

const covered = new Map(); // repo-relative path -> Map(line -> hits)
let anyLcov = false;
let lcovMtime = 0;
for (const { file, root } of LCOV) {
  if (!existsSync(file)) continue;
  anyLcov = true;
  lcovMtime = Math.max(lcovMtime, statSync(file).mtimeMs);
  let current = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.startsWith('SF:')) {
      const raw = line.slice(3).trim();
      const abs = resolve(root, raw);
      current = relative(process.cwd(), abs).split(sep).join('/');
      if (!covered.has(current)) covered.set(current, new Map());
    } else if (line.startsWith('DA:') && current) {
      const [ln, hits] = line.slice(3).split(',').map(Number);
      covered.get(current).set(ln, hits);
    }
  }
}
if (!anyLcov) {
  console.error('coverage-diff: no lcov found. Run `npm run test:cov` in backend and frontend first.');
  process.exit(2);
}

// Added lines per file, from the unified diff's hunk headers.
const diff = git(['diff', '--unified=0', mergeBase, '--']) ?? '';
const addedLines = new Map();
let file = '';
let lineNo = 0;
for (const line of diff.split('\n')) {
  if (line.startsWith('+++ ')) {
    file = line.slice(6).replace(/\r$/, '');
  } else if (line.startsWith('@@')) {
    const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
    lineNo = m ? Number(m[1]) : 0;
  } else if (line.startsWith('+') && !line.startsWith('+++')) {
    if (!addedLines.has(file)) addedLines.set(file, []);
    addedLines.get(file).push(lineNo);
    lineNo += 1;
  }
}

let total = 0;
let hit = 0;
const gaps = [];
for (const [f, lines] of addedLines) {
  const lineMap = covered.get(f);
  if (!lineMap) continue; // not an instrumented source file
  for (const ln of lines) {
    if (!lineMap.has(ln)) continue; // not an executable line
    total += 1;
    if (lineMap.get(ln) > 0) hit += 1;
    else gaps.push(`${f}:${ln}`);
  }
}

if (total === 0) {
  // "Nothing to measure" and "the lcov predates the change" print the same green
  // line, and a permanently-broken check is worse than no check. If a changed
  // source file is newer than the report, the report cannot describe it.
  const SOURCE =
    /^(backend\/src\/|frontend\/(app|components|features|lib|store)\/).*\.(ts|tsx)$/;
  const stale = [...addedLines.keys()].filter((f) => {
    if (!covered.has(f) && !SOURCE.test(f)) return false;
    try {
      return statSync(f).mtimeMs > lcovMtime;
    } catch {
      return false;
    }
  });
  if (stale.length > 0) {
    console.error('coverage-diff: the lcov report predates these changed files:');
    for (const f of stale.slice(0, 10)) console.error(`  ${f}`);
    console.error('Run `npm run test:cov` in the package you touched, then re-run.');
    process.exit(2);
  }
  console.log('coverage-diff: no instrumented lines changed');
  process.exit(0);
}

const pct = (hit / total) * 100;
const label = `${pct.toFixed(1)}% of ${total} changed executable line(s) covered (floor ${min}%)`;
if (pct >= min) {
  console.log(`coverage-diff: ${label}`);
  process.exit(0);
}
const report = [`coverage-diff: ${label}`, 'Uncovered:', ...gaps.slice(0, 30).map((g) => `  ${g}`)];
if (gaps.length > 30) report.push(`  ...and ${gaps.length - 30} more`);
if (warnOnly) {
  console.log(report.join('\n'));
  console.log('(warn phase — not blocking. See CONSTRAINTS.md.)');
  process.exit(0);
}
console.error(report.join('\n'));
process.exit(1);
