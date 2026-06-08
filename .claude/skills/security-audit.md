# Security Audit Skill

Perform a comprehensive security audit of this full-stack job tracker project (NestJS backend + Next.js frontend) and produce a structured report.

## How to run

Work entirely from the local filesystem — do NOT require a git remote or git history. Read source files directly.

## Scope

Cover all of the following areas in order. For each finding, assign a severity:

- 🔴 **CRITICAL** — exploitable with no authentication, data loss risk, or secret exposure
- 🟠 **HIGH** — exploitable by an authenticated user, significant data risk
- 🟡 **MEDIUM** — requires specific conditions, moderate impact
- 🟢 **LOW / INFO** — best-practice gap, minor hardening opportunity

---

## Areas to audit

### 1. Authentication & Authorization
- JWT secret strength and storage (are secrets in `.env` weak defaults?)
- Token expiry configuration (access token and refresh token lifetimes)
- Refresh token storage: is it hashed in the DB or stored plaintext?
- Is the global `JwtAuthGuard` actually applied to all routes? Check for unintended `@Public()` misuse.
- Cross-user access: does every service method that touches a resource verify `userId` ownership before acting?
- OAuth callback: does the callback redirect validate the `FRONTEND_URL` destination to prevent open redirect?
- Password hashing: algorithm and cost factor

### 2. Input Validation & Injection
- Are all DTOs decorated with `class-validator` decorators? Check for missing `@IsNotEmpty`, `@IsString`, `@IsEnum`, etc.
- `forbidNonWhitelisted: true` is set globally — verify it is not overridden anywhere.
- Are there any raw SQL queries or Prisma `$queryRaw` / `$executeRaw` calls that could allow SQL injection?
- CSV export: is user-supplied content properly escaped to prevent CSV injection (formula injection)?
- Any `eval`, dynamic `require`, or template literal injection risks in either codebase?

### 3. Sensitive Data Exposure
- Are `.env` files excluded from git (check `.gitignore`)?
- Are any secrets, tokens, or credentials hardcoded in source files?
- Does any API response leak fields that should be private (e.g., `password`, `refreshToken`)?
- Are Prisma `select` clauses used where needed to avoid over-fetching sensitive fields?
- Are JWT payloads minimal (no sensitive data embedded in the token)?

### 4. HTTP Security Headers & Transport
- Is `helmet` applied before any routes?
- Is CORS restricted to `FRONTEND_URL` only, or is it open (`*`)?
- Are cookies using `HttpOnly`, `Secure`, and `SameSite` attributes where applicable?
- Is the `jt_authed` cookie in the frontend store set with appropriate attributes?

### 5. Rate Limiting & Denial of Service
- Is `@nestjs/throttler` configured globally and also on auth routes specifically?
- Are there any unbounded queries (missing `take`/`limit`) that could return huge datasets?
- Does the CSV export have a row limit to prevent memory exhaustion?

### 6. Frontend Security
- Are tokens stored in `localStorage`? Assess XSS risk vs cookie-based storage trade-off.
- Is there any use of `dangerouslySetInnerHTML`?
- Are all external links using `rel="noopener noreferrer"`?
- Does the Axios interceptor leak tokens in error logs?
- Is the `proxy.ts` route guard comprehensive — could an attacker bypass it?

### 7. Infrastructure & Docker
- Are default/weak credentials used in `docker-compose.yml`?
- Is the `DATABASE_URL` with credentials exposed in a non-secret way?
- Are `.env` files copied into Docker images?
- Are images running as root?
- Are there any unnecessary ports exposed?

### 8. Dependency Security
- Run a quick check: are there known high/critical vulnerabilities in `backend/package.json` or `frontend/package.json` dependencies? (Check `npm audit` output if available, or flag obviously outdated packages.)

### 9. Security Logging & Monitoring (OWASP A09)
- Are authentication failures (wrong password, invalid/expired JWT, failed refresh) logged with enough context (timestamp, IP if available) to detect brute-force attempts?
- Are authorization failures (valid token but accessing another user's resource) logged?
- Is `nestjs-pino` configured to redact sensitive fields beyond just `authorization` headers (e.g., `password`, `refreshToken` in request bodies)?
- Are there any silent `catch` blocks in auth flows that swallow errors without logging?

---

## Report format

Output a single structured report using this template:

```
## Security Audit Report
**Project:** Job Tracker  
**Date:** <today>  
**Scope:** Full-stack (NestJS backend + Next.js 16 frontend)

---

### Summary
| Severity | Count |
|----------|-------|
| 🔴 Critical | N |
| 🟠 High | N |
| 🟡 Medium | N |
| 🟢 Low / Info | N |

---

### Findings

#### [SEV] FINDING-001 — <Short title>
**Location:** `path/to/file.ts:line`  
**Description:** What the issue is and why it matters.  
**Proof:** Paste the relevant code snippet.  
**Fix:** Concrete code change or configuration to resolve it.

(repeat for each finding)

---

### Passed Checks
List security controls that are correctly implemented.

---

### Recommendations Summary
Ordered action list from highest to lowest priority.
```

Read all relevant source files before writing the report. Do not guess — only report findings backed by actual code you read.
