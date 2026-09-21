/**
 * The one way this codebase matches a company by the name a user typed:
 * case-insensitive, exact, scoped to that user. No fuzzy matching
 * (docs/specs/target-companies.md, Assumption 6).
 *
 * Correctness under a race never comes from a read using this clause — it
 * comes from the functional unique index on `(userId, lower(name))` (see the
 * `add_company_ci_unique` migration, ADR-029/ADR-033). Callers differ in what
 * they do with a hit: `JobCompanyLinkService.resolveCompanyId` returns it,
 * `CompaniesService.ensureNameAvailable` rejects it. Only the lookup is
 * shared.
 *
 * Deliberately does not trim: `CompaniesService` matches on the stored DTO
 * value, `JobCompanyLinkService` on an already-trimmed label. Trimming here
 * would silently change one of them.
 */
export function companyNameMatch(userId: string, name: string) {
  return { userId, name: { equals: name, mode: 'insensitive' as const } };
}
