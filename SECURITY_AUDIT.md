# Security Audit Report

**Project:** Job Tracker
**Date:** 2026-06-09
**Scope:** Full-stack (NestJS 11 backend + Next.js 16 frontend)

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 0 |
| 🟠 High | 2 |
| 🟡 Medium | 6 |
| 🟢 Low / Info | 5 |

---

## Findings

### 🟠 HIGH — FINDING-001: ThrottlerGuard never registered — rate limiting is completely inert

**Location:** `backend/src/app.module.ts:31`, `backend/src/auth/auth.controller.ts:30–37`

**Description:** `ThrottlerModule.forRoot()` is imported and `@Throttle({ default: { ttl: 60000, limit: 10 } })` is applied to `POST /auth/register` and `POST /auth/login`. However, `ThrottlerGuard` is never registered as a global guard — neither via `APP_GUARD` in module providers nor in `main.ts`. The `@Throttle()` decorator only sets metadata; without the guard to read that metadata, no rate limiting is enforced on any endpoint. The auth endpoints are wide open to brute-force.

**Proof:**
```ts
// app.module.ts — ThrottlerModule imported but guard never registered
ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
providers: [AppService],  // no ThrottlerGuard or APP_GUARD here

// main.ts — only JwtAuthGuard registered globally
app.useGlobalGuards(new JwtAuthGuard(app.get(Reflector)));
// ThrottlerGuard missing entirely
```

**Fix:** Add the guard to `AppModule` providers:
```ts
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

providers: [
  AppService,
  { provide: APP_GUARD, useClass: ThrottlerGuard },
],
```

---

### 🟠 HIGH — FINDING-002: OAuth refresh token exposed in redirect URL

**Location:** `backend/src/auth/auth.controller.ts:81–83`, `backend/src/auth/auth.controller.ts:101–103`

**Description:** After Google/GitHub OAuth authentication, both the access token and the 7-day refresh token are appended as plain query parameters in the redirect URL. These tokens are visible in: (1) the backend's pino access log (pino-http logs the full request URL), (2) the user's browser history, (3) `Referer` headers sent to any third-party resource loaded by the callback page.

**Proof:**
```ts
res.redirect(
  `${fe}/callback?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}`,
);
```

**Fix:** Use a short-lived server-side code pattern. After issuing tokens, store them keyed to a random one-time code (`crypto.randomUUID()`) in a short-TTL in-memory store or Redis, then redirect with only `?code=<uuid>`. The frontend callback page exchanges the code for tokens via a `POST /auth/exchange-code`, which deletes the entry immediately. This removes sensitive data from URLs entirely.

As a lower-effort improvement: at minimum, omit the refresh token from the redirect and have the callback page call `POST /auth/refresh` to obtain it, reducing refresh token exposure to server logs only.

---

### 🟡 MEDIUM — FINDING-003: Weak default secrets in `.env` and `docker-compose.yml`

**Location:** `backend/.env:3–4`, `docker-compose.yml:27–28`

**Description:** The `JWT_SECRET` and `JWT_REFRESH_SECRET` values are placeholder strings. If a developer deploys docker-compose without overriding these, any attacker who knows the string `change-this-in-production` can forge arbitrary JWTs.

**Proof:**
```env
JWT_SECRET="change-this-secret-in-production"
JWT_REFRESH_SECRET="change-this-refresh-secret-in-production"
```
```yaml
JWT_SECRET: change-this-in-production
JWT_REFRESH_SECRET: change-this-refresh-in-production
```

**Fix:** Replace the `.env` placeholders with a generation instruction and fail fast in the Joi schema if the values are below a minimum length:
```ts
JWT_SECRET: Joi.string().min(32).required(),
JWT_REFRESH_SECRET: Joi.string().min(32).required(),
```
Replace docker-compose values with `${JWT_SECRET}` referencing a host `.env`, and add `docker-compose.override.yml` to `.gitignore`.

---

### 🟡 MEDIUM — FINDING-004: No `@MaxLength` on free-text input fields

**Location:** `backend/src/auth/dto/register.dto.ts:5`, `backend/src/jobs/dto/create-job.dto.ts:14–35`, `backend/src/users/dto/update-user.dto.ts:5`

**Description:** The `company`, `position`, `location`, `notes`, `name`, and `url` fields accept strings without an upper-length bound. A client can send multi-megabyte payloads that are accepted by `class-validator`, stored in PostgreSQL TEXT columns, and later served back to every query result. This wastes storage and can cause slow responses when the data is returned.

**Proof:**
```ts
// register.dto.ts — no MaxLength
@IsString()
name: string;

// create-job.dto.ts — no MaxLength
@IsString() @IsNotEmpty()
company: string;
```

**Fix:** Add `@MaxLength` to all free-text fields:
```ts
@IsString() @IsNotEmpty() @MaxLength(200)
company: string;

@IsOptional() @IsString() @MaxLength(5000)
notes?: string;
```

---

