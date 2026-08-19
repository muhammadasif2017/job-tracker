# Job Tracker

![Deploy](https://github.com/muhammadasif2017/job-tracker/actions/workflows/deploy.yml/badge.svg)

A full-stack job application tracker with AI-powered company intelligence. Track every application from wishlist to offer with a kanban board, dashboard analytics, and a full application timeline. Background workers enrich company profiles via web search + LLM extraction and send interview-reminder / stale-application digest emails.

## Features

- **Authentication** — email/password + Google & GitHub OAuth, JWT access tokens (15 min) + refresh tokens (7 days), plus scoped personal access tokens for the browser extension
- **Job CRUD** — create, read, update, delete with search, status filter, and date range filtering; discovery source (LinkedIn, Indeed, referral, …) tracked separately from application channel
- **Browser extension** (`browser-extension/`) — capture a job posting from any site straight into the tracker via a PAT; see its own README
- **Kanban board** — drag-and-drop status columns powered by `@hello-pangea/dnd`
- **Application timeline** — automatic audit log of every status change per job
- **Interview rounds** — schedule multiple rounds per job, auto-derived "next interview" date, per-round `.ics` calendar export
- **Contacts** — track recruiters/hiring managers per job or per company (name, role, email, phone, LinkedIn, notes)
- **Companies** — deduped company directory with fuzzy-duplicate detection, manual merge, and CSV import
- **Dashboard** — stats cards (total, this month, response rate), donut chart by status, funnel and trend views, "needs attention" list
- **Notifications** — cron-driven interview reminder + digest emails (Resend), deduped and timezone-aware per user
- **Admin panel** — role-gated user list/lookup/delete for operators
- **Company enrichment** — background queue (BullMQ + Redis) fetches company data (industry, tech stack, culture, remote policy) via Tavily search + Groq (openai/gpt-oss-120b) tool calling
- **Resume per job** — upload one PDF resume per application (max 8 MB), stored via a pluggable storage driver (local disk or Oracle Cloud Object Storage)
- **CSV export** — download all applications (or filtered subset) as a spreadsheet
- **Profile management** — update name, change password, notification preferences, timezone, view connected OAuth accounts, delete account
- **Security** — helmet HTTP headers, rate limiting, bcrypt password hashing, hashed refresh tokens in DB, scoped PATs
- **Structured logging** — pino JSON logging (pretty-print in dev, JSON in production)
- **API docs** — Swagger/OpenAPI at `/api/docs`

## Tech Stack

**Backend**
- NestJS 11 + TypeScript
- PostgreSQL + Prisma 7 (driver adapter: `@prisma/adapter-pg`)
- Passport.js — Local, JWT, JWT-Refresh, Google OAuth2, GitHub OAuth2
- BullMQ + Redis — async company enrichment queue
- Groq (openai/gpt-oss-120b) — structured data extraction via tool calling
- Tavily — AI-optimized web search for company enrichment (1000 req/month free tier)
- Resend + @nestjs/schedule — cron-driven reminder/digest emails
- helmet, nestjs-pino, @nestjs/throttler, class-validator

**Frontend**
- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4
- TanStack Query v5, Axios, Zustand
- React Hook Form + Zod, @hello-pangea/dnd, Recharts, Sonner, Radix UI

## Architecture: Company Enrichment

Enrichment runs asynchronously so the API responds immediately (`202 Accepted`) while a background worker gathers and extracts company data:

```mermaid
sequenceDiagram
    participant C as Client
    participant API as NestJS API
    participant Q as BullMQ (Redis)
    participant W as Enrichment Processor
    participant T as Tavily Search
    participant G as Groq LLM

    C->>API: POST /jobs/:id/enrichment
    API->>Q: enqueue job
    API-->>C: 202 Accepted
    Q->>W: process
    W->>W: CompanyProfile → PROCESSING
    par gather context
        W->>T: search company overview
    and
        W->>T: search tech stack & culture
    and
        W->>W: fetch job posting page text
    end
    W->>G: extract structured fields (tool calling)
    G-->>W: industry, techStack, culture, remote policy…
    W->>W: CompanyProfile → COMPLETED (or FAILED + errorMessage)
    C->>API: GET /jobs/:id (poll)
    API-->>C: job with companyProfile
```

## Database Schema

See [docs/database-schema.md](docs/database-schema.md) for the entity-relationship diagram.

## Local Development

### Prerequisites

- Node.js 20+
- PostgreSQL 14+ running locally

### Setup

```bash
# Clone
git clone <repo-url>
cd job-tracker

# Backend
cd backend
npm install
# Create backend/.env — see "Environment variables" section below
npx prisma migrate dev
npm run start:dev             # http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm install
# Create frontend/.env.local — see "Environment variables" section below
npm run dev                   # http://localhost:3000
```

### Environment variables

**`backend/.env`**
```
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/job_tracker?schema=public"
PORT=3001
JWT_SECRET="<random string, minimum 32 characters>"
JWT_REFRESH_SECRET="<random string, minimum 32 characters, different from above>"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
FRONTEND_URL="http://localhost:3000"

# Optional — company enrichment (app starts without these)
GROQ_API_KEY=
TAVILY_API_KEY=
REDIS_URL="redis://localhost:6379"

# Optional — notification emails (app starts and no-ops without these)
RESEND_API_KEY=
EMAIL_FROM="onboarding@resend.dev"

# Optional — only needed for OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# Optional — Oracle Cloud Object Storage (set STORAGE_DRIVER=oracle in prod)
STORAGE_DRIVER=local
OCI_NAMESPACE=
OCI_REGION=
OCI_BUCKET_NAME=
OCI_ACCESS_KEY_ID=
OCI_SECRET_ACCESS_KEY=
```

> Generate secrets with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
>
> Full variable reference (required/optional, defaults): [backend/CLAUDE.md](backend/CLAUDE.md#environment-variables).

**`frontend/.env.local`**
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Docker

Run the entire stack (PostgreSQL + Redis + backend + frontend) with one command — company enrichment works out of the box if you set `GROQ_API_KEY` and `TAVILY_API_KEY`:

```bash
docker compose up --build
```

The backend runs migrations automatically on startup. Visit `http://localhost:3000`.

> Set secure values for `JWT_SECRET` and `JWT_REFRESH_SECRET` in `docker-compose.yml` before deploying.

For local development you can run just the infrastructure (PostgreSQL + Redis) in Docker and keep the apps on your machine:

```bash
docker compose -f docker-compose.dev.yml up -d
```

## Running Tests

The e2e test suite runs against your local database and cleans up after itself (test users are deleted in `afterAll`).

```bash
cd backend
npm run test:e2e
```

Tests cover: register, login, token refresh, logout, job CRUD, status-change timeline events, CSV export, validation errors, and cross-user access control.

## API Documentation

Swagger UI is available at `http://localhost:3001/api/docs` in development (`NODE_ENV !== 'production'`). All endpoints include typed request and response schemas with examples.

### Key endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Login with credentials |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Invalidate refresh token |
| POST | `/auth/exchange-code` | Exchange OAuth one-time code for tokens |
| POST | `/auth/token/exchange` | Exchange a personal access token for a scoped access JWT (extension) |
| GET | `/auth/me` | Current user (from JWT) |
| GET | `/auth/google` | Start Google OAuth |
| GET | `/auth/github` | Start GitHub OAuth |
| GET | `/jobs` | List jobs (search, filter, paginate) |
| POST | `/jobs` | Create job (PAT-accessible) |
| POST | `/jobs/parse` | Parse a job posting URL/text into a draft job (PAT-accessible) |
| GET | `/jobs/stats` | Dashboard stats |
| GET | `/jobs/stats/funnel` | Funnel + response-rate-by-channel stats |
| GET | `/jobs/stats/trend` | Applications-over-time stats |
| GET | `/jobs/attention` | Jobs needing attention (stale, upcoming interview) |
| GET | `/jobs/export` | Download CSV |
| GET | `/jobs/:id` | Job detail |
| GET | `/jobs/:id/events` | Application timeline |
| PATCH | `/jobs/:id` | Update job |
| DELETE | `/jobs/:id` | Delete job |
| POST | `/jobs/:id/enrichment` | Trigger company enrichment (async, 202) |
| POST | `/jobs/:jobId/resumes` | Upload or replace resume PDF (max 8 MB) |
| GET | `/jobs/:jobId/resumes` | Resume metadata |
| GET | `/jobs/:jobId/resumes/url` | Presigned download URL (oracle driver only) |
| DELETE | `/jobs/:jobId/resumes` | Delete resume |
| POST/GET/PATCH/DELETE | `/jobs/:jobId/contacts` | Per-job contact CRUD |
| POST/GET/PATCH/DELETE | `/companies/:companyId/contacts` | Per-company contact CRUD |
| POST/GET/PATCH/DELETE | `/jobs/:jobId/interview-rounds` | Interview round CRUD |
| GET | `/jobs/:jobId/interview-rounds/:roundId/ics` | Download round as `.ics` calendar event |
| GET | `/companies` | List companies (search, paginate) |
| GET | `/companies/duplicates` | Fuzzy-duplicate candidate pairs |
| POST | `/companies/:id/merge` | Merge duplicate company into another |
| POST | `/companies/import` | Bulk CSV import |
| POST | `/tokens` | Create a personal access token (raw value shown once) |
| GET | `/tokens` | List active personal access tokens |
| DELETE | `/tokens/:id` | Revoke a personal access token |
| GET | `/admin/users` | List/search users (admin only) |
| DELETE | `/admin/users/:id` | Delete a user (admin only) |
| GET | `/users/me` | Full user profile |
| PATCH | `/users/me` | Update profile |
| PATCH | `/users/me/notifications` | Update notification preferences / timezone |
| PATCH | `/users/me/password` | Change password |
| DELETE | `/users/me` | Delete account |

## Project Structure

```
job-tracker/
├── backend/
│   ├── prisma/              # Schema + migrations
│   ├── src/
│   │   ├── modules/
│   │   │   ├── auth/             # JWT, OAuth strategies, guards
│   │   │   ├── jobs/             # Job CRUD, timeline, CSV export
│   │   │   ├── companies/        # Company directory, dedup/merge, CSV import
│   │   │   ├── contacts/         # Per-job / per-company contact CRUD
│   │   │   ├── interview-rounds/ # Interview round CRUD, ICS export
│   │   │   ├── notifications/    # Reminder/digest email queue + scheduler
│   │   │   ├── tokens/           # Personal access tokens (browser extension)
│   │   │   ├── admin/            # Role-gated user admin
│   │   │   ├── users/            # Profile management
│   │   │   ├── resumes/          # Resume upload/download per job
│   │   │   ├── enrichment/       # BullMQ queue, processor, AI/search services
│   │   │   └── health/           # /health endpoint
│   │   ├── storage/         # Storage drivers (local disk, Oracle Object Storage)
│   │   ├── prisma/          # PrismaService
│   │   └── common/          # Guards, filters, decorators
│   └── test/                # E2E tests (supertest)
├── frontend/
│   ├── app/
│   │   ├── (auth)/      # /login, /register, /callback
│   │   └── (dashboard)/ # /, /jobs, /jobs/[id], /companies, /admin, /profile
│   ├── components/      # UI primitives + feature components
│   ├── features/        # TanStack Query hooks per feature (jobs, profile, admin, dashboard, …)
│   ├── lib/              # Axios instance, token storage
│   ├── store/             # Zustand auth store
│   └── types/             # Shared TypeScript interfaces
└── browser-extension/   # Manifest V3 extension — captures a job posting via PAT (own README)
```

## Deployment

Production runs the backend on a single VM behind Caddy (automatic HTTPS), with managed services for the rest:

- **Backend** — Docker image built from `backend/Dockerfile.prod`, published to GHCR, run via `docker-compose.prod.yml` (Caddy + Redis + backend; ports 80/443 only). Migrations (`prisma migrate deploy`) run automatically on container startup.
- **Database** — Neon managed PostgreSQL (`DATABASE_URL` with `?sslmode=require`).
- **File storage** — Oracle Cloud Object Storage (`STORAGE_DRIVER=oracle`).
- **Frontend** — deployed separately from the backend stack; point `NEXT_PUBLIC_API_URL` at the backend's public URL (a `frontend/Dockerfile.prod` is provided for containerized hosting).

CI/CD:

- `deploy.yml` — every PR runs typecheck + unit tests; on push to `main` it additionally builds and pushes the backend image, then deploys (below).
- `e2e-pr.yml` — Playwright e2e, path-filtered to `frontend/**`/`backend/**` changes, **merge-blocking** (not just nightly) since ADR-025.
- `e2e-nightly.yml` — full e2e suite on a schedule.
- `frontend-ci.yml` — frontend lint/typecheck/build.
- `extension-ci.yml` — browser extension lint/test.

On push to `main`, `deploy.yml` SSHes into the VM and runs:

```bash
docker compose -f docker-compose.prod.yml --env-file .env pull
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Required GitHub secrets: `SSH_HOST`, `SSH_USER`, `SSH_PRIVATE_KEY` (optional `SSH_PORT`, `DEPLOY_PATH` var). Runtime secrets live in a `.env` file next to `docker-compose.prod.yml` on the VM.

## License

MIT — see [LICENSE](LICENSE).
