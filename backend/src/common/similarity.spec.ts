import {
  normalizeCompanyName,
  normalizeWebsiteUrl,
  similarityRatio,
} from './similarity.js';

describe('normalizeCompanyName', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeCompanyName('  Systems   Limited! ')).toBe('systems');
  });

  it('strips common legal-entity suffixes', () => {
    expect(normalizeCompanyName('Acme Inc')).toBe('acme');
    expect(normalizeCompanyName('Acme, LLC')).toBe('acme');
    expect(normalizeCompanyName('Acme Corp.')).toBe('acme');
    expect(normalizeCompanyName('Acme Corporation')).toBe('acme');
  });

  it('does not strip a suffix that is part of a longer word', () => {
    // "co" must not match inside "cool" or "coffee"
    expect(normalizeCompanyName('Coolco')).toBe('coolco');
  });
});

describe('normalizeWebsiteUrl', () => {
  it('strips protocol, www, and trailing slash', () => {
    expect(normalizeWebsiteUrl('https://www.acme.com/')).toBe('acme.com');
    expect(normalizeWebsiteUrl('http://acme.com')).toBe('acme.com');
    expect(normalizeWebsiteUrl('ACME.com/')).toBe('acme.com');
  });
});

describe('similarityRatio', () => {
  it('returns 1 for identical strings', () => {
    expect(similarityRatio('systems', 'systems')).toBe(1);
  });

  it('returns 0 for completely different strings of the same length', () => {
    expect(similarityRatio('abc', 'xyz')).toBe(0);
  });

  it('the motivating case: "Systems Limited" vs "systems ltd." normalizes to a high ratio', () => {
    const a = normalizeCompanyName('Systems Limited');
    const b = normalizeCompanyName('systems ltd.');
    expect(a).toBe('systems');
    expect(b).toBe('systems');
    expect(similarityRatio(a, b)).toBe(1);
  });

  it('a real near-duplicate with one missing letter scores above the 0.85 threshold', () => {
    const a = normalizeCompanyName('Systems Limited');
    const b = normalizeCompanyName('System Limited'); // missing an "s"
    expect(similarityRatio(a, b)).toBeGreaterThanOrEqual(0.85);
  });

  it('two unrelated company names score below the 0.85 threshold', () => {
    const a = normalizeCompanyName('Systems Limited');
    const b = normalizeCompanyName('Acme Corporation');
    expect(similarityRatio(a, b)).toBeLessThan(0.85);
  });

  it('handles empty strings without dividing by zero', () => {
    expect(similarityRatio('', '')).toBe(1);
  });
});
