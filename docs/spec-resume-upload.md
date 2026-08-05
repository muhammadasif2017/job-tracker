# Spec: Resume Upload

## Objective

Users can attach one PDF resume to a job application. The resume is uploaded when creating or editing a job, stored in the cloud (Oracle Object Storage in prod, local disk in dev), and viewable/downloadable from the job detail view.

**User stories:**
- As a user, I can upload a PDF resume when creating or editing a job application
- As a user, I can view or download the resume attached to a job
- As a user, I can replace the resume on a job with a new upload
- As a user, I can remove the resume from a job

## Tech Stack

Existing stack plus:
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — Oracle Object Storage (S3-compat)
- `@types/multer` — dev dependency (multer ships with NestJS)

## Commands

```bash
# Backend
npx prisma migrate dev --name add-resume      # after schema change
npx prisma generate                           # regenerate client
```

## Project Structure

```
backend/
  src/
    resumes/
      resumes.module.ts
      resumes.controller.ts
      resumes.service.ts
      dto/
        resume-response.dto.ts
    storage/
      storage.module.ts           # global module
      storage.service.ts          # IStorageService interface + factory
      local-storage.service.ts    # dev: writes to uploads/, serves via endpoint
      oracle-storage.service.ts   # prod: S3-compatible OCI
  uploads/                        # gitignored, dev only

frontend/
  components/
    resume-upload.tsx             # upload input + view/download/remove buttons
```

## Data Model

```prisma
model Resume {
  id           String   @id @default(cuid())
  jobId        String   @unique
  job          Job      @relation(fields: [jobId], references: [id], onDelete: Cascade)
  originalName String
  size         Int
  storageKey   String   @unique
  createdAt    DateTime @default(now())
}
```

`Job` gets:
```prisma
resume  Resume?
```

Ownership is derived through `job.userId`. Storage key format: `resumes/{userId}/{jobId}/{cuid}.pdf`.

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/resumes/jobs/:jobId` | Upload PDF for a job (replaces existing) |
| `GET` | `/resumes/jobs/:jobId/url` | Get presigned URL (view or download) |
| `DELETE` | `/resumes/jobs/:jobId` | Remove resume from job + delete from storage |

**File validation:** max 8 MB, MIME type must be `application/pdf`.

All endpoints verify that `job.userId === req.user.id` before proceeding.

## Storage Abstraction

```typescript
interface IStorageService {
  upload(key: string, buffer: Buffer, mimeType: string): Promise<void>
  getPresignedUrl(key: string, expiresIn?: number): Promise<string>
  delete(key: string): Promise<void>
}
```

`StorageModule` reads `STORAGE_DRIVER=local|oracle` env var and provides the correct implementation. Local driver serves files via `GET /resumes/file/:key` (dev only).

## Frontend Behavior

**ResumeUpload component** (inside JobForm and job detail):
- No resume attached: shows file input button ("Attach Resume")
- Resume attached: shows filename, "View" button (opens presigned URL in new tab), "Download" button (same URL, triggers download), "Remove" button
- On upload: validates PDF + 8 MB client-side before sending, shows progress, replaces existing on success
- On remove: confirms with user before calling DELETE

## Boundaries

- **Always:** Validate file type and size server-side, verify job ownership before any resume operation
- **Ask first:** Adding other file formats, adding virus scanning, changing the storage key scheme
- **Never:** Store file contents in the database, expose another user's resume, serve files without a presigned URL in production

## Success Criteria

- [ ] User can upload a PDF on job create or edit
- [ ] Uploaded file stored in Oracle Object Storage (prod) / `uploads/` (dev)
- [ ] Job detail shows filename, View, Download, and Remove buttons
- [ ] Uploading a new PDF replaces the previous one (old file deleted from storage)
- [ ] Removing a resume deletes it from storage and the DB record
- [ ] Deleting a job also deletes its resume from storage
- [ ] Files over 8 MB are rejected with a clear error message
- [ ] Non-PDF files are rejected with a clear error message
- [ ] Users cannot access another user's resume
