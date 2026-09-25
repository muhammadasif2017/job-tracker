# ADR-049: A correlation ID on every request, log line and job

## Status

Accepted

## Date

2026-09-25

## Context

pino-http numbered requests with a per-process counter (`req.id: 1, 2, 3…`),
which restarts at every deploy and means nothing outside the process. Lines a
service logged deep inside a request only carried `req.id` when nestjs-pino's
request-scoped logger happened to be in reach. And nothing tied a request to
the BullMQ jobs it enqueued: a failed company enrichment could not be traced
back to the job create that started it. Error responses carried nothing a user
could quote in a bug report.

## Decision

One `AsyncLocalStorage` context carries a **correlation ID** through a
request and into the jobs it enqueues
(`backend/src/common/request-context.helper.ts`).

- **`requestIdMiddleware`, the first middleware in `configureApp`.**
  - It adopts the client's `X-Request-Id` only if it matches
    `^[A-Za-z0-9._:-]{8,128}$` and does not start with a reserved `job:` or
    `cron:` prefix. Otherwise it generates a UUID.
  - The check matters because the value lands in every log line: an
    unchecked header could inject newlines or megabytes.
  - The minimum length and the reserved prefixes stop a client from picking
    a value that merges its lines with other traffic or with a background
    job's.
  - Node joins a repeated header into one `"a, b"` string, so the first
    comma-separated value is the candidate.
  - It sets `req.id` and the `X-Request-Id` response header (exposed through
    CORS).
  - It runs the rest of the request inside the context.
- **pino.** pino-http reuses `req.id` as-is, so there is no custom
  `genReqId`. A `mixin` stamps `requestId` from the context onto **every**
  log line, however far from the request it is written.
- **Error bodies and the UI.**
  - `GlobalExceptionFilter` adds `requestId` to every error response. It
    reads it from `req.id`, not from async context, which a callback-based
    library can lose before throwing.
  - For a **5xx**, the frontend's `getErrorMessage` appends
    `(ref: <requestId>)`, so the toast a user sees carries an ID that
    matches the server logs.
  - A 4xx message already says what to fix, so it gets no reference.
- **Jobs.**
  - Enqueue sites wrap their data in `withRequestId({ ... })`: company
    enrichment and timeline summary.
  - Processors extend `CorrelatedWorkerHost`, which wraps `process` so that
    `handle` runs in the job's context. A new processor is covered by
    extending it, not by remembering a wrapper.
  - Worker event handlers (`@OnWorkerEvent`) run outside `process`, so they
    wrap their own body in `runJobWithRequestId`.
  - Each cron scan runs under `cron:<scan>:<start time>`, and the jobs it
    enqueues carry that ID. The scan's own lines and its jobs' lines
    therefore share one ID.
  - A job that carries no ID at all falls back to `job:<queue>:<id>`.
  - A timeline-summary burst coalesces into one job, which keeps the first
    request's ID.

## Consequences

- Grepping one ID follows a user action through the API and the workers.
  Measured on 2026-09-25: a `POST /v1/jobs` sent with
  `X-Request-Id: demo-trace-42` showed that ID on the response, on the
  `request completed` line, and on the enrichment worker's
  `company_enrichment_started` and `company_enrichment_completed` lines.
- The same ID can later tag error reports (Sentry) and link traces, so it is
  the base the next observability steps build on.
- A new processor gets correlation by extending `CorrelatedWorkerHost`. A new
  enqueue site still has to wrap its data in `withRequestId`, and a new
  worker event handler still has to wrap its body; `backend/CLAUDE.md` says
  so. A forgotten one still logs, just without the link.

## Alternatives rejected

- **nestjs-pino's own `req.id` only.** It lives in nestjs-pino's request
  storage, which a BullMQ worker never runs inside, so it cannot cross into
  jobs.
- **Full OpenTelemetry tracing now.** That is the larger follow-up.
  Correlation IDs are the cheap first step, and they stay useful alongside
  trace IDs.
