import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { runBackfill } from './backfill-company-fk.core.js';

// One-off backfill for phase 3 of the company single-source-of-truth
// migration (docs/specs/company-fk-phase3.md). Links pre-phase-1 jobs
// (companyId still null) to a Company row, using the same find-or-create
// logic as JobsService.create — exact case-insensitive name match, and a
// new Company (city: OTHER) when no match exists. Dry run by default; pass
// --apply to write. Core loop lives in backfill-company-fk.core.ts (see
// backfill-company-fk.spec.ts) — this file is just the CLI entry point.
//
// Usage:
//   npx ts-node scripts/backfill-company-fk.ts            (dry run, no writes)
//   npx ts-node scripts/backfill-company-fk.ts --apply     (writes)

const APPLY = process.argv.includes('--apply');

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  await runBackfill(prisma, APPLY);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
