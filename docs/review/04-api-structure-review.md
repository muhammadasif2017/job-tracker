# Job Tracker — API Structure Review

> Focused audit of REST conventions, response shape consistency, validation gaps,
> and status code correctness. Produced after the fixes in `02-code-review.md`
> were applied. Each finding names the **file:line**, the **problem**, and a
> **suggested fix**. Use this as a planning document — not all items need to be
> fixed before shipping.

Severity legend:
- 🔴 **High** — observable inconsistency a frontend dev hits immediately.
- 🟠 **Medium** — real gap under realistic use or subtle contract mismatch.
- 🟡 **Low** — cleanliness, DRY, or defensive hardening.

---

## 🔴 High

### A1. `POST /auth/register` and `POST /auth/exchange-code` return 201 instead of 200 ✅ RESOLVED
**Where:** `backend/src/auth/auth.controller.ts`

**Problem:** Token-issuing endpoints return different status codes depending on which
route you hit:
- `POST /auth/login` → `@HttpCode(200)` ✓
- `POST /auth/refresh` → `@HttpCode(200)` ✓
- `POST /auth/register` → 201 (NestJS POST default, no decorator) ✗
- `POST /auth/exchange-code` → 201 (NestJS POST default, no decorator) ✗

All four endpoints do the same logical thing (issue a token pair). A client that checks
`response.status === 200` will silently fail for register and exchange-code.

**Fix:**
```ts
// auth.controller.ts — add to register() and exchangeCode()
@HttpCode(HttpStatus.OK)
```

---

### A2. `POST /auth/logout` returns an empty body ✅ RESOLVED
**Where:** `backend/src/auth/auth.controller.ts` — `logout()` method;
`backend/src/auth/auth.service.ts` — `logout()` method.

**Problem:** Every other "action" endpoint returns a `{ message: string }` object
(`DELETE /jobs/:id` → `{ message: 'Job deleted' }`, `DELETE /users/me` →
`{ message: 'Account deleted' }`). `logout()` returns `void`, so the response body
is `null`. A client that reads `.data.message` on logout gets a runtime error.

**Fix:**
```ts
// auth.service.ts
async logout(userId: string): Promise<{ message: string }> {
  await this.prisma.refreshToken.deleteMany({ where: { userId } });
  return { message: 'Logged out successfully' };
}
```

---

### A3. `PATCH /users/me` response shape differs from `GET /users/me` ✅ RESOLVED
**Where:** `backend/src/users/users.service.ts` — `getProfile()` (lines ~16–39)
vs `updateProfile()` (lines ~41–54).

**Problem:** Both endpoints are supposed to represent the same "user profile" resource,
but they return different shapes:

| Field | `GET /users/me` | `PATCH /users/me` |
|---|---|---|
| `id` | ✓ | ✓ |
| `email` | ✓ | ✓ |
| `name` | ✓ | ✓ |
| `avatarUrl` | ✓ | ✓ |
| `connectedProviders` | ✓ | ✗ |
| `hasPassword` | ✓ | ✗ |
| `createdAt` | ✓ | ✗ |

The frontend must invalidate and re-fetch `GET /users/me` after a PATCH just to get
the full shape — a roundtrip that shouldn't be necessary.

**Fix:** Extract a shared `toProfileDto(user)` helper in `users.service.ts` and call
it from both `getProfile` and `updateProfile` so the response shape is always
identical.

---

## 🟠 Medium

### A4. `LoginDto` password min length is 1, `RegisterDto` is 8 ✅ RESOLVED
**Where:** `backend/src/auth/dto/login.dto.ts` vs `backend/src/auth/dto/register.dto.ts`.

**Problem:** A user who tries to log in with a short string gets past DTO validation
and hits the bcrypt comparison (wasted CPU). More importantly, the inconsistency is
confusing — one DTO implies 8+ chars is required, the other implies 1 is fine.

**Fix:** Change `LoginDto` password to `@MinLength(8)`. Login with a short password
will fail anyway (no account exists with such a password), so this just short-circuits
earlier with a cleaner error.

---

### A5. `ChangePasswordDto.currentPassword` has no min length ✅ RESOLVED
**Where:** `backend/src/users/dto/change-password.dto.ts`.

**Problem:** `currentPassword` has `@MaxLength(128)` but no `@MinLength`. A client
that sends `currentPassword: ""` passes DTO validation and reaches the bcrypt compare.

**Fix:** Add `@MinLength(1)` (or `@MinLength(8)` to match the register constraint).

---

### A6. `GET /jobs/:id/events` has no pagination — hardcoded `take: 200` ✅ RESOLVED
**Where:** `backend/src/jobs/jobs.service.ts` — `getEvents()`.

**Problem:** Events are capped at 200 with no way for the client to fetch beyond that.
A job with a long history (many status changes, notes) silently truncates.

