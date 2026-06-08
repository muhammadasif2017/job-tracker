# Backend Plan — Job Tracker API

> Stack: NestJS · PostgreSQL · Prisma 7 · TypeScript

---

## Architecture

```
src/
├── auth/          # JWT auth + Google/GitHub OAuth
├── users/         # User profile management
├── jobs/          # Job applications CRUD + stats
├── prisma/        # Global PrismaService (done)
├── common/        # Shared guards, decorators, filters, pipes
└── config/        # App config via @nestjs/config
```

Each feature = its own NestJS module (module / controller / service / dto).

---

## Modules & Endpoints

### 1. Config Module
- Load `.env` via `@nestjs/config` with Joi validation schema
- Environment variables:

| Variable               | Purpose                              |
|------------------------|--------------------------------------|
| `DATABASE_URL`         | PostgreSQL connection string         |
| `JWT_SECRET`           | Sign access tokens                   |
| `JWT_REFRESH_SECRET`   | Sign refresh tokens                  |
| `JWT_EXPIRES_IN`       | Access token TTL (e.g. `15m`)        |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token TTL (e.g. `7d`)     |
| `PORT`                 | Server port (default `3001`)         |
| `FRONTEND_URL`         | e.g. `http://localhost:3000`         |
| `GOOGLE_CLIENT_ID`     | From Google Cloud Console            |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console            |
| `GITHUB_CLIENT_ID`     | From GitHub OAuth App settings       |
| `GITHUB_CLIENT_SECRET` | From GitHub OAuth App settings       |

---

### 2. Auth Module

#### Credentials (email + password)

| Method | Endpoint           | Description                          | Auth |
|--------|--------------------|--------------------------------------|------|
| POST   | /auth/register     | Create account, return tokens        | No   |
| POST   | /auth/login        | Email + password → return tokens     | No   |
| POST   | /auth/refresh      | Rotate JWT using refresh token       | No   |
| POST   | /auth/logout       | Invalidate refresh token in DB       | Yes  |
| GET    | /auth/me           | Return current authenticated user    | Yes  |

#### Google OAuth

| Method | Endpoint                  | Description                                           | Auth |
|--------|---------------------------|-------------------------------------------------------|------|
| GET    | /auth/google              | Redirect to Google consent screen                     | No   |
| GET    | /auth/google/callback     | Google redirects here → issue tokens → redirect to FE | No   |

#### GitHub OAuth

| Method | Endpoint                  | Description                                           | Auth |
|--------|---------------------------|-------------------------------------------------------|------|
| GET    | /auth/github              | Redirect to GitHub consent screen                     | No   |
| GET    | /auth/github/callback     | GitHub redirects here → issue tokens → redirect to FE | No   |

#### OAuth Flow (same for both providers)

```
Browser                 Backend                     Provider
  |                        |                             |
  |-- GET /auth/google --> |                             |
  |                        |-- redirect to OAuth URL --> |
  |                        |                             |
  |                        |<-- callback with code ------ |
  |                        |                             |
  |                        | validate + find/create user  |
  |                        | issue access + refresh token |
  |                        |                             |
  |<-- redirect to --------|
  |  FRONTEND_URL/auth/callback?accessToken=x&refreshToken=y
```

**find-or-create logic (in `AuthService.handleOAuthUser`):**
1. Look up `Account` by `(provider, providerAccountId)`
2. If found → load user, issue tokens
3. If not found → look up `User` by email
   - If user exists → create `Account` linked to that user (account linking)
   - If no user → create `User` + `Account` together
4. Issue tokens

This handles the case where a user registered with email and later signs in with Google using the same address — their accounts merge automatically.

#### Credential auth implementation details
- `bcrypt` (10 rounds) for password hashing
- Access token: 15m, signed with `JWT_SECRET`
- Refresh token: 7d, stored **hashed** in `User.refreshToken`, signed with `JWT_REFRESH_SECRET`
- `PassportJS`: `LocalStrategy` (login), `JwtStrategy` (protected routes), `GoogleStrategy`, `GithubStrategy`
- `JwtAuthGuard` applied globally; `@Public()` decorator to opt out
- `@CurrentUser()` decorator to extract user from request

---

### 3. Users Module

| Method | Endpoint               | Description                         | Auth |
|--------|------------------------|-------------------------------------|------|
| GET    | /users/me              | Get own profile + connected accounts | Yes  |
| PATCH  | /users/me              | Update name / email                 | Yes  |
| PATCH  | /users/me/password     | Change password                     | Yes  |
| DELETE | /users/me              | Delete own account                  | Yes  |

