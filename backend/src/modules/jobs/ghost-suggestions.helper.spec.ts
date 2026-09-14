import { JobStatus } from '@prisma/client';
import {
  GHOST_AFTER_DAYS,
  MAX_GHOST_SUGGESTIONS,
  getGhostSuggestions,
} from './ghost-suggestions.helper.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const mockPrisma = { job: { findMany: jest.fn() } };
const prisma = mockPrisma as unknown as PrismaService;

const NOW = new Date('2026-09-14T12:00:00Z');
const CUTOFF = new Date(NOW.getTime() - GHOST_AFTER_DAYS * 24 * 60 * 60 * 1000);

describe('getGhostSuggestions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // The rule's semantics live in the where clause, which the database
  // evaluates — so the unit test pins the clause exactly. Row-level pass/fail
  // cases (13 vs 15 days, recent dismissal, future interview) run against a
  // real database in the e2e suite.
  it('queries only silent APPLIED/INTERVIEWING jobs owned by the user', async () => {
    mockPrisma.job.findMany.mockResolvedValue([]);

    await getGhostSuggestions(prisma, 'user-1');

    const { where } = mockPrisma.job.findMany.mock.calls[0][0];
    expect(where).toEqual({
      userId: 'user-1',
      status: { in: [JobStatus.APPLIED, JobStatus.INTERVIEWING] },
      appliedAt: { lt: CUTOFF },
      events: { none: { createdAt: { gt: CUTOFF } } },
      AND: [
        {
          OR: [
            { ghostSuggestionDismissedAt: null },
            { ghostSuggestionDismissedAt: { lte: CUTOFF } },
          ],
        },
        { OR: [{ nextInterviewAt: null }, { nextInterviewAt: { lt: NOW } }] },
      ],
    });
  });

  it('loads only the latest event and caps the result', async () => {
    mockPrisma.job.findMany.mockResolvedValue([]);

    await getGhostSuggestions(prisma, 'user-1');

    const call = mockPrisma.job.findMany.mock.calls[0][0];
    expect(call.include).toEqual({
      events: { orderBy: { createdAt: 'desc' }, take: 1 },
    });
    expect(call.take).toBe(MAX_GHOST_SUGGESTIONS);
  });

  it('uses the latest of event, dismissal and applied date as since', async () => {
    const appliedOnly = {
      id: 'applied-only',
      appliedAt: new Date('2026-08-01T00:00:00Z'),
      ghostSuggestionDismissedAt: null,
      events: [],
    };
    const eventLatest = {
      id: 'event-latest',
      appliedAt: new Date('2026-07-01T00:00:00Z'),
      ghostSuggestionDismissedAt: new Date('2026-07-10T00:00:00Z'),
      events: [{ createdAt: new Date('2026-07-20T00:00:00Z') }],
    };
    const dismissalLatest = {
      id: 'dismissal-latest',
      appliedAt: new Date('2026-06-01T00:00:00Z'),
      ghostSuggestionDismissedAt: new Date('2026-08-20T00:00:00Z'),
      events: [{ createdAt: new Date('2026-06-02T00:00:00Z') }],
    };
    mockPrisma.job.findMany.mockResolvedValue([
      dismissalLatest,
      appliedOnly,
      eventLatest,
    ]);

    const items = await getGhostSuggestions(prisma, 'user-1');

    // Oldest silence first — the most clearly dead application leads the list.
    expect(items.map((i) => [i.job.id, i.since])).toEqual([
      ['event-latest', eventLatest.events[0].createdAt],
      ['applied-only', appliedOnly.appliedAt],
      ['dismissal-latest', dismissalLatest.ghostSuggestionDismissedAt],
    ]);
    for (const item of items) expect(item.job).not.toHaveProperty('events');
  });

  it('returns an empty list when nothing is silent', async () => {
    mockPrisma.job.findMany.mockResolvedValue([]);

    await expect(getGhostSuggestions(prisma, 'user-1')).resolves.toEqual([]);
  });
});
