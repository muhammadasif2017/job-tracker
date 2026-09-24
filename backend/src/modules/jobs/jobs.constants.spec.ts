import {
  appliedAtRangeFilter,
  rangeToCutoff,
  rangeToGranularity,
  toPercent,
  upcomingInterviewAt,
} from './jobs.constants.js';

// `buildJobWhere` and `computeTrendBuckets` are covered directly in
// jobs-stats.service.spec.ts, next to the service that uses them.

describe('toPercent', () => {
  it('rounds to one decimal place', () => {
    expect(toPercent(1, 3)).toBe(33.3);
    expect(toPercent(2, 3)).toBe(66.7);
    expect(toPercent(3, 3)).toBe(100);
  });

  it('returns 0 rather than NaN or Infinity for a zero denominator', () => {
    expect(toPercent(0, 0)).toBe(0);
    expect(toPercent(5, 0)).toBe(0);
  });
});

describe('rangeToCutoff', () => {
  // 02:30 UTC on 15 Mar: still 14 Mar in New York, already 15 Mar in Tokyo.
  const now = new Date('2026-03-15T02:30:00Z');

  it('has no lower bound for all time', () => {
    expect(rangeToCutoff('all', now)).toBeUndefined();
  });

  it('is the civil day 30 or 90 days before today, at UTC midnight', () => {
    expect(rangeToCutoff('30d', now)).toEqual(new Date('2026-02-13T00:00:00Z'));
    expect(rangeToCutoff('90d', now)).toEqual(new Date('2025-12-15T00:00:00Z'));
  });

  it("counts from the user's today, not the server's", () => {
    // ADR-034: the cutoff is a civil date on the user's calendar. In New York
    // it is still the 14th, so the window starts a day earlier.
    expect(rangeToCutoff('30d', now, 'America/New_York')).toEqual(
      new Date('2026-02-12T00:00:00Z'),
    );
    expect(rangeToCutoff('30d', now, 'Asia/Tokyo')).toEqual(
      new Date('2026-02-13T00:00:00Z'),
    );
  });

  it('carries no time-of-day, so the boundary day is not half-excluded', () => {
    const cutoff = rangeToCutoff('30d', new Date('2026-03-15T18:45:12Z'));
    expect(cutoff?.toISOString()).toBe('2026-02-13T00:00:00.000Z');
  });

  it('falls back to UTC for an unknown timezone instead of throwing', () => {
    expect(rangeToCutoff('30d', now, 'Not/AZone')).toEqual(
      rangeToCutoff('30d', now, 'UTC'),
    );
  });
});

describe('appliedAtRangeFilter', () => {
  const now = new Date('2026-03-15T12:00:00Z');

  it('is an empty fragment for all time, so it spreads to no filter', () => {
    expect(appliedAtRangeFilter('all', now)).toEqual({});
  });

  it('bounds appliedAt from below by the range cutoff', () => {
    expect(appliedAtRangeFilter('90d', now)).toEqual({
      appliedAt: { gte: new Date('2025-12-15T00:00:00Z') },
    });
  });
});

describe('upcomingInterviewAt', () => {
  const now = new Date('2026-03-15T12:00:00Z');

  it('keeps an interview that is still ahead', () => {
    const later = new Date('2026-03-16T09:00:00Z');
    expect(upcomingInterviewAt(later, now)).toBe(later);
  });

  it('keeps an interview starting exactly now', () => {
    expect(upcomingInterviewAt(now, now)).toBe(now);
  });

  it('drops a stored instant that has already passed', () => {
    expect(
      upcomingInterviewAt(new Date('2026-03-15T11:59:59Z'), now),
    ).toBeNull();
  });

  it('maps a missing value to null', () => {
    expect(upcomingInterviewAt(null, now)).toBeNull();
    expect(upcomingInterviewAt(undefined, now)).toBeNull();
  });
});

describe('rangeToGranularity', () => {
  it.each([
    ['30d', 'day'],
    ['90d', 'week'],
    ['all', 'month'],
  ] as const)('buckets %s by %s', (range, granularity) => {
    expect(rangeToGranularity(range)).toBe(granularity);
  });
});
