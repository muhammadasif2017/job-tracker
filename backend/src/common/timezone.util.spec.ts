import {
  civilDaysAgo,
  localCivilDay,
  safeTimeZone,
  startOfCivilMonth,
} from './timezone.util.js';

describe('timezone.util', () => {
  describe('safeTimeZone', () => {
    it('passes a valid IANA zone through', () => {
      expect(safeTimeZone('Asia/Karachi')).toBe('Asia/Karachi');
    });

    it('falls back to UTC for null, empty, or garbage zones', () => {
      // The column is validated on write, but a hand-edited row must not be
      // able to 500 the dashboard from inside Intl.
      expect(safeTimeZone(null)).toBe('UTC');
      expect(safeTimeZone('')).toBe('UTC');
      expect(safeTimeZone('Mars/Olympus_Mons')).toBe('UTC');
    });
  });

  describe('localCivilDay', () => {
    it('resolves an instant to the calendar day the user would call it', () => {
      // 22:00 UTC on the 9th is already 03:00 on the 10th in Karachi (+5).
      const instant = new Date('2026-07-09T22:00:00Z');
      expect(localCivilDay(instant, 'Asia/Karachi').toISOString()).toBe(
        '2026-07-10T00:00:00.000Z',
      );
      expect(localCivilDay(instant, 'UTC').toISOString()).toBe(
        '2026-07-09T00:00:00.000Z',
      );
    });

    it('resolves a behind-UTC zone backwards across the same boundary', () => {
      const instant = new Date('2026-07-10T02:00:00Z');
      expect(localCivilDay(instant, 'America/New_York').toISOString()).toBe(
        '2026-07-09T00:00:00.000Z',
      );
    });
  });

  describe('startOfCivilMonth', () => {
    it('anchors to the user calendar, not the server one', () => {
      // 20:00 UTC on Jun 30 is already July in Karachi — "this month" must
      // agree with the calendar on the user's wall. The bound itself is a
      // civil date, because `appliedAt` is one (ADR-034); a real instant here
      // would carry a time-of-day the column never has.
      const instant = new Date('2026-06-30T20:00:00Z');
      expect(startOfCivilMonth(instant, 'Asia/Karachi').toISOString()).toBe(
        '2026-07-01T00:00:00.000Z',
      );
      expect(startOfCivilMonth(instant, 'UTC').toISOString()).toBe(
        '2026-06-01T00:00:00.000Z',
      );
    });
  });

  describe('civilDaysAgo', () => {
    it('counts back from the user calendar day, landing on midnight', () => {
      // Karachi already reads Jul 10, so 30 days back is Jun 10 — not Jun 9,
      // which is what counting from the UTC day would give.
      const instant = new Date('2026-07-09T22:00:00Z');
      expect(civilDaysAgo(instant, 'Asia/Karachi', 30).toISOString()).toBe(
        '2026-06-10T00:00:00.000Z',
      );
      expect(civilDaysAgo(instant, 'UTC', 30).toISOString()).toBe(
        '2026-06-09T00:00:00.000Z',
      );
    });

    it('stays on midnight across a DST transition', () => {
      // US DST ended 2026-11-01; a naive `now - 30*86400000` would land an
      // hour off midnight and half-exclude the boundary day.
      const instant = new Date('2026-11-15T12:00:00Z');
      expect(civilDaysAgo(instant, 'America/New_York', 30).toISOString()).toBe(
        '2026-10-16T00:00:00.000Z',
      );
    });
  });
});
