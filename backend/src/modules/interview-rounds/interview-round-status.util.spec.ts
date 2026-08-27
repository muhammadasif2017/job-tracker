import { InterviewOutcome } from '@prisma/client';
import { deriveInterviewRoundStatus } from './interview-round-status.util.js';

describe('deriveInterviewRoundStatus', () => {
  const now = new Date('2026-08-27T00:00:00.000Z');

  it('returns SCHEDULED for a PENDING round in the future', () => {
    const scheduledAt = new Date('2026-08-28T00:00:00.000Z');
    expect(
      deriveInterviewRoundStatus(InterviewOutcome.PENDING, scheduledAt, now),
    ).toBe('SCHEDULED');
  });

  it('returns AWAITING_RESPONSE for a PENDING round scheduled in the past, within a week', () => {
    const scheduledAt = new Date('2026-08-22T00:00:00.000Z');
    expect(
      deriveInterviewRoundStatus(InterviewOutcome.PENDING, scheduledAt, now),
    ).toBe('AWAITING_RESPONSE');
  });

  it('returns POSSIBLY_GHOSTED for a PENDING round scheduled more than a week ago', () => {
    const scheduledAt = new Date('2026-08-19T23:59:59.000Z');
    expect(
      deriveInterviewRoundStatus(InterviewOutcome.PENDING, scheduledAt, now),
    ).toBe('POSSIBLY_GHOSTED');
  });

  it('passes a resolved outcome through unchanged regardless of scheduledAt', () => {
    const longAgo = new Date('2020-01-01T00:00:00.000Z');
    expect(
      deriveInterviewRoundStatus(InterviewOutcome.PASSED, longAgo, now),
    ).toBe('PASSED');
    expect(
      deriveInterviewRoundStatus(InterviewOutcome.FAILED, longAgo, now),
    ).toBe('FAILED');
    expect(
      deriveInterviewRoundStatus(InterviewOutcome.CANCELLED, longAgo, now),
    ).toBe('CANCELLED');
  });
});
