// Phase 5c (docs/specs/company-fk-phase5c.md) — fuzzy duplicate-company
// detection. Hand-rolled Levenshtein instead of a dependency: per-user
// company counts are small, and the algorithm is short enough that adding a
// package isn't worth it (see project CLAUDE.md — don't add a dependency
// without checking necessity first).

const COMMON_SUFFIXES = [
  'incorporated',
  'corporation',
  'limited',
  'company',
  'inc',
  'llc',
  'ltd',
  'corp',
  'co',
];

export function normalizeCompanyName(name: string): string {
  let normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const suffix of COMMON_SUFFIXES) {
    normalized = normalized.replace(new RegExp(`\\b${suffix}\\b`, 'g'), '');
  }
  return normalized.replace(/\s+/g, ' ').trim();
}

export function normalizeWebsiteUrl(url: string): string {
  return url
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const currRow = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow.push(
        Math.min(
          currRow[j - 1] + 1, // insertion
          prevRow[j] + 1, // deletion
          prevRow[j - 1] + cost, // substitution
        ),
      );
    }
    prevRow = currRow;
  }
  return prevRow[b.length];
}

// 1.0 = identical, 0.0 = completely different. Both inputs already
// normalized (see normalizeCompanyName) — this function doesn't normalize.
export function similarityRatio(a: string, b: string): number {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLength;
}
