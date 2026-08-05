# Security Audit — Resume Feature Branch

**Date:** 2026-06-13
**Branch:** `resume-feature`
**Scope:** Resume upload, storage, file-serve, and presigned URL endpoints
**Verdict:** Conditional Pass — no Critical findings; 2 High findings fixed before merge

---

## Findings Summary

| ID | Severity | Status | Area |
|----|----------|--------|------|
| F-1 | High | Fixed | Magic byte PDF validation |
| F-2 | High | Fixed | `Content-Disposition` filename encoding |
| F-3 | Medium | Fixed | `originalName` sanitization |
| F-4 | Medium | Fixed | Upload endpoint rate limiting |
| F-5 | Medium | Fixed | Key format authorization check |
| F-6 | Low | Fixed | Multer stream size cap |
| F-7 | Low | Fixed | Presigned URL expiry signal |
| F-8 | Low | Accepted | Orphaned storage objects on delete failure |
| F-9 | Info | Deferred | OCI static credential rotation |
| F-10 | Info | Fixed | `NODE_ENV` Joi validation |

---

## Trust Boundaries Reviewed

1. `POST /jobs/:jobId/resumes` — file upload
2. `GET /jobs/resumes/file?key=` — local dev file serve
3. `GET /jobs/:jobId/resumes/url` — presigned URL
4. `DELETE /jobs/:jobId/resumes` — file delete
5. Storage key generation and path traversal
6. Oracle OCI credential handling

---

## Detailed Findings

### F-1 — High | MIME type check does not verify file magic bytes

**Location:** `backend/src/resumes/resumes.controller.ts` — `FileTypeValidator`

**Description:** NestJS's `FileTypeValidator` checks the `mimetype` field from the multipart envelope, which is supplied by the HTTP client. A malicious client can upload any file content while setting `Content-Type: application/pdf` in the request, bypassing the validator entirely.

**Impact:** Arbitrary file content (HTML, scripts, executables) stored under a `.pdf` key. In local storage mode, the file is served back via `GET /jobs/resumes/file` — a stored file that is actually HTML could be rendered by the browser. In Oracle mode, OCI serves the file with the client-supplied `ContentType`, exposing the same risk via presigned URL.

**Fix:** Added a magic byte check in `ResumesService.upload` before the storage write:

```ts
if (file.buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
  throw new UnprocessableEntityException('File must be a valid PDF');
}
```

This rejects any file whose first four bytes are not the PDF signature `%PDF`, regardless of what `Content-Type` the client declared.

---

### F-2 — High | `Content-Disposition` used UUID filename and lacked RFC 5987 encoding

**Location:** `backend/src/resumes/resumes.controller.ts` — `serveFile`

**Description:** The `Content-Disposition` header was built from `path.basename(filePath)`, which is the server-generated UUID filename (e.g. `a3f2...uuid.pdf`), not the user's original filename. Additionally, the `filename=` value was placed in a plain ASCII double-quoted string with no RFC 5987 encoding. Any future change that placed a user-supplied value there could enable HTTP header injection via special characters (newlines, semicolons).

**Impact:** Downloads prompted the user with the UUID name instead of their actual filename. The unencoded pattern was structurally unsafe for future extension.

**Fix:** The endpoint now looks up `originalName` from the database via `findByJob`, encodes it with `encodeURIComponent`, and emits both the ASCII fallback and the RFC 5987 form:

```ts
const safeName = encodeURIComponent(resume.originalName);
res.setHeader(
  'Content-Disposition',
  `${disposition}; filename="${safeName}"; filename*=UTF-8''${safeName}`,
);
```

---

### F-3 — Medium | `file.originalname` stored unsanitized

**Location:** `backend/src/resumes/resumes.service.ts` — `upload`

