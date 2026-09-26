import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { catchError, from, mergeMap, Observable, of, throwError } from 'rxjs';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { logRedisFailure } from '../../infrastructure/redis/redis-errors.helper.js';

/** Request header carrying the client's idempotency key. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
/** Response header set when the body is a stored replay, not a fresh result. */
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';
/**
 * `code` on the 409 body for a key whose first request is still running.
 * Clients match on it rather than on the status, because the same route can
 * return an unrelated 409 (a company-name race in `JobCompanyLinkService`).
 */
export const IDEMPOTENCY_IN_PROGRESS_CODE = 'IDEMPOTENCY_IN_PROGRESS';
/** Longest key accepted, so the header cannot be used to fill Redis. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
/** How long a completed response is replayed for the same key. */
export const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * How long an in-flight request holds its key. Bounds how long a crashed
 * process can block a retry; far longer than a create takes.
 */
export const PENDING_TTL_MS = 60 * 1000;

/**
 * `path` without a leading `/v<n>` segment, so the versioned route and its
 * unversioned alias share one idempotency keyspace.
 */
export function unversionedPath(path: string): string {
  return path.replace(/^\/v\d+(?=\/)/, '');
}

/** What Redis holds under one idempotency key. */
type IdempotencyRecord =
  | { state: 'pending'; fingerprint: string }
  | { state: 'completed'; fingerprint: string; body: unknown };

/**
 * Makes a create endpoint safe to retry. A client sends an `Idempotency-Key`
 * header; the first request with that key runs, and any later request with
 * the same key and body gets the first response back instead of creating a
 * second row. A key reused with a different body is a 422, and a key whose
 * first request is still running is a 409. No header means no idempotency,
 * so existing clients are unaffected.
 *
 * Keys are scoped to the user and the route, so one user's key can never
 * replay another user's response. The route is taken without its version
 * prefix, since `/v1/jobs` and the unversioned `/jobs` alias are one handler
 * (ADR-047): a retry that switches between them must hit the same key.
 *
 * The handler throwing — including a validation 400, since pipes run inside
 * `next.handle()` — releases the key so a corrected retry can go through.
 *
 * Redis is best-effort here: when it is unreachable the request runs
 * without the guarantee rather than failing, and the outage is logged.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(private readonly redis: RedisService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<Request & { user?: { id: string } }>();
    const res = http.getResponse<Response>();

    const key = this.readKey(req);
    if (key === null || !req.user) return next.handle();

    const redisKey = `idem:${req.user.id}:${req.method}:${unversionedPath(req.path)}:${key}`;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(req.body ?? null))
      .digest('hex');

    return from(this.claim(redisKey, fingerprint)).pipe(
      mergeMap((existing) => {
        if (existing === 'claimed' || existing === 'unavailable') {
          return this.runAndStore(next, redisKey, fingerprint, existing);
        }
        if (existing.fingerprint !== fingerprint) {
          throw new UnprocessableEntityException(
            'Idempotency-Key was already used with a different request body',
          );
        }
        if (existing.state === 'pending') {
          throw new ConflictException({
            message: 'A request with this Idempotency-Key is still in progress',
            error: 'Conflict',
            code: IDEMPOTENCY_IN_PROGRESS_CODE,
          });
        }
        res.setHeader(IDEMPOTENT_REPLAYED_HEADER, 'true');
        return of(existing.body);
      }),
    );
  }

  /**
   * The trimmed header value, or null when the request carries none. A
   * present but empty or oversized key is a client bug, so it is rejected
   * rather than silently ignored.
   */
  private readKey(req: Request): string | null {
    const raw = req.headers[IDEMPOTENCY_KEY_HEADER];
    if (raw === undefined) return null;
    const key = (Array.isArray(raw) ? raw[0] : raw).trim();
    if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new BadRequestException(
        `Idempotency-Key must be 1-${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      );
    }
    return key;
  }

  /**
   * Claims the key for this request with `SET NX`. Returns `'claimed'` when
   * this request owns it, the stored record when another request got there
   * first, or `'unavailable'` when Redis could not be asked.
   */
  private async claim(
    redisKey: string,
    fingerprint: string,
  ): Promise<IdempotencyRecord | 'claimed' | 'unavailable'> {
    const pending: IdempotencyRecord = { state: 'pending', fingerprint };
    try {
      const set = await this.redis.client.set(
        redisKey,
        JSON.stringify(pending),
        'PX',
        PENDING_TTL_MS,
        'NX',
      );
      if (set === 'OK') return 'claimed';
      const stored = await this.redis.client.get(redisKey);
      // The key expired between SET NX and GET: treat it as still in flight
      // rather than racing a second claim; the client's retry will win.
      return stored ? (JSON.parse(stored) as IdempotencyRecord) : pending;
    } catch (err) {
      logRedisFailure(
        this.logger,
        err,
        {},
        'Redis unavailable, running request without idempotency',
      );
      return 'unavailable';
    }
  }

  /**
   * Runs the handler, then stores its response under the key, or releases
   * the key if the handler threw. Skips both when Redis was unavailable at
   * claim time, since there is no key to update.
   */
  private runAndStore(
    next: CallHandler,
    redisKey: string,
    fingerprint: string,
    claim: 'claimed' | 'unavailable',
  ): Observable<unknown> {
    if (claim === 'unavailable') return next.handle();
    return next.handle().pipe(
      mergeMap((body) => from(this.store(redisKey, fingerprint, body))),
      catchError((err: unknown) =>
        from(this.release(redisKey)).pipe(
          mergeMap(() => throwError(() => err)),
        ),
      ),
    );
  }

  /** Saves the completed response; a failed save only costs the replay. */
  private async store(redisKey: string, fingerprint: string, body: unknown) {
    const record: IdempotencyRecord = { state: 'completed', fingerprint, body };
    try {
      await this.redis.client.set(
        redisKey,
        JSON.stringify(record),
        'PX',
        COMPLETED_TTL_MS,
      );
    } catch (err) {
      logRedisFailure(
        this.logger,
        err,
        {},
        'Failed to store idempotent response',
      );
    }
    return body;
  }

  /** Frees the key after a failed request so a retry is not blocked. */
  private async release(redisKey: string) {
    try {
      await this.redis.client.del(redisKey);
    } catch (err) {
      logRedisFailure(
        this.logger,
        err,
        { expiresInMs: PENDING_TTL_MS },
        'Failed to release idempotency key',
      );
    }
  }
}