**Notes:**
- `PATCH /users/me/password` is only available if `user.password` is not null (i.e. not OAuth-only)
- Profile response includes `connectedProviders: ["google"]` so the UI can show which OAuth accounts are linked

**DTOs:** `UpdateUserDto`, `ChangePasswordDto`

---

### 4. Jobs Module

| Method | Endpoint        | Description                             | Auth |
|--------|-----------------|-----------------------------------------|------|
| POST   | /jobs           | Create a job application                | Yes  |
| GET    | /jobs           | List jobs (filter, search, paginate)    | Yes  |
| GET    | /jobs/stats     | Aggregated stats for dashboard          | Yes  |
| GET    | /jobs/:id       | Get single job                          | Yes  |
| PATCH  | /jobs/:id       | Update job (any field including status) | Yes  |
| DELETE | /jobs/:id       | Delete job                              | Yes  |

**Query parameters for GET /jobs:**

| Param     | Type     | Example                             |
|-----------|----------|-------------------------------------|
| status    | enum     | `APPLIED`, `INTERVIEWING`           |
| search    | string   | searches company + position         |
| page      | number   | default `1`                         |
| limit     | number   | default `10`, max `100`             |
| sortBy    | string   | `appliedAt`, `company`, `createdAt` |
| sortOrder | asc/desc | default `desc`                      |
| dateFrom  | ISO date | filter by appliedAt                 |
| dateTo    | ISO date | filter by appliedAt                 |

**Response for GET /jobs/stats:**
```json
{
  "total": 42,
  "byStatus": {
    "WISHLIST": 5,
    "APPLIED": 20,
    "INTERVIEWING": 8,
    "OFFER": 2,
    "REJECTED": 6,
    "GHOSTED": 1
  },
  "thisMonth": 12,
  "responseRate": 47.6
}
```

**DTOs:** `CreateJobDto`, `UpdateJobDto`, `JobQueryDto`

**Guards:** Each job endpoint verifies the job belongs to `req.user.id` (ownership check in service layer).

---

## Common / Shared

### Global Exception Filter
- Maps Prisma errors → HTTP: P2002 (unique) → 409, P2025 (not found) → 404
- Catches `class-validator` errors → 400

### Validation Pipe
- Global `ValidationPipe`: `whitelist: true`, `transform: true`, `forbidNonWhitelisted: true`

### Decorators
- `@CurrentUser()` — extract user from JWT payload
- `@Public()` — bypass `JwtAuthGuard`

### Rate Limiting
- `@nestjs/throttler`: 100 req / 60s globally
- Stricter on `/auth/login` and `/auth/register`: 10 req / 60s

---

## Prisma Schema Summary

```prisma
model User {
  id           String    @id @default(cuid())
  email        String    @unique
  password     String?   // null for OAuth-only users
  name         String
  avatarUrl    String?
  refreshToken String?   // hashed
  jobs         Job[]
  accounts     Account[]
}

model Account {
  id                String @id @default(cuid())
  provider          String // "google" | "github"
  providerAccountId String
  userId            String
  user              User   @relation(...)

  @@unique([provider, providerAccountId])
}
```

---

## Swagger / OpenAPI
- Auto-generated docs at `/api/docs`
- All endpoints annotated with `@ApiTags`, `@ApiBearerAuth`, `@ApiOperation`
- OAuth endpoints documented with redirect behavior note

---

## Security Checklist
- [x] Passwords hashed with bcrypt
- [x] JWT secrets via env vars
- [x] Refresh tokens stored hashed in DB
- [x] OAuth secrets via env vars (never hardcoded)
- [x] Ownership checks on all job endpoints
- [x] Input validation with class-validator
- [x] Rate limiting on auth routes
- [x] `FRONTEND_URL` allowlist for CORS
- [x] `.env` gitignored

---

## Implementation Order

1. `@nestjs/config` setup + Joi env validation
2. Auth module — credentials (register + login + JWT guards)
3. Refresh token + logout
4. Google OAuth strategy + callback
5. GitHub OAuth strategy + callback
6. Users module
7. Jobs module (CRUD)
8. Jobs stats endpoint
9. Global exception filter
10. Rate limiting
11. Swagger docs

---

## Dependencies to Install

```bash
# Auth — credentials
npm install @nestjs/passport passport passport-local passport-jwt @nestjs/jwt bcrypt
npm install -D @types/passport-local @types/passport-jwt @types/bcrypt

# Auth — OAuth
npm install passport-google-oauth20 passport-github2
npm install -D @types/passport-google-oauth20 @types/passport-github2

# Config
npm install @nestjs/config joi

# Validation
npm install class-validator class-transformer

# Rate limiting
npm install @nestjs/throttler

# Swagger
npm install @nestjs/swagger swagger-ui-express
```