**Fix:** Add optional `page` / `limit` query params to the route, defaulting to
`limit: 50`. This is additive — existing callers continue to work.

---

### A7. `PATCH /jobs/:id` response omits `companyProfile` and `resume` ✅ RESOLVED
**Where:** `backend/src/jobs/jobs.service.ts` — `update()`.

**Problem:** `GET /jobs/:id` returns `{ ...job, companyProfile, resume }`. `PATCH
/jobs/:id` returns only the job row (no relations). A client that re-renders from the
PATCH response loses the company profile and resume it had previously rendered.

**Fix:** Add `include: { companyProfile: true, resume: true }` to the `prisma.job.update()`
call in `update()`, matching the shape `findOne()` returns.

---

### A8. `POST /jobs/:id/enrichment` returns 201 for an async operation ✅ RESOLVED
**Where:** `backend/src/enrichment/enrichment.controller.ts`.

**Problem:** The endpoint queues a background job and returns immediately. HTTP 201
implies a resource was created; HTTP 202 Accepted is the correct code for "request
accepted, processing asynchronously."

**Fix:**
```ts
@HttpCode(HttpStatus.ACCEPTED) // 202
@Post(':id/enrichment')
```

---

## 🟡 Low

### A9. Missing error messages on `ForbiddenException` throws ✅ RESOLVED
**Where:**
- `backend/src/auth/auth.service.ts` — `refresh()` and `exchangeOAuthCode()`
- `backend/src/resumes/resumes.controller.ts` — `serveFile()`

**Problem:** `throw new ForbiddenException()` with no message gives the client an
opaque `{ message: 'Forbidden' }`. During development (and in logs), there's no
indication of which check failed.

**Fix:** Add descriptive messages:
```ts
throw new ForbiddenException('Refresh token invalid or expired');
throw new ForbiddenException('OAuth code expired or already used');
throw new ForbiddenException('Access denied to this file');
```

---

### A10. CSV export filename is always `"jobs.csv"` regardless of filters ✅ RESOLVED
**Where:** `backend/src/jobs/jobs.controller.ts` — `exportCsv()`.

**Problem:** If a user exports only `status=REJECTED` jobs, the file downloads as
`jobs.csv`. With filters active, a descriptive filename would make it easier to
distinguish multiple exports.

**Fix:**
```ts
const suffix = query.status ? `-${query.status.toLowerCase()}` : '';
res.setHeader('Content-Disposition', `attachment; filename="jobs${suffix}.csv"`);
```

---

### A11. `PrismaExceptionFilter` name is misleading — it catches everything ✅ RESOLVED
**Where:** `backend/src/common/filters/prisma-exception.filter.ts`.

**Problem:** The filter is decorated with `@Catch()` (no argument), which means it
catches all exceptions — not just Prisma errors. The class name implies it's
Prisma-specific, which misleads anyone adding a new global filter.

**Fix:** Rename to `GlobalExceptionFilter` to accurately describe its scope, or
narrow it to `@Catch(PrismaClientKnownRequestError)` and add a separate catch-all
filter for 500s.

---

## Things that look wrong but are intentional

So you don't accidentally "fix" correct behavior:

- **404 (not 403) for unauthorized job access** — intentional: avoids leaking which
  job IDs exist. See `02-code-review.md`.
- **`GET /jobs/resumes/file` sits at the wrong path level** — acknowledged in
  `02-code-review.md` M6; there's a comment in the controller. Restructuring requires
  changing `LocalStorageService.getUrl()` and the presigned URL flow.
- **`findByJob()` returns `null` instead of throwing** — intentional: the resume is
  optional on a job; returning null lets the client render the "no resume" state
  without catching an exception.
- **Two `/me` endpoints** (`GET /auth/me` and `GET /users/me`) — acknowledged in
  `02-code-review.md` L8. Not removed yet; see that entry for rationale.

---

## Fix order

| # | Finding | Status |
|---|---------|--------|
| 1 | **A1** — status code on register/exchange-code | ✅ RESOLVED |
| 2 | **A2** — logout empty body | ✅ RESOLVED |
| 3 | **A3** — profile shape inconsistency | ✅ RESOLVED |
| 4 | **A7** — PATCH /jobs/:id missing relations | ✅ RESOLVED |
| 5 | **A4** — LoginDto password min length | ✅ RESOLVED |
| 6 | **A5** — ChangePasswordDto currentPassword min | ✅ RESOLVED |
| 7 | **A8** — enrichment 202 Accepted | ✅ RESOLVED |
| 8 | **A6** — events pagination | ✅ RESOLVED |
| 9 | **A9** — ForbiddenException messages | ✅ RESOLVED |
| 10 | **A10** — CSV filename | ✅ RESOLVED |
| 11 | **A11** — filter rename | ✅ RESOLVED |
