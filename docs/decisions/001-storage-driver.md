# ADR-001: Dual-driver storage for resume files

## Status
Accepted

## Date
2026-06-13

## Context

The app needs to persist user-uploaded resume PDFs (max 8 MB each, one per job). The deployment target is a single Oracle Cloud Always Free A1 VM — no managed object storage tier is included in the Always Free quota, but Oracle Cloud Object Storage has a 20 GB Always Free bucket available under the same account.

Two environments need to work:

- **Local development** — no cloud credentials, files should just land on disk
- **Production (Oracle Cloud)** — files must survive VM restarts, be accessible from the frontend without routing binary data through the NestJS process, and fit within the Always Free quota

## Decision

Introduce a `StorageModule` with a `STORAGE_SERVICE` injection token backed by one of two implementations, selected at startup via `STORAGE_DRIVER`:

- **`local`** (default): `LocalStorageService` writes files to `backend/uploads/` and returns a URL pointing at a dev-only backend endpoint (`GET /jobs/resumes/file?key=...`) that serves them with path-traversal protection and JWT auth gating.
- **`oracle`**: `OracleStorageService` uses the AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`) against Oracle Cloud's S3-compatible endpoint. Clients receive short-lived presigned `GetObject` URLs (15-minute TTL) and fetch the file directly — the backend never proxies bytes.

## Alternatives Considered

### Single driver — always proxy through the backend

- Pros: Simpler interface (no presigned URL concept), works for both local and cloud
- Cons: In production, large binary files would flow through the NestJS process, consuming memory and connection slots. Not appropriate for a single-VM deployment with no horizontal scaling.
- Rejected

### Store files in PostgreSQL (bytea / large objects)

- Pros: No separate storage service, atomic with DB transactions
- Cons: Bloats the database, degrades query performance on other tables, makes backups slow, and the Always Free PostgreSQL instance has limited disk
- Rejected

### Use a third-party managed service (AWS S3, Cloudflare R2)

- Pros: Battle-tested, broad SDK support
- Cons: Adds a billable external dependency. The constraint is to stay within Oracle Cloud Always Free for the entire portfolio deployment
- Rejected

### Single `local` driver only, no cloud support

- Pros: Simpler — no abstraction needed
- Cons: Files are lost on VM re-provision; can't share files across sessions in production
- Rejected

## Consequences

- `OracleStorageService` uses `forcePathStyle: true` because Oracle Cloud's S3-compatible endpoint requires path-style addressing (`namespace.compat.objectstorage.region.oraclecloud.com/bucket/key`), unlike AWS which defaults to virtual-hosted-style.
- The `GET /jobs/resumes/file` endpoint in `ResumesController` is **dev-only** — it returns 404 when `STORAGE_DRIVER=oracle`. Never call this endpoint from frontend code that runs against production.
- Presigned URLs expire in 15 minutes (configurable via `getPresignedUrl(key, expiresIn)`). The frontend always fetches a fresh URL before view or download — never caches the URL itself.
- Adding a new storage backend (e.g., S3, R2) requires only a new `IStorageService` implementation and a new branch in the `StorageModule` factory.
