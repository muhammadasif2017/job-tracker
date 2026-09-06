-- Work policy is an attribute of an individual application, not of an
-- employer: `Job.jobType` (ONSITE | HYBRID | REMOTE) already records it per
-- job and is unaffected by this migration. `Company.workPolicy` duplicated
-- that answer at the wrong level and is removed. See ADR-041.
ALTER TABLE "Company" DROP COLUMN "workPolicy";
