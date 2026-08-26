# Manual Test Checklist

Use-cases to verify by hand, grouped by module. Check off as tested.

## Auth
- [ ] Register → login → session persists on refresh
- [ ] Login wrong password / nonexistent email → error shown, no crash
- [ ] OAuth callback flow (`(auth)/callback`) success + failure/denied path
- [ ] Logout clears session, protected routes redirect to login
- [ ] PAT create/list/revoke — revoked token fails on API
- [ ] Session expiry mid-use → graceful redirect, no silent failure

## Jobs (core)
- [ ] Create job manually (all fields incl. optional ones)
- [ ] Create job via parsing (paste JD text/URL) — check extraction accuracy, malformed input handling
- [ ] Edit job — clear an optional field, verify it persists as cleared (null vs undefined, ADR-022)
- [ ] Delete job → cascades to its contacts/interview-rounds
- [ ] Job status transitions (applied → interview → offer → rejected) — dashboard/stats update accordingly
- [ ] "Attention" flag shows correctly, clears once addressed
- [ ] Filtering/sorting jobs list, pagination
- [ ] Access another user's job by ID directly (URL tamper) → 403/404

## Contacts / Interview Rounds (child-of-job)
- [ ] Add/edit/delete contact under a job
- [ ] Add/edit/delete interview round under a job
- [ ] Access contact/round via a jobId you don't own → blocked
- [ ] Office Location field displays/saves correctly everywhere

## Companies
- [ ] Create/edit company, link to job
- [ ] Dedupe/autocomplete behavior when linking existing company

## Resumes
- [ ] Upload valid resume file
- [ ] Upload oversize/wrong-type file → limit enforced
- [ ] Delete resume, job references stay correct

## Enrichment
- [ ] Trigger enrichment on a job/company, verify data populates
- [ ] Enrichment failure/timeout handled gracefully

## Notifications / Email
- [ ] Scheduled notification triggers at right time (e.g. interview reminder)
- [ ] Email actually sends via Resend, content/template correct
- [ ] Resend `{error}` response contract handled (not assumed to throw)

## Dashboard
- [ ] Stats charts render correct counts, update live after job changes
- [ ] Code-split charts load without flash/error
- [ ] Empty state (zero jobs) renders sanely

## Admin
- [ ] Non-admin user hitting admin routes → blocked
- [ ] Admin actions work end-to-end

## Profile
- [ ] Update profile fields, clear optional field persists as null
- [ ] Token management page: create/revoke PAT from UI

## Cross-cutting
- [ ] Full reload on every major route — no hydration errors
- [ ] Browser back/forward through flows
- [ ] Mobile/narrow viewport on dashboard + job form
- [ ] Network failure mid-request (backend down) → frontend shows error, not silent hang
- [ ] Concurrent edit: two tabs edit same job, verify no data loss
