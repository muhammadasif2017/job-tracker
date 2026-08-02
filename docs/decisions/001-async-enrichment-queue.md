# ADR-001: Async company enrichment with BullMQ + Redis

## Status
Accepted

## Date
2026-06-12

## Context

When a user adds a job, the app researches the company using external APIs (Brave
Search, the company website) and extracts structured data via an LLM. This pipeline
typically takes 10–30 seconds and involves:

- Two Brave Search API calls (culture + tech stack queries)
- One HTTP fetch of the company's website
- One Anthropic API call for structured extraction

Running this inside the job-creation HTTP request would block the response for 10–30
seconds, make the `POST /jobs` endpoint fragile to any API timeout, and provide no
retry behaviour on transient failures.

**Constraint:** the deployment target is a single Oracle Cloud Always Free VM running
the NestJS backend. No billable managed services.

## Decision

Use **BullMQ** backed by **Redis** for a persistent async job queue. The processor
runs as a `WorkerHost` inside the same NestJS process.

1. `POST /jobs` creates the job and immediately upserts a `CompanyProfile` row with
   `status: PENDING`, then adds a BullMQ job to the queue.
2. The processor picks it up, sets `PROCESSING`, runs the pipeline, then writes
   `COMPLETED` (or `FAILED` with a sanitised error message).
3. The frontend polls `GET /jobs/:id` every 3 seconds while `status` is `PENDING` or
   `PROCESSING` (TanStack Query `refetchInterval`), and stops polling once it settles.

Retry policy: 2 attempts with a 10 s fixed backoff, covering transient API failures.

## Alternatives Considered

### Inline (synchronous) processing
- **Pros:** No extra infrastructure, simpler code.
- **Cons:** Blocks the HTTP response for 10–30 s. Any API timeout bubbles into a
  failed job-creation. No retry on transient failures.
- **Rejected:** Unacceptable latency for a user-facing write operation.

### In-process setTimeout / setImmediate
- **Pros:** Zero dependencies.
- **Cons:** State is lost on process restart. No retry mechanism. No backpressure.
- **Rejected:** Too fragile for a feature that calls paid external APIs.

### Polling / cron job
- **Pros:** No queue dependency; a periodic task scans for `status: PENDING` rows.
- **Cons:** Adds polling latency (up to the cron interval). Requires a distributed
  lock to avoid multiple instances picking the same row. BullMQ already solves both.
- **Rejected:** More complex for no meaningful benefit over BullMQ at this scale.

### Managed queue (AWS SQS, Google Cloud Tasks, etc.)
- **Pros:** No Redis to operate.
- **Cons:** Costs money beyond free tiers. Adds cloud-vendor coupling.
- **Rejected:** Violates the free-tier deployment constraint (see deployment
  constraint memory).

### Worker in a separate process / container
- **Pros:** Independent scaling; a crash in the worker doesn't affect the API.
- **Cons:** Two containers instead of one; complicates the single-VM setup.
- **Rejected:** Acceptable risk at portfolio scale. Can be extracted later if the
  app reaches production load.

## Consequences

- Redis is an additional runtime dependency (added to `docker-compose.yml`).
- BullMQ handles persistence: enrichment jobs survive a process restart.
- The `EnrichmentController.triggerEnrichment` endpoint checks for an existing
  `PENDING` or `PROCESSING` profile before enqueuing to prevent duplicate jobs
  (returns 409 Conflict if already in progress).
- The frontend must poll to observe enrichment progress; WebSocket/SSE is not used
  because it requires a persistent connection that complicates the single-VM deploy.
- If Redis is unavailable, job creation still succeeds (the `enqueueEnrichment` call
  is wrapped in try/catch — enrichment is best-effort).