### 🟡 MEDIUM — FINDING-005: CSV export has no row limit

**Location:** `backend/src/jobs/jobs.service.ts:190`

**Description:** `exportCsv()` calls `prisma.job.findMany()` without a `take` argument. A user with a large number of jobs can trigger an export that loads the entire result set into memory as a string before sending it, potentially exhausting Node.js heap.

**Proof:**
```ts
const jobs = await this.prisma.job.findMany({
  where,
  orderBy: { appliedAt: 'desc' },
  // no take/limit
});
```

**Fix:** Add a hard cap:
```ts
const jobs = await this.prisma.job.findMany({
  where,
  orderBy: { appliedAt: 'desc' },
  take: 10_000,
});
```
Alternatively, stream the response row-by-row using cursor-based pagination with `res.write()`.

---

### 🟡 MEDIUM — FINDING-006: Docker containers run as root

**Location:** `backend/Dockerfile:9`, `frontend/Dockerfile:8`

**Description:** Neither Dockerfile adds a `USER` instruction. Both runtime containers execute as `root` (UID 0). If an RCE vulnerability is exploited, the attacker obtains root access inside the container, making privilege escalation to the host much easier.

**Proof:**
```dockerfile
# backend/Dockerfile — no USER directive
FROM node:20-alpine
WORKDIR /app
...
CMD ["sh", "-c", "..."]
```

**Fix:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
# ... copy files ...
USER appuser
CMD [...]
```

---

### 🟡 MEDIUM — FINDING-007: PostgreSQL port 5432 bound to all interfaces

**Location:** `docker-compose.yml:8`

**Description:** The postgres service publishes port 5432 with `'5432:5432'`, which binds to `0.0.0.0` and makes the database reachable from all of the host's network interfaces. If deployed on a cloud VM without a strict firewall, the database is directly accessible from the internet using the default credentials `postgres/postgres`.

**Proof:**
```yaml
ports:
  - '5432:5432'
```

**Fix:** Bind to localhost only, or remove the port mapping entirely since the backend reaches postgres via the Docker internal network:
```yaml
ports:
  - '127.0.0.1:5432:5432'
