// A Serializable-transaction write conflict reaches application code in two
// different shapes depending on WHEN Postgres detects it:
//
//   - Detected mid-transaction (e.g. a conflicting UPDATE/DELETE on a row
//     another transaction already touched) — Prisma wraps it as a normal
//     PrismaClientKnownRequestError with `code: 'P2034'`.
//   - Detected at COMMIT time (the common case for a conflict on a broader
//     predicate, like a COUNT(*) read racing a concurrent INSERT — see
//     CompaniesService.create's MAX_COMPANIES_PER_USER check) — Prisma 7's
//     client-engine-runtime + @prisma/adapter-pg does NOT wrap this: it
//     propagates a raw `DriverAdapterError` (`name: 'DriverAdapterError'`,
//     `cause: { kind: 'TransactionWriteConflict' }`) straight out of
//     `$transaction()`, with no `.code` property at all.
//
// A catch block that only checks `err.code === 'P2034'` silently misses the
// second shape — the error falls through as an unhandled 500 instead of the
// intended 409. Found via a real concurrent-request e2e test
// (app.e2e-spec.ts, "POST /companies — concurrent per-user cap") that
// happened to trigger a commit-time conflict; no mock-based unit test could
// have caught this, since the mocks only ever simulated the first shape.
export function isTransactionWriteConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; name?: unknown; cause?: unknown };
  if (e.code === 'P2034') return true;
  if (
    e.name === 'DriverAdapterError' &&
    e.cause &&
    typeof e.cause === 'object' &&
    (e.cause as { kind?: unknown }).kind === 'TransactionWriteConflict'
  ) {
    return true;
  }
  return false;
}
