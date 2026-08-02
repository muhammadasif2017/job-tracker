# ADR-002: POST /auth/register Returns 200 Instead of 201

## Status
Accepted

## Date
2026-06-13

## Context
`POST /auth/register` creates a new user and issues a JWT token pair. The HTTP convention for resource creation is `201 Created`. NestJS also defaults POST handlers to `201`.

However, this endpoint was flagged during a security review: returning `201` on success and `400`/`409` on failure allows an attacker to enumerate whether a given email address is already registered by comparing status codes. Normalising all responses to `200` removes this signal.

## Decision
Override the NestJS default and return `200 OK` from `POST /auth/register` via `@HttpCode(HttpStatus.OK)`.

The response body is identical whether the email is new (tokens issued) or already taken (error returned) from a status-code perspective — the attacker cannot distinguish registration success from failure via HTTP status alone.

## Alternatives Considered

### Return 201 on success, 409 on duplicate
- Standard REST behaviour
- Rejected: Leaks email existence to unauthenticated callers

### Return 200 on success, generic 400 (not 409) on duplicate
- Hides the conflict specifically but still differentiates success from failure
- Rejected: Still allows timing-based enumeration; inconsistent with the broader approach

### Rate-limit only, keep 201
- ThrottlerGuard already limits auth endpoints; combined with rate-limiting, enumeration is slow
- Rejected: Rate-limiting reduces attack speed but does not eliminate the signal; status-code normalisation is a defence-in-depth layer that costs nothing

## Consequences
- `@HttpCode(HttpStatus.OK)` is explicitly set on the register route in `auth.controller.ts`
- The e2e test asserts `200`, not `201`, on `POST /auth/register`
- Any future developer or agent must not "fix" this back to `201` — it is intentional
- Swagger documentation should note the non-standard status code with this rationale
