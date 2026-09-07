#!/usr/bin/env node
// dep-scan-gate.mjs — apply the CONSTRAINTS.md dependency rule to osv-scanner output.
//
// The rule is "nothing at HIGH or above", scoped to what ships. `osv-scanner`
// itself has no severity or dependency-group gate: it exits 1 on any finding at
// any severity, dev-only packages included. Left as-is, the check is stricter
// than the written bar, so it renders red for reasons the rulebook does not
// endorse — and a check that is always red teaches everyone to ignore it.
//
// This reads the scanner's JSON and gates on the documented rule instead.
// Everything below the threshold, and everything dev-only, is still printed —
// visible, not enforced.
//
// Usage: node scripts/dep-scan-gate.mjs <osv-scanner json> [--min <cvss>] [--warn]
// Exit: 0 clean (or --warn), 1 gate breach, 2 could not run.
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : fallback;
};
const MIN = Number(argOf('--min', '7.0')); // CVSS 7.0 is the HIGH floor
const warnOnly = args.includes('--warn');

if (!file || !existsSync(file)) {
  console.error(`dep-scan-gate: no scanner output at ${file ?? '<missing path>'}`);
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`dep-scan-gate: could not parse ${file}: ${err.message}`);
  process.exit(2);
}

// A package carrying `dependency_groups` is reachable only through that group
// (dev, optional). Production dependencies carry no groups field at all.
const isDevOnly = (pkg) => {
  const groups = pkg.dependency_groups;
  return Array.isArray(groups) && groups.length > 0 && !groups.includes('prod');
};

const maxSeverity = (pkg) =>
  Math.max(0, ...(pkg.groups ?? []).map((g) => parseFloat(g.max_severity) || 0));

const gating = [];
const belowThreshold = [];
const devOnly = [];

for (const result of report.results ?? []) {
  const source = result.source?.path ?? 'unknown';
  for (const pkg of result.packages ?? []) {
    const entry = {
      name: pkg.package?.name ?? '?',
      version: pkg.package?.version ?? '?',
      severity: maxSeverity(pkg),
      count: (pkg.vulnerabilities ?? []).length,
      ids: (pkg.groups ?? []).flatMap((g) => g.ids ?? []),
      source: source.replace(/^\/src\//, ''),
    };
    if (isDevOnly(pkg)) devOnly.push(entry);
    else if (entry.severity >= MIN) gating.push(entry);
    else belowThreshold.push(entry);
  }
}

const line = (e) =>
  `  ${e.severity.toFixed(1)}  ${e.name}@${e.version}  (${e.count} advisor${e.count === 1 ? 'y' : 'ies'})  ${e.source}`;

gating.sort((a, b) => b.severity - a.severity);
belowThreshold.sort((a, b) => b.severity - a.severity);

if (devOnly.length > 0) {
  console.log(`Dev-only packages with advisories (not gated, ship nothing): ${devOnly.length}`);
}
if (belowThreshold.length > 0) {
  console.log(`Production packages below the HIGH threshold (not gated):`);
  for (const e of belowThreshold) console.log(line(e));
}

if (gating.length === 0) {
  console.log(`dep-scan-gate: no production package at CVSS ${MIN}+`);
  process.exit(0);
}

const report_lines = [
  `dep-scan-gate: ${gating.length} production package(s) at CVSS ${MIN}+`,
  ...gating.map(line),
  '',
  ...gating.flatMap((e) => e.ids.map((id) => `  https://osv.dev/${id}`)),
];

if (warnOnly) {
  console.log(report_lines.join('\n'));
  console.log('(warn phase — not blocking. See CONSTRAINTS.md.)');
  process.exit(0);
}
console.error(report_lines.join('\n'));
process.exit(1);
