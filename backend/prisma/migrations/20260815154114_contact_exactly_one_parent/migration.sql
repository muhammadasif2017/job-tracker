-- Backstops the ContactParentRef union invariant (exactly one of jobId /
-- companyId, never both, never neither) at the DB level. The current API
-- surface already enforces this in ContactsService, so this is
-- defense-in-depth against a future raw-SQL/admin-tool/ORM-bug path, not a
-- fix for a live bug.
ALTER TABLE "contacts" ADD CONSTRAINT "contact_exactly_one_parent"
  CHECK (("jobId" IS NOT NULL) <> ("companyId" IS NOT NULL));
