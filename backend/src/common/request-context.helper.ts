import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Header a client may send, and the API always returns, carrying the request's correlation ID. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * What an incoming `X-Request-Id` may look like to be adopted as-is. Anything
 * else gets a fresh ID: the value lands in every log line, so an unchecked
 * header would let a client inject newlines or megabytes into the logs. The
 * 8-character minimum keeps a client from picking a trivially shared value
 * such as `1` that would merge its lines with everyone else's.
 */
const ACCEPTED_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Prefixes the server gives IDs it makes for work no request started
 * (`job:<queue>:<id>`, `cron:<scan>:<time>`). A client may not claim them,
 * or its lines would merge with a background job's.
 */
const RESERVED_ID_PREFIXES = ['job:', 'cron:'];

/** The correlation context of the request or background job currently running. */
interface RequestContext {
  requestId: string;
}

/**
 * Holds the current correlation ID across async calls. The pino `mixin` in
 * `AppModule` reads it, so every log line written while handling a request,
 * or a job that request enqueued, carries the same `requestId` (ADR-049).
 */
const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/** The correlation ID of the request or job in progress, or undefined outside one. */
export function currentRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}

/** Runs `work` with `requestId` as the current correlation ID. */
export function runWithRequestId<T>(requestId: string, work: () => T): T {
  return requestContextStorage.run({ requestId }, work);
}

/**
 * The client's `X-Request-Id` when it is safe to log, otherwise a new UUID.
 * Node joins a repeated header into one `"a, b"` string, so the first
 * comma-separated value is the candidate.
 */
export function resolveRequestId(header: string | undefined): string {
  const candidate = header?.split(',')[0].trim();
  const acceptable =
    !!candidate &&
    ACCEPTED_REQUEST_ID.test(candidate) &&
    !RESERVED_ID_PREFIXES.some((prefix) => candidate.startsWith(prefix));
  return acceptable ? candidate : randomUUID();
}

/**
 * `{ requestId }` when there is one, otherwise nothing, for spreading into a
 * log mixin or a response body.
 */
export function requestIdField(requestId: string | undefined): {
  requestId?: string;
} {
  return requestId ? { requestId } : {};
}

/**
 * First middleware in the pipeline (`configureApp`). Settles the request's
 * correlation ID, exposes it as `req.id` for pino-http, echoes it in the
 * response header, and runs the rest of the request inside its context.
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers['x-request-id'];
  const requestId = resolveRequestId(
    Array.isArray(header) ? header.join(', ') : header,
  );
  (req as Request & { id?: string }).id = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  runWithRequestId(requestId, next);
}

/**
 * A correlation ID for one run of a cron scan, so the scan's own log lines
 * and every job it enqueues share it. The `cron:` prefix is reserved: no
 * client can claim it.
 */
export function cronRequestId(scan: string, at: Date = new Date()): string {
  return `cron:${scan}:${at.toISOString()}`;
}

/**
 * Job data plus the current correlation ID, for enqueueing. A job enqueued
 * outside any request (a cron scan) gets no `requestId`; its processor falls
 * back to an ID built from the job itself.
 */
export function withRequestId<T extends object>(
  data: T,
): T & { requestId?: string } {
  const requestId = currentRequestId();
  return requestId ? { ...data, requestId } : data;
}

/**
 * Runs a BullMQ job's work inside the correlation context of the request
 * that enqueued it, or of the job itself when there was none, so worker log
 * lines join up with the request that caused them.
 */
export function runJobWithRequestId<T>(
  job: { id?: string; queueName: string; data: object },
  work: () => T,
): T {
  const carried = (job.data as { requestId?: unknown }).requestId;
  const requestId =
    typeof carried === 'string'
      ? carried
      : `job:${job.queueName}:${job.id ?? 'unknown'}`;
  return runWithRequestId(requestId, work);
}