**Description:** `file.originalname` is the filename as sent by the HTTP client. Multer does minimal processing — the value can contain path separators (`/`, `\`), null bytes (`\0`), Unicode RTL override characters, or strings longer than 255 characters. The value was stored directly in the database and returned in API responses. React's JSX escaping prevented direct XSS, but the value was also used in `Content-Disposition` headers (see F-2), where path separators or null bytes could cause issues.

**Fix:** Sanitized before the DB write:

```ts
const originalName = file.originalname
  .replace(/[/\\]/g, '_')
  .replace(/\0/g, '')
  .slice(0, 255);
```

---

### F-4 — Medium | Upload endpoint had no per-route rate limit

**Location:** `backend/src/resumes/resumes.controller.ts` — `uploadResume`

**Description:** The global throttler allowed 100 requests per 60 seconds per IP. The upload endpoint accepts 8 MB files buffered entirely in memory. An attacker could send approximately 1.6 requests per second, each carrying 8 MB, creating up to 800 MB of heap pressure per minute before the global throttler intervened. On the project's single Oracle A1 VM with limited RAM, this is a practical DoS vector.

**Fix:** Added a tighter per-endpoint throttle:

```ts
@Throttle({ default: { ttl: 60000, limit: 5 } })
```

5 uploads per minute per user is generous for a resume manager.

---

### F-5 — Medium | `serveFile` key authorization used a positional string split

**Location:** `backend/src/resumes/resumes.controller.ts` — `serveFile`

**Description:** The ownership check extracted the userId from the storage key with `key.split('/')[1]`. This was coupled to the key format being exactly `resumes/<userId>/<jobId>/<uuid>.pdf`. If the key format ever changed (e.g. to `uploads/resumes/<userId>/...`) and the hardcoded index was not updated, the check would silently compare the wrong segment against the authenticated user's ID, potentially allowing horizontal privilege escalation.

**Impact:** Authenticated users could read other users' resume files if the key format drifted without updating the index.

**Fix:** All four segments are now validated explicitly before extraction:

```ts
const parts = key.split('/');
if (parts.length !== 4 || parts[0] !== 'resumes') {
  throw new BadRequestException('Invalid key format');
}
const [, keyUserId, jobId] = parts;
if (keyUserId !== user.id) {
  throw new ForbiddenException('Access denied to this file');
}
```

The format contract is now asserted in code; unexpected shapes throw immediately rather than extracting the wrong value.

---

### F-6 — Low | Multer buffered the full file before the size validator ran

**Location:** `backend/src/resumes/resumes.controller.ts` — `FileInterceptor`

**Description:** Multer was configured with `memoryStorage()` but no `limits` option. The entire multipart body was read into a `Buffer` before NestJS's `MaxFileSizeValidator` ran. A client sending a request larger than 8 MB would fill heap before being rejected. Chunked-encoded requests can bypass `Content-Length`-based checks at the parser level, amplifying this risk.

**Fix:** Added `limits: { fileSize: MAX_FILE_SIZE }` to the `FileInterceptor` config so the multer stream parser aborts early, before buffering exceeds the cap:

```ts
FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
})
```

---

### F-7 — Low | Presigned URL response included no expiry signal

**Location:** `backend/src/resumes/resumes.service.ts` — `getPresignedUrl`

**Description:** The presigned URL had a 15-minute TTL (900 seconds) configured in `OracleStorageService`, but the API response did not include an `expiresAt` field. Clients had no programmatic way to know when the URL would expire without hardcoding the same constant.

**Fix:** The response now includes `expiresAt`:

```ts
const expiresAt = new Date(Date.now() + PRESIGNED_URL_TTL * 1000).toISOString();
return { url, originalName: resume.originalName, expiresAt };
```

---

### F-8 — Low | Accepted | Orphaned storage objects on delete failure

**Location:** `backend/src/resumes/resumes.service.ts` — `remove`; `backend/src/jobs/jobs.service.ts` — `remove`

**Description:** After the DB record is deleted, the storage delete is fire-and-forget. A transient OCI outage or permission error leaves orphaned objects in the bucket indefinitely with no retry path, no dead-letter queue, and no metric or alert. This is a data-retention concern (GDPR relevance if users delete their account expecting full data removal) rather than an active exploit.

**Decision:** Accepted for the current portfolio scope. The failure is logged via `logger.warn`. Before production with real users, a retry mechanism (dead-letter BullMQ job or a reconciliation table) should be added.

---

### F-9 — Info | Deferred | OCI credentials are static HMAC keys

**Location:** `backend/src/storage/oracle-storage.service.ts`

**Description:** The project uses static Customer Secret Keys (HMAC) for OCI authentication. These do not rotate automatically and require manual intervention if the `.env` file is leaked or the VM is compromised.

**Preferred approach:** For workloads running on OCI Compute, Oracle's Instance Principal authentication issues short-lived, automatically rotated tokens from the instance metadata service — no credentials stored in environment variables. Migration requires switching from the AWS S3 SDK to OCI's native SDK or a custom credential provider.

**Decision:** Deferred until the project is actively deployed. Static keys are acceptable during development.

---

### F-10 — Info | `NODE_ENV` was not validated by Joi

**Location:** `backend/src/app.module.ts`

**Description:** The Swagger UI endpoint (`/api/docs`) is gated on `NODE_ENV !== 'production'`. If `NODE_ENV` was accidentally unset in the deployment environment, Swagger would be exposed in production.

**Fix:** Added `NODE_ENV` to the Joi validation schema with an explicit allowlist and safe default:

```ts
NODE_ENV: Joi.string()
  .valid('development', 'production', 'test')
  .default('development'),
```

---

## What Was Not Found

- **No IDOR vulnerabilities.** Every read, update, and delete operation scopes its Prisma query with `{ jobId, job: { userId } }`.
- **No path traversal.** `path.resolve` + `startsWith(uploadsDir + path.sep)` correctly blocks all traversal attempts. The endpoint is also disabled in Oracle mode.
- **No credential leaks.** `storageKey` is excluded from `ResumeResponseDto`; OCI credentials are read from environment variables via `config.getOrThrow` and are not logged.
- **No SQL injection.** All database access uses Prisma's parameterized query interface.
- **No token leakage.** `nestjs-pino` redacts `Authorization` headers from request logs.
