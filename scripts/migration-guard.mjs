#!/usr/bin/env node
// migration-guard.mjs — a new Prisma migration must declare its data-loss impact.
//
// Merging a migration to main migrates production with no second approval gate
// (backend/Dockerfile.prod runs `prisma migrate deploy` on container start), so
// the declaration is the only place the impact is stated before it is irreversible.
//
// Every migration.sql added against the base must start with one of:
//   -- data-loss: none
//   -- data-loss: <what data this destroys, and why that is acceptable>
// A destructive statement (DROP, TRUNCATE, ALTER COLUMN ... TYPE) may not
// declare `none`.
//
// Usage: node scripts/migration-guard.mjs [--base <ref>]   (default base: origin/main)
// Exit: 0 clean, 1 violation, 2 could not run.
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
  console.error(`migration-guard: no merge base against ${base}`);
  process.exit(2);
}

const MIGRATION = /^backend\/prisma\/migrations\/.+\/migration\.sql$/;

const changed = (git(['diff', '--name-only', '--diff-filter=ACMR', mergeBase, '--']) ?? '')
  .split('\n')
  .map((l) => l.trim());
const untracked = (git(['ls-files', '--others', '--exclude-standard']) ?? '')
  .split('\n')
  .map((l) => l.trim());

const files = [...new Set([...changed, ...untracked])].filter((f) => MIGRATION.test(f) && existsSync(f));

if (files.length === 0) {
  console.log('migration-guard: no migrations in this change');
  process.exit(0);
}

// `DROP DEFAULT` and `DROP NOT NULL` relax a constraint; they do not destroy rows.
const DESTRUCTIVE =
  /\b(DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE|INDEX|CONSTRAINT)|TRUNCATE|DELETE\s+FROM|ALTER\s+COLUMN[^;]*\bTYPE\b)/i;

const problems = [];
for (const f of files) {
  const sql = readFileSync(f, 'utf8');
  const decl = sql.match(/^\s*--\s*data-loss:\s*(.+)$/im);
  if (!decl) {
    problems.push(`${f}: no "-- data-loss:" declaration. Add one as the first line.`);
    continue;
  }
  const value = decl[1].trim();
  const destructive = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .some((l) => DESTRUCTIVE.test(l));
  if (destructive && /^none\.?$/i.test(value)) {
    problems.push(`${f}: declares "data-loss: none" but contains a destructive statement.`);
  }
}

if (problems.length === 0) {
  console.log(`migration-guard: ${files.length} migration(s) declare their impact`);
  process.exit(0);
}
console.error(`migration-guard: ${problems.length} problem(s):`);
for (const p of problems) console.error(`  ${p}`);
console.error('');
console.error('Merging this to main migrates production on the next container start.');
console.error('State the impact in the migration, and confirm it with the user before merging.');
process.exit(1);
