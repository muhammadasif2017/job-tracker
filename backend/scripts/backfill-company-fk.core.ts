import { CompanyCity } from '@prisma/client';

// Narrow slice of PrismaClient this script actually touches — lets
// backfill-company-fk.spec.ts (see the roots config in package.json) drive
// runBackfill against plain jest mocks instead of a real PrismaClient.
// No side effects at module scope (unlike backfill-company-fk.ts, which
// reads process.argv and opens a real DB connection) so importing this file
// for tests is safe.
export interface BackfillClient {
  job: {
    findMany(args: {
      where: { companyId: null };
      select: { id: true; userId: true; company: true };
    }): Promise<{ id: string; userId: string; company: string }[]>;
    update(args: {
      where: { id: string };
      data: { companyId: string };
    }): Promise<unknown>;
  };
  company: {
    findFirst(args: {
      where: { userId: string; name: { equals: string; mode: 'insensitive' } };
      select: { id: true };
    }): Promise<{ id: string } | null>;
    create(args: {
      data: { userId: string; name: string; city: typeof CompanyCity.OTHER };
      select: { id: true };
    }): Promise<{ id: string }>;
  };
}

export interface BackfillSummary {
  totalCandidates: number;
  blank: number;
  matchedExisting: number;
  createdNew: number;
  unmatched: string[];
}

export async function runBackfill(
  prisma: BackfillClient,
  apply: boolean,
  log: (...args: unknown[]) => void = console.log,
  warn: (...args: unknown[]) => void = console.warn,
): Promise<BackfillSummary> {
  const candidates = await prisma.job.findMany({
    where: { companyId: null },
    select: { id: true, userId: true, company: true },
  });

  const toBackfill = candidates.filter((job) => job.company.trim().length > 0);
  const blank = candidates.length - toBackfill.length;

  log(
    `${apply ? 'APPLY' : 'DRY RUN'}: ${candidates.length} jobs with no companyId ` +
      `(${toBackfill.length} have a company name, ${blank} are blank and stay unlinked).`,
  );

  let matchedExisting = 0;
  let createdNew = 0;
  const unmatched: string[] = [];
  // Dry-run-only: tracks companies this run "would create" so repeated new
  // company names within the same batch are deduped in the report, same as
  // they would be once actually applied.
  const pendingNewCompanies = new Map<string, string>();

  for (const job of toBackfill) {
    const trimmedName = job.company.trim();
    const key = `${job.userId} ${trimmedName.toLowerCase()}`;

    let companyId = (
      await prisma.company.findFirst({
        where: {
          userId: job.userId,
          name: { equals: trimmedName, mode: 'insensitive' },
        },
        select: { id: true },
      })
    )?.id;

    if (companyId) {
      matchedExisting++;
    } else if (!apply && pendingNewCompanies.has(key)) {
      matchedExisting++;
      companyId = pendingNewCompanies.get(key);
    } else if (!apply) {
      createdNew++;
      pendingNewCompanies.set(key, '(dry-run-placeholder)');
      continue;
    } else {
      try {
        companyId = (
          await prisma.company.create({
            data: {
              userId: job.userId,
              name: trimmedName,
              city: CompanyCity.OTHER,
            },
            select: { id: true },
          })
        ).id;
        createdNew++;
      } catch (err: unknown) {
        // Unique-constraint race, same as JobsService.create.
        companyId = (
          await prisma.company.findFirst({
            where: {
              userId: job.userId,
              name: { equals: trimmedName, mode: 'insensitive' },
            },
            select: { id: true },
          })
        )?.id;
        if (!companyId) {
          unmatched.push(job.id);
          warn(`Unmatched job ${job.id}:`, err);
          continue;
        }
        matchedExisting++;
      }
    }

    if (apply && companyId) {
      await prisma.job.update({ where: { id: job.id }, data: { companyId } });
    }
  }

  log(
    `${apply ? 'Applied' : 'Would apply'}: matched existing company ${matchedExisting}, ` +
      `created new company ${createdNew}, unmatched (needs manual resolution) ${unmatched.length}.`,
  );
  if (unmatched.length > 0) {
    log('Unmatched job IDs:', unmatched);
  }

  return {
    totalCandidates: candidates.length,
    blank,
    matchedExisting,
    createdNew,
    unmatched,
  };
}
