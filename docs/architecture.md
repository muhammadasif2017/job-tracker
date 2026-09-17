# Architecture

System-level diagrams. For state and sequence diagrams of individual flows see [`uml.md`](./uml.md). For DB schema detail see [`database-schema.md`](./database-schema.md); for backend/frontend internals see [`backend-overview.md`](./backend-overview.md) and [`frontend-overview.md`](./frontend-overview.md).

## System context and data flow

```mermaid
flowchart LR
    U[User]
    FE["Frontend<br/>Next.js (Vercel)"]
    EXTN["Browser extension<br/>reads open tab"]
    CADDY["Caddy<br/>TLS reverse proxy"]
    BE["Backend API<br/>NestJS (:3001)"]
    PG[("Neon Postgres<br/>store of record")]
    RD[("Redis<br/>BullMQ queues, OAuth codes,<br/>dedup keys")]
    OCI[("Oracle Object Storage (prod)<br/>/ local disk (dev)")]
    OAUTH[Google / GitHub OAuth]
    GROQ["Groq LLM<br/>openai/gpt-oss-120b"]
    TAVILY["Tavily Search<br/>+ company websites"]
    RESEND[Resend Email]
    WK["BullMQ workers<br/>same backend process"]

    U -->|UI actions| FE
    U -->|capture posting| EXTN
    FE -->|"HTTPS JSON, Bearer JWT<br/>+ jt_refresh cookie"| CADDY
    EXTN -->|"PAT → short JWT,<br/>create job"| CADDY
    CADDY -->|reverse_proxy| BE
    BE <-->|Prisma SQL| PG
    BE -.->|enqueue| RD
    BE -->|"put, delete, presign"| OCI
    FE -.->|"GET resume via presigned URL"| OCI
    BE <-->|"redirect, profile"| OAUTH
    BE <-->|"parse posting, round prep"| GROQ
    RD -.->|consume| WK
    WK -.->|"extract, summarize"| GROQ
    WK -.->|"search, page fetch"| TAVILY
    WK -.->|emails.send| RESEND
    WK -.->|write results| PG
    RESEND -.->|reminders, digests| U
```

Solid arrows run inside a request; dotted arrows run in BullMQ workers or bypass the API. Postgres is the only store of record — Redis holds work in flight. A published visual version of this page lives at <https://claude.ai/artifact/XE3NMk5ubDKpuLh1LnMUXm>.

## Backend module map (NestJS)

### Core and auth

```mermaid
flowchart LR
    subgraph Core
        direction TB
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
        STRAT["Strategies: Jwt, JwtRefresh,<br/>Google, GitHub, Local"]
    end

    AUTHM --> JWTG --> ROLESG
    AUTHM --> STRAT
```

### Feature modules

```mermaid
flowchart LR
    subgraph Domain
        AUTHM[AuthModule]
        USERS[UsersModule]
        JOBS[JobsModule]
        COMPANIES[CompaniesModule]
        CONTACTS[ContactsModule]
        IROUNDS[InterviewRoundsModule]
        RESUMES[ResumesModule]
        TOKENS["TokensModule<br/>personal access tokens"]
        ADMIN[AdminModule]
    end

    subgraph Async
        BULL["BullModule"]
        CENRICH["CompanyEnrichmentModule<br/>company-target-enrichment queue"]
        TSUM["TimelineSummaryModule<br/>job-timeline-summary queue"]
        NOTIF["NotificationsModule<br/>notifications queue"]
    end

    subgraph Infra
        ENRICH["EnrichmentModule<br/>LlmService, SearchService,<br/>WebFetchService"]
        STORAGE["StorageModule (global)<br/>Local | Oracle driver"]
        HEALTH[HealthModule]
    end

    AUTHM -->|PAT exchange| TOKENS
    JOBS -->|"ensureJobOwned(userId, jobId)"| CONTACTS
    JOBS -->|"ensureJobOwned(userId, jobId)"| IROUNDS
    COMPANIES -->|"ensureOwner (company parent)"| CONTACTS
    JOBS --> RESUMES
    JOBS -.->|enqueueIfStale| CENRICH
    COMPANIES -.->|"create / triggerEnrichment"| CENRICH
    JOBS -.->|enqueue| TSUM
    IROUNDS -.->|enqueue| TSUM
    IROUNDS -.->|"recomputeNextInterviewAt (tx)"| JOBS
    JOBS -->|"extractJobPosting (sync)"| ENRICH
    IROUNDS -->|"generateRoundPrep (sync)"| ENRICH
    CENRICH --> ENRICH
    TSUM --> ENRICH
    RESUMES --> STORAGE
    ADMIN --> USERS
    ADMIN -.->|queue dashboard| BULL
    BULL --> CENRICH
    BULL --> TSUM
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

    Note over B,DB: Browser extension (personal access token)
    B->>BE: POST /auth/token/exchange {PAT}
    BE->>DB: bcrypt-compare ApiToken, check revokedAt + expiresAt
    BE-->>B: short-lived accessToken (no refresh cookie)
    B->>BE: API call with Bearer accessToken
```

Daily at midnight, `AuthService` deletes expired `RefreshToken` rows and `TokensService` deletes expired `ApiToken` rows.

## Async pipelines — enrichment, timeline summary & notifications (BullMQ)

### Company enrichment

```mermaid
flowchart LR
    JC["Company created / re-enrich<br/>or job linked (enqueueIfStale)"] -->|enqueue| EQ["company-target-enrichment<br/>queue (Redis)"]
    EQ --> EP["CompanyEnrichmentProcessor<br/>lock 90s"]
    EP --> TAV["Tavily search<br/>+ WebFetchService"]
    TAV -->|context| GROQ[Groq LLM extraction]
    GROQ -->|"status, enrichedAt"| CP[(Company)]
```

### Timeline summary

```mermaid
flowchart LR
    JE["Job / interview round<br/>changed"] -->|enqueue| TQ["job-timeline-summary<br/>queue (Redis)"]
    TQ --> TP["TimelineSummaryProcessor<br/>lock 90s"]
    TP -->|reads recent| EV[(JobEvent)]
    TP --> GROQ2[Groq summarizeEvents]
    GROQ2 -->|"timelineSummary, timelineSummaryAt"| JOBSUM[(Job)]
```

### Notifications

```mermaid
flowchart LR
    CRON["Hourly @Cron<br/>NotificationsScheduler"] -->|"enqueue reminder / digest"| NQ["notifications<br/>queue (Redis)"]
    NQ --> NP[NotificationsProcessor]
    NP -->|emails.send| RESEND[Resend API]
    NP -->|"stamps reminderSentAt /<br/>stale*DigestedAt"| JOBROW[(Job / InterviewRound)]
```

Company enrichment moves `status` through PENDING → PROCESSING → COMPLETED / FAILED.

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
        RD[("redis container<br/>appendonly, noeviction")]
    end
    PG[("Neon Postgres<br/>managed")]
    EXT["Groq / Tavily / Resend /<br/>Google & GitHub OAuth / OCI Storage"]
    EXTN[Browser extension]

    FE -->|HTTPS BACKEND_DOMAIN| CADDY --> BE
    EXTN -->|HTTPS BACKEND_DOMAIN| CADDY
    BE --> PG
    BE --> RD
    BE --> EXT
```
