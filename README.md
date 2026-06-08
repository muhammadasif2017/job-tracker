# Job Tracker

A full-stack job application tracker built as a portfolio project. Track every application from wishlist to offer with a kanban board, dashboard analytics, interview scheduling, and a full application timeline.

## Features

- **Authentication** — email/password + Google & GitHub OAuth, JWT access tokens (15 min) + refresh tokens (7 days)
- **Job CRUD** — create, read, update, delete with search, status filter, and date range filtering
- **Kanban board** — drag-and-drop status columns powered by `@hello-pangea/dnd`
- **Application timeline** — automatic audit log of every status change per job
- **Interview scheduling** — set a next-interview date on any application
- **Dashboard** — stats cards (total, this month, response rate) + donut chart breakdown by status
- **CSV export** — download all applications (or filtered subset) as a spreadsheet
- **Profile management** — update name, change password, view connected OAuth accounts, delete account
- **Security** — helmet HTTP headers, rate limiting (10 req/min on auth routes), bcrypt password hashing, hashed refresh tokens in DB
- **Structured logging** — pino JSON logging (pretty-print in dev, JSON in production)
- **API docs** — Swagger/OpenAPI at `/api/docs`

## Tech Stack

**Backend**
- NestJS 11 + TypeScript
- PostgreSQL + Prisma 7 (driver adapter: `@prisma/adapter-pg`)
- Passport.js — Local, JWT, JWT-Refresh, Google OAuth2, GitHub OAuth2
- helmet, nestjs-pino, @nestjs/throttler, class-validator

**Frontend**
- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS 4
- TanStack Query v5, Axios, Zustand
- React Hook Form + Zod, @hello-pangea/dnd, Recharts, Sonner, Radix UI

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

# Optional — only needed for OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
```

> Generate secrets with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

**`frontend/.env.local`**
```
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Docker

Run the entire stack (PostgreSQL + backend + frontend) with one command:

```bash
docker compose up --build
```

The backend runs migrations automatically on startup. Visit `http://localhost:3000`.

> Set secure values for `JWT_SECRET` and `JWT_REFRESH_SECRET` in `docker-compose.yml` before deploying.

## Running Tests

The e2e test suite runs against your local database and cleans up after itself (test users are deleted in `afterAll`).

```bash
cd backend
npm run test:e2e
```

Tests cover: register, login, token refresh, logout, job CRUD, status-change timeline events, CSV export, validation errors, and cross-user access control.

## API Documentation

Swagger UI is available at `http://localhost:3001/api/docs` in development (`NODE_ENV !== 'production'`).

### Key endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Create account |
| POST | `/auth/login` | Login with credentials |
| POST | `/auth/refresh` | Refresh access token |
| POST | `/auth/logout` | Invalidate refresh token |
| POST | `/auth/exchange-code` | Exchange OAuth one-time code for tokens |
| GET | `/auth/me` | Current user (from JWT) |
| GET | `/auth/google` | Start Google OAuth |
| GET | `/auth/github` | Start GitHub OAuth |
| GET | `/jobs` | List jobs (search, filter, paginate) |
| POST | `/jobs` | Create job |
| GET | `/jobs/stats` | Dashboard stats |
| GET | `/jobs/export` | Download CSV |
| GET | `/jobs/:id` | Job detail |
| GET | `/jobs/:id/events` | Application timeline |
| PATCH | `/jobs/:id` | Update job |
| DELETE | `/jobs/:id` | Delete job |
| GET | `/users/me` | Full user profile |
| PATCH | `/users/me` | Update profile |
| PATCH | `/users/me/password` | Change password |
| DELETE | `/users/me` | Delete account |

## Project Structure

```
job-tracker/
├── backend/
│   ├── prisma/          # Schema + migrations
│   ├── src/
│   │   ├── auth/        # JWT, OAuth strategies, guards
│   │   ├── jobs/        # Job CRUD, timeline, CSV export
│   │   ├── users/       # Profile management
│   │   ├── prisma/      # PrismaService
│   │   └── common/      # Guards, filters, decorators
│   └── test/            # E2E tests (supertest)
└── frontend/
    ├── app/
    │   ├── (auth)/      # /login, /register, /callback
    │   └── (dashboard)/ # /, /jobs, /jobs/[id], /profile
    ├── components/      # UI primitives + feature components
    ├── lib/             # Axios instance, token storage
    ├── store/           # Zustand auth store
    └── types/           # Shared TypeScript interfaces
```

## License

MIT
