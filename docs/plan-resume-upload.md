# Plan: Resume Upload

Spec: [spec-resume-upload.md](spec-resume-upload.md)

## Component Map & Dependencies

```
[1] DB Schema
      ↓
[2] StorageModule (local + oracle impls)
      ↓
[3] ResumesModule (controller + service)
      ↓
[4] Jobs cascade delete wiring
      ↓
[5] Frontend ResumeUpload component
      ↓
[6] Wire into JobForm (create + edit)
[7] Wire into job detail view
```

Steps 6 and 7 can run in parallel after step 5.

## Risks

| Risk | Mitigation |
|---|---|
| Oracle OCI credentials not available locally | StorageModule falls back to `local` driver via env var — dev never touches Oracle |
| multer + NestJS ESM path issues | Use `@nestjs/platform-express` (already in project), keep multer as in-memory storage only (pass buffer to StorageService) |
| Presigned URL expiry too short for slow connections | Default to 15 min; Download forces `Content-Disposition: attachment` via a query param |
| Cascade delete leaves orphan files in storage | `ResumesService.remove()` always deletes from storage first, then DB — if storage delete fails, transaction rolls back |

## Tasks

- [ ] **Task 1: DB schema + migration**
  - Add `Resume` model, add `resume Resume?` to `Job`
  - Verify: `npx prisma migrate dev --name add-resume` runs clean, `npx prisma generate` succeeds
  - Files: `backend/prisma/schema.prisma`

- [ ] **Task 2: StorageModule**
  - `IStorageService` interface, `LocalStorageService` (disk + passthrough endpoint), `OracleStorageService` (S3-compat), factory in `StorageModule`
  - Verify: unit test — local driver writes a file and returns a working URL
  - Files: `backend/src/storage/` (4 new files)

- [ ] **Task 3: ResumesModule — service**
  - `ResumesService`: `upload()`, `getPresignedUrl()`, `remove()` — all scope-checked against `job.userId`
  - Verify: unit tests for ownership check, file-not-found, and happy path
  - Files: `backend/src/resumes/resumes.service.ts`, `resume-response.dto.ts`

- [ ] **Task 4: ResumesModule — controller + module wiring**
  - `POST /resumes/jobs/:jobId`, `GET /resumes/jobs/:jobId/url`, `DELETE /resumes/jobs/:jobId`
  - multer interceptor with 8 MB limit + PDF MIME guard
  - Verify: `npx tsc --noEmit` passes; manual curl upload test
  - Files: `resumes.controller.ts`, `resumes.module.ts`, `app.module.ts`

- [ ] **Task 5: Jobs cascade — storage cleanup**
  - Hook `JobsService` so deleting a job also calls `StorageService.delete()` on its resume's `storageKey` before the DB delete
  - Verify: delete a job with resume → file gone from `uploads/`, DB row gone
  - Files: `backend/src/jobs/jobs.service.ts`

- [ ] **Task 6: Frontend ResumeUpload component**
  - Upload state machine: idle → uploading → attached → removing
  - Client-side PDF + 8 MB validation before fetch
  - View (new tab) and Download (forced) from presigned URL
  - Verify: component renders all states correctly
  - Files: `frontend/components/resume-upload.tsx`, `frontend/lib/api.ts` (new resume API calls)

- [ ] **Task 7: Wire into JobForm**
  - Add `ResumeUpload` below the form fields; on create pass `jobId` from the POST response; on edit pass existing `job.resume`
  - Verify: create a job → upload resume → edit that job → resume still shows
  - Files: `frontend/components/job-form.tsx` (or equivalent)

- [ ] **Task 8: Wire into job detail view**
  - Show resume section on the job detail/drawer with same View/Download/Remove buttons
  - Verify: open job detail → resume visible; remove → section reverts to empty state
  - Files: job detail component
