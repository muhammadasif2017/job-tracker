# Architecture

System-level diagrams. For DB schema detail see [`database-schema.md`](./database-schema.md); for backend/frontend internals see [`backend-overview.md`](./backend-overview.md) and [`frontend-overview.md`](./frontend-overview.md).

## System context

```mermaid
flowchart LR
    U[User Browser]
    FE["Frontend<br/>Next.js (Vercel)"]
    BE["Backend API<br/>NestJS (:3001)"]
    PG[(PostgreSQL)]
    RD[(Redis)]
    CADDY["Caddy<br/>TLS reverse proxy"]
    GOOGLE[Google OAuth]
    GITHUB[GitHub OAuth]
    GROQ[Groq LLM]
    TAVILY[Tavily Search]
    RESEND[Resend Email]
    OCI["Oracle Object Storage<br/>(prod) / local disk (dev)"]

    U --> FE
    FE -->|"HTTPS BACKEND_DOMAIN"| CADDY --> BE
    BE --> PG
    BE <--> RD
    BE --> GOOGLE
    BE --> GITHUB
    BE --> GROQ
    BE --> TAVILY
    BE --> RESEND
    BE --> OCI
```

## Backend module map (NestJS)

```mermaid
flowchart TB
    subgraph Core
        CFG["ConfigModule (Joi validation)"]
        THR[ThrottlerGuard — 100 req/60s global]
        SCHED[ScheduleModule — cron jobs]
        BULL["BullModule — Redis-backed queues"]
        LOG[nestjs-pino Logger]
        PRISMA[PrismaModule — global]
    end

    subgraph Auth
        AUTHM[AuthModule]
        JWTG["JwtAuthGuard (global)"]
        ROLESG["RolesGuard (global)"]
        STRAT["Strategies: Jwt, JwtRefresh, Google, GitHub, Local"]
    end

    subgraph Domain
        USERS[UsersModule]
        JOBS[JobsModule]
        CONTACTS[ContactsModule]
        IROUNDS[InterviewRoundsModule]
        RESUMES[ResumesModule]
        ADMIN[AdminModule]
    end

    subgraph Async
        ENRICH["EnrichmentModule<br/>ENRICHMENT_QUEUE"]
        NOTIF["NotificationsModule<br/>NOTIFICATIONS_QUEUE"]
    end

    subgraph Infra
        STORAGE["StorageModule (global)<br/>Local | Oracle driver"]
        HEALTH[HealthModule]
    end

    AUTHM --> JWTG --> ROLESG
    AUTHM --> STRAT

    JOBS -->|"ensureJobOwned(userId, jobId)"| CONTACTS
    JOBS -->|"ensureJobOwned(userId, jobId)"| IROUNDS
    JOBS --> RESUMES
    JOBS -.->|triggers on create| ENRICH
    IROUNDS -.->|"recomputeNextInterviewAt (tx)"| JOBS
    IROUNDS -.->|reminder scheduling| NOTIF
    RESUMES --> STORAGE
    ADMIN --> USERS

    BULL --> ENRICH
    BULL --> NOTIF
```

## Auth flow — JWT + OAuth

```mermaid
sequenceDiagram
    participant B as Browser
    participant FE as Frontend
    participant BE as Backend
    participant G as Google/GitHub
    participant R as Redis
    participant DB as Postgres

    Note over B,DB: Password login
    B->>FE: submit credentials
    FE->>BE: POST /auth/login
    BE->>DB: verify user + password
    BE-->>FE: accessToken (body) + jt_refresh (httpOnly cookie)

    Note over B,DB: OAuth login
    B->>BE: GET /auth/google
    BE->>G: redirect to consent
    G->>BE: GET /auth/google/callback
    BE->>DB: handleOAuthUser (find/link/create)
    BE->>R: storeOAuthCode(tokens) — 60s TTL UUID
    BE-->>B: redirect FRONTEND_URL/callback?code=uuid
    FE->>BE: POST /auth/exchange-code {code}
    BE->>R: consume code
    BE-->>FE: accessToken + jt_refresh cookie

    Note over B,DB: Refresh + theft detection
    FE->>BE: POST /auth/refresh (cookie)
    BE->>DB: lookup RefreshToken by jti hash
    alt token already revoked (replay)
        BE->>DB: revoke ALL user's refresh tokens
        BE-->>FE: 401
    else valid
        BE->>DB: soft-revoke old row, insert new row
        BE-->>FE: new accessToken + new jt_refresh
    end
```

## Async pipelines — enrichment & notifications (BullMQ)

```mermaid
flowchart LR
    subgraph Enrichment
        JC["Job created"] -->|enqueue| EQ["ENRICHMENT_QUEUE (Redis)"]
        EQ --> EP[EnrichmentProcessor]
        EP --> TAV[Tavily search]
        EP --> GROQ[Groq LLM extraction]
        EP -->|"status: PENDING→PROCESSING→COMPLETED/FAILED"| CP[(CompanyProfile)]
    end

    subgraph Notifications
        CRON["ScheduleModule cron<br/>NotificationsScheduler"] -->|enqueue| NQ["NOTIFICATIONS_QUEUE (Redis)"]
        NQ --> NP[NotificationsProcessor]
        NP --> RESEND[Resend API]
        NP -->|"stamps digestedAt / reminderSentAt"| JOBROW[(Job / InterviewRound)]
    end
```

`EmailService` no-ops (logs only) when `RESEND_API_KEY` is unset — app still boots.

## Frontend structure (Next.js App Router)

```mermaid
flowchart TB
    subgraph Routes["app/ (route segments)"]
        AUTHG["(auth): login, register, callback"]
        DASHG["(dashboard): /, jobs, jobs/[id], profile, admin/users"]
    end

    subgraph Features["features/*/hooks.ts — TanStack Query"]
        FJOBS["jobs: hooks, contacts.hooks, interview-rounds.hooks, resume.hooks"]
        FADMIN[admin/hooks.ts]
        FDASH[dashboard/hooks.ts]
        FPROFILE[profile/hooks.ts]
    end

    subgraph Components
        COMPJOBS["components/jobs — job-form.tsx (RHF + Zod)"]
        COMPAUTH[components/auth]
        COMPUI[components/ui]
        COMPLAYOUT[components/layout]
    end

    APIGEN["Generated API types<br/>(from backend OpenAPI spec)"]
    BACKEND[("Backend API")]

    Routes --> Features
    Features -->|"['jobs', filters] query keys"| APIGEN
    Routes --> Components
    Components --> Features
    APIGEN -->|typed fetch| BACKEND
```

Query/mutation logic lives in `features/*/hooks.ts`, not in route pages or components — route pages hold local UI state only.

## Deployment topology

```mermaid
flowchart LR
    subgraph Vercel
        FE[Next.js frontend]
    end
    subgraph "VM (Caddy + Docker Compose)"
        CADDY["Caddy<br/>Let's Encrypt TLS, :80/:443"]
        BE["backend container<br/>:3001"]
        PG[(postgres container)]
        RD[(redis container)]
    end
    EXT["Groq / Tavily / Resend /<br/>Google & GitHub OAuth / OCI Storage"]

    FE -->|HTTPS BACKEND_DOMAIN| CADDY --> BE
    BE --> PG
    BE --> RD
    BE --> EXT
```
