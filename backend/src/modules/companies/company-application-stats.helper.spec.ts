import { JobStatus } from '@prisma/client';
import {
  EMPTY_APPLICATION_STATS,
  getCompanyApplicationStats,
} from './company-application-stats.helper.js';
import { buildSilentJobWhere } from '../jobs/ghost-suggestions.helper.js';
import {
  REPLIED_FILTER,
  SENT_APPLICATION_FILTER,
} from '../jobs/jobs.constants.js';
import { PrismaService } from '../../prisma/prisma.service.js';

const mockPrisma = { job: { groupBy: jest.fn() } };
const prisma = mockPrisma as unknown as PrismaService;

const NOW = new Date('2026-09-14T12:00:00Z');

// groupBy call order: sent, replied, ghosted.
function mockGroups(
  sent: object[],
  replied: object[] = [],
  ghosted: object[] = [],
) {
  mockPrisma.job.groupBy
    .mockResolvedValueOnce(sent)
    .mockResolvedValueOnce(replied)
    .mockResolvedValueOnce(ghosted);
}

describe('getCompanyApplicationStats', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: NOW });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs no queries for an empty id list', async () => {
    const stats = await getCompanyApplicationStats(prisma, 'user-1', []);

    expect(stats.size).toBe(0);
    expect(mockPrisma.job.groupBy).not.toHaveBeenCalled();
  });

  // Row-level semantics (WISHLIST excluded, replied-then-silent, dismissed,
  // future interview) are evaluated by the database, so they run in the e2e
  // suite. Here the where clauses are pinned exactly.
  it('scopes every query to the user and requested companies', async () => {
    mockGroups([]);

    await getCompanyApplicationStats(prisma, 'user-1', ['c1', 'c2']);

    const scope = { userId: 'user-1', companyId: { in: ['c1', 'c2'] } };
    const [sent, replied, ghosted] = (
      mockPrisma.job.groupBy.mock.calls as [Record<string, unknown>][]
    ).map((c) => c[0]);
    expect(sent).toEqual({
      by: ['companyId'],
      where: { ...scope, ...SENT_APPLICATION_FILTER },
      _count: { _all: true },
      _max: { appliedAt: true },
    });
    expect(replied.where).toEqual({
      ...scope,
      ...SENT_APPLICATION_FILTER,
      ...REPLIED_FILTER,
    });
    expect(ghosted.where).toEqual({
      ...scope,
      OR: [{ status: JobStatus.GHOSTED }, buildSilentJobWhere('user-1', NOW)],
    });
  });

  it('ignores ghost-suggestion dismissals when counting ghosted', async () => {
    mockGroups([]);

    await getCompanyApplicationStats(prisma, 'user-1', ['c1']);

    const ghosted = mockPrisma.job.groupBy.mock.calls[2][0];
    expect(JSON.stringify(ghosted.where)).not.toContain(
      'ghostSuggestionDismissedAt',
    );
  });

  it('merges the grouped counts per company and computes the reply rate', async () => {
    const last = new Date('2026-09-01T00:00:00Z');
    mockGroups(
      [{ companyId: 'c1', _count: { _all: 3 }, _max: { appliedAt: last } }],
      [{ companyId: 'c1', _count: { _all: 1 } }],
      [{ companyId: 'c1', _count: { _all: 2 } }],
    );

    const stats = await getCompanyApplicationStats(prisma, 'user-1', ['c1']);

    expect(stats.get('c1')).toEqual({
      applied: 3,
      replied: 1,
      ghosted: 2,
      replyRate: 33.3,
      lastAppliedAt: last,
    });
  });

  it('returns zeroed stats for companies with no jobs', async () => {
    mockGroups(
      [
        {
          companyId: 'c1',
          _count: { _all: 1 },
          _max: { appliedAt: NOW },
        },
      ],
      // A row for an id nobody asked for, or a null companyId, is ignored.
      [{ companyId: null, _count: { _all: 5 } }],
      [{ companyId: 'other', _count: { _all: 5 } }],
    );

    const stats = await getCompanyApplicationStats(prisma, 'user-1', [
      'c1',
      'c2',
    ]);

    expect(stats.get('c2')).toEqual(EMPTY_APPLICATION_STATS);
    expect(stats.get('c1')).toMatchObject({ applied: 1, replied: 0 });
    expect(stats.has('other')).toBe(false);
  });

  it('does not share one stats object between companies', async () => {
    mockGroups([
      { companyId: 'c1', _count: { _all: 2 }, _max: { appliedAt: NOW } },
    ]);

    const stats = await getCompanyApplicationStats(prisma, 'user-1', [
      'c1',
      'c2',
    ]);

    expect(stats.get('c2')?.applied).toBe(0);
    expect(EMPTY_APPLICATION_STATS.applied).toBe(0);
  });
});
