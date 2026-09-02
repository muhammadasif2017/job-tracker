import {
  civilMsIn,
  localCivilDay,
  safeTimeZone,
  startOfLocalMonth,
  zonedInstantFromCivil,
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

  describe('zonedInstantFromCivil', () => {
    it('round-trips a wall clock back to the instant that shows it', () => {
      const instant = new Date('2026-07-09T22:00:00Z');
      const civil = civilMsIn(instant, 'Asia/Karachi');
      expect(zonedInstantFromCivil(civil, 'Asia/Karachi')).toEqual(instant);
    });

    it('round-trips across a DST transition', () => {
      // US DST ended 2026-11-01; a November instant sits on a different
      // offset than the one a naive single-pass guess would measure.
      const instant = new Date('2026-11-15T12:00:00Z');
      const civil = civilMsIn(instant, 'America/New_York');
      expect(zonedInstantFromCivil(civil, 'America/New_York')).toEqual(instant);
    });
  });

  describe('startOfLocalMonth', () => {
    it('anchors to the user calendar, not the server one', () => {
      // 20:00 UTC on Jun 30 is already July in Karachi — "this month" must
      // agree with the calendar on the user's wall.
      const instant = new Date('2026-06-30T20:00:00Z');
      expect(startOfLocalMonth(instant, 'Asia/Karachi').toISOString()).toBe(
        '2026-06-30T19:00:00.000Z',
      );
      expect(startOfLocalMonth(instant, 'UTC').toISOString()).toBe(
        '2026-06-01T00:00:00.000Z',
      );
    });
  });
});
