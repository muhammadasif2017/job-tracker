import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { isRedisConnectionError } from '../../infrastructure/redis/redis-errors.helper.js';
import { requestIdField } from '../request-context.helper.js';

/** Prisma error code for a unique-constraint violation, mapped to 409. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';
/** Prisma error code for a missing record on update or delete, mapped to 404. */
const PRISMA_NOT_FOUND = 'P2025';

/**
 * Catch-all filter that gives every error response one JSON shape:
 * `statusCode`, `message`, `timestamp`, `path` and `requestId`. Nest HTTP exceptions keep
 * their own body; the two Prisma codes above become a 409 or 404 instead of a
 * bare 500; an unhandled Redis connection failure becomes a 503; anything
 * else is logged with its stack and returned as an opaque 500.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  /** Writes the error response. Never throws, for the reason given in its own catch. */
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // The correlation ID comes from the request itself (set by
    // requestIdMiddleware), not from async context, which a callback-based
    // library can lose before throwing. It lets a user quote the error
    // against the logs (ADR-049). Read inside the try: getRequest() can
    // throw too, and this filter must not.
    let correlation: { requestId?: string } = {};
    try {
      const request = ctx.getRequest<Request & { id?: string }>();
      correlation = requestIdField(request?.id);
      const body = this.buildBody(exception, request?.url);
      return response.status(body.statusCode).json({ ...body, ...correlation });
    } catch (filterError) {
      // The filter itself must never throw — a bug here would otherwise
      // crash the request with a raw, unhandled Express error instead of
      // the JSON shape every client expects.
      this.logger.error(
        'Exception filter failed while handling an exception',
        filterError instanceof Error ? filterError.stack : filterError,
      );
      return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
        timestamp: new Date().toISOString(),
        ...correlation,
      });
    }
  }

  /** The response body, including its status code, for one exception. */
  private buildBody(exception: any, path?: string) {
    const timestamp = new Date().toISOString();

    // Let NestJS HTTP exceptions pass through as-is, just adding trace fields.
    if (exception?.getStatus) {
      const status = exception.getStatus();
      const original = exception.getResponse();
      const base =
        typeof original === 'string' ? { message: original } : original;
      // base last-in-wins on shared keys would let a validation-pipe body's
      // own statusCode/timestamp silently override the real HTTP status,
      // desyncing the JSON body from response.status(). Ours must win.
      return { ...base, statusCode: status, timestamp, path };
    }

    if (exception?.code === PRISMA_UNIQUE_VIOLATION) {
      return {
        statusCode: HttpStatus.CONFLICT,
        message: 'A record with this value already exists',
        error: 'Conflict',
        timestamp,
        path,
      };
    }

    if (exception?.code === PRISMA_NOT_FOUND) {
      return {
        statusCode: HttpStatus.NOT_FOUND,
        message: 'Record not found',
        error: 'Not Found',
        timestamp,
        path,
      };
    }

    // Safety net for a Redis outage no caller handled. Callers that treat
    // Redis as best-effort (idempotency) or answer their own 503 (OAuth code
    // store) catch it first and never reach here; anything else that lets it
    // escape gets an honest 503 instead of an opaque 500 (ADR-046).
    if (isRedisConnectionError(exception)) {
      this.logger.warn(`Redis unavailable: ${exception.message}`);
      return {
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Service temporarily unavailable, please try again',
        error: 'Service Unavailable',
        timestamp,
        path,
      };
    }

    // Unknown/unexpected error — log the stack so the opaque 500 is debuggable.
    this.logger.error(exception?.message ?? 'Unknown error', exception?.stack);

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      timestamp,
      path,
    };
  }
}