```
Or remove `ports:` from the postgres service entirely — the backend container can reach it via Docker DNS at `postgres:5432` without any host port binding.

---

### 🟡 MEDIUM — FINDING-008: `jt_authed` cookie missing `Secure` flag

**Location:** `frontend/store/auth.store.ts:26`

**Description:** The presence cookie used by `proxy.ts` to gate dashboard routes is set without the `Secure` attribute. On an HTTP connection (before an HTTPS redirect, or in a misconfigured deployment) the cookie would be transmitted in plaintext.

**Proof:**
```ts
document.cookie = 'jt_authed=1; path=/; max-age=604800; SameSite=Lax';
// Secure flag missing
```

**Fix:**
```ts
const secure = window.location.protocol === 'https:' ? '; Secure' : '';
document.cookie = `jt_authed=1; path=/; max-age=604800; SameSite=Lax${secure}`;
```

---

### 🟢 LOW — FINDING-009: Tokens stored in `localStorage` (XSS exposure)

**Location:** `frontend/lib/auth.ts:7–10`, `frontend/store/auth.store.ts:40`

**Description:** Both the access token and refresh token are stored in `localStorage`, which is accessible to any JavaScript running in the page's origin — including injected scripts. React/Next.js JSX escaping strongly mitigates XSS in this codebase (no `dangerouslySetInnerHTML` was found), but a third-party script or a future XSS vector would expose long-lived credentials. The Zustand `persist` middleware also stores `accessToken` in `localStorage` under `jt-auth`, duplicating the access token across two keys.

**Note:** This is a recognised trade-off. The alternative (HttpOnly cookies for tokens) requires CSRF protection on all mutating endpoints. For a portfolio project the current approach is common and acceptable when kept in view.

**Hardening option:** Move tokens to `HttpOnly; Secure; SameSite=Strict` cookies set by the backend on login/refresh responses. Adjust the Axios interceptor to use `withCredentials: true` and remove all `localStorage` token reads.

---

### 🟢 LOW — FINDING-010: `RegisterDto.name` accepts empty string

**Location:** `backend/src/auth/dto/register.dto.ts:4`

**Description:** The `name` field carries only `@IsString()`. An empty string `""` passes validation and is stored in the database.

**Proof:**
```ts
@IsString()
name: string;  // @IsNotEmpty() missing
```

**Fix:**
```ts
@IsString()
@IsNotEmpty()
@MaxLength(200)
name: string;
```

---

### 🟢 LOW — FINDING-011: pino `redact` does not cover request body fields

**Location:** `backend/src/app.module.ts:39`

**Description:** The pino-http `redact` config removes only `req.headers.authorization`. pino-http does not log request bodies by default, so passwords are not currently logged. However, if a future developer enables body serialization for debugging, `password`, `currentPassword`, `newPassword`, and `refreshToken` from request bodies would appear in logs in plaintext.

**Proof:**
```ts
redact: ['req.headers.authorization'],
// req.body.password, req.body.currentPassword, req.body.refreshToken not covered
```

**Fix:** Extend the redact list defensively:
```ts
redact: [
  'req.headers.authorization',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.refreshToken',
],
```

---

### 🟢 LOW — FINDING-012: Swagger UI publicly accessible in production

**Location:** `backend/src/main.ts:42`

**Description:** The Swagger UI at `/api/docs` is exposed unconditionally with no environment guard. In a production deployment this advertises every endpoint, parameter shape, and auth scheme to anonymous visitors.

**Fix:**
```ts
if (config.get('NODE_ENV') !== 'production') {
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);
}
```

---

### 🟢 LOW — FINDING-013: `getStats()` loads all user jobs into memory

**Location:** `backend/src/jobs/jobs.service.ts:141`

**Description:** `getStats()` fetches every job row for the authenticated user with no `take` limit, loads the full array into JavaScript memory, then iterates to compute counts. The same aggregation can be pushed to the database.

**Proof:**
```ts
const jobs = await this.prisma.job.findMany({
  where: { userId },
  select: { status: true, appliedAt: true },
  // no take
});
```

**Fix:** Replace in-process aggregation with a Prisma `groupBy`:
```ts
const counts = await this.prisma.job.groupBy({
  by: ['status'],
  where: { userId },
  _count: { status: true },
});
```

---

## Passed Checks

- **Global `JwtAuthGuard`** correctly applied in `main.ts`; `@Public()` used only on the expected unauthenticated routes.
- **Cross-user resource isolation** — `findOne()`, `update()`, `remove()`, and `getEvents()` all verify `job.userId === userId` before acting.
- **Password hashing** — bcrypt with cost factor 10; refresh tokens are also bcrypt-hashed before storage.
- **Refresh token validation** — `refresh()` re-fetches the user from the DB and calls `bcrypt.compare` on the stored hash before issuing new tokens.
- **Input validation** — Global `ValidationPipe` with `whitelist: true` and `forbidNonWhitelisted: true`; all DTOs carry appropriate `class-validator` decorators for required fields.
- **No raw SQL** — all database access uses Prisma ORM; no `$queryRaw` / `$executeRaw` calls found.
- **Helmet** applied before any route registration in `main.ts`.
- **CORS** restricted to the server-controlled `FRONTEND_URL` env var.
- **Sensitive fields excluded from responses** — `getProfile()` and `updateProfile()` use explicit `select` clauses; `password` and `refreshToken` are never returned to clients.
- **JWT payload** contains only `sub` (userId) and `email` — no sensitive data embedded.
- **`GET /auth/me`** returns only what `JwtStrategy.validate()` selects (`id, email, name, avatarUrl`).
- **External links** all use `rel="noopener noreferrer"` across all three job-display components.
- **No `dangerouslySetInnerHTML`** usage found anywhere in the frontend.
- **CSV escaping** — the `escape()` function wraps all values in double-quotes and escapes inner double-quotes per RFC 4180.
- **`@IsUrl()`** on `CreateJobDto.url` blocks non-HTTP protocols (e.g., `javascript:`).
- **`.env` files excluded from git** in both root `.gitignore` and `backend/.gitignore`.
- **`.env` excluded from Docker images** via `backend/.dockerignore`.
- **Multi-stage Docker build** — the runtime image copies only compiled artifacts; source files and `.env` are not present in the final image.

---

## Recommendations (Priority Order)

| # | Severity | Action |
|---|----------|--------|
| 1 | 🟠 High | Register `ThrottlerGuard` as a global guard in `AppModule` providers — rate limiting is currently a no-op |
| 2 | 🟠 High | Stop passing refresh tokens as URL query params in OAuth callbacks; use a short-lived one-time code |
| 3 | 🟡 Medium | Replace weak placeholder JWT secrets; add `Joi.string().min(32)` enforcement in the config schema |
| 4 | 🟡 Medium | Add `@MaxLength` to all free-text DTO fields |
| 5 | 🟡 Medium | Add a `take: 10_000` hard cap to `exportCsv()` |
| 6 | 🟡 Medium | Add `USER appuser` to both Dockerfiles so containers don't run as root |
| 7 | 🟡 Medium | Remove or localhost-bind the PostgreSQL port mapping in `docker-compose.yml` |
| 8 | 🟡 Medium | Add `Secure` flag to the `jt_authed` cookie |
| 9 | 🟢 Low | Extend pino `redact` to cover `req.body.password`, `req.body.refreshToken`, etc. |
| 10 | 🟢 Low | Gate Swagger UI behind a `NODE_ENV !== 'production'` check |
| 11 | 🟢 Low | Add `@IsNotEmpty()` and `@MaxLength(200)` to `RegisterDto.name` |
| 12 | 🟢 Low | Replace `getStats()` in-memory aggregation with a Prisma `groupBy` query |
