# UML diagrams

Behavioural diagrams for flows whose rules live in code. For the system-level views see [`architecture.md`](./architecture.md); for the schema see [`database-schema.md`](./database-schema.md).

## Company enrichment status (state diagram)

`Company.status` (`EnrichmentStatus`, nullable). Transitions are enforced by compare-and-swap `updateMany` claims in `CompaniesService.triggerEnrichment` and `CompanyEnrichmentService`, and by status writes in `CompanyEnrichmentProcessor`.

```mermaid
stateDiagram-v2
    [*] --> NotEnriched: company row created (status null)

    NotEnriched --> PENDING: created by hand (enqueueEnrichment)
    NotEnriched --> PENDING: job added at company (enqueueIfStale claim)
    COMPLETED --> PENDING: Refresh (triggerEnrichment claim)
    FAILED --> PENDING: Refresh (triggerEnrichment claim)

    PENDING --> NotEnriched: enqueueIfStale queue add failed (rollback)
    PENDING --> FAILED: enqueueEnrichment queue add failed
    PENDING --> PROCESSING: worker picks up job

    PROCESSING --> COMPLETED: extraction saved
    PROCESSING --> COMPLETED: later step failed, extraction salvaged
    PROCESSING --> FAILED: run threw with no extraction

    FAILED --> PROCESSING: BullMQ retry (2nd attempt)

    note right of PENDING
        Refresh on PENDING or PROCESSING
        returns 409 Conflict, no transition
    end note
    note right of FAILED
        No retry for UnrecoverableError
        (search quota or bad key with no context)
    end note
```

`enqueueIfStale` only claims `NotEnriched` companies, so adding more jobs at a COMPLETED or FAILED company never re-runs enrichment (ADR-035). Only the Refresh button does. A company deleted mid-run is left alone: the worker checks the row still exists before writing.

## Capture a job with the browser extension (sequence diagram)

```mermaid
sequenceDiagram
    actor U as User
    participant P as Extension popup
    participant BG as Extension service worker
    participant T as Active tab
    participant API as NestJS API
    participant L as Groq LLM
    participant S as Tavily Search

    Note over U,API: One-time connect
    U->>P: backend URL + personal access token
    P->>BG: connect
    BG->>API: POST /auth/token/exchange {token}
    API-->>BG: accessToken, expiresIn
    BG->>BG: chrome.storage.local ← PAT + accessToken

    Note over U,S: Import a posting
    U->>P: Import this job
    P->>T: chrome.scripting.executeScript (read page text)
    T-->>P: rendered posting text
    P->>BG: parseJob {url, text}
    BG->>BG: re-exchange PAT if accessToken near expiry
    BG->>API: POST /jobs/parse (Bearer) — throttled 10/min
    API->>L: extractJobPosting(tab text)
    alt extraction failed and URL present
        API->>S: search(url)
        API->>L: extractJobPosting(search snippets)
    end
    API-->>BG: company, position, location, jobType, applicationChannel
    BG-->>P: parsed fields
    P-->>U: preview form

    U->>P: Add to Job Tracker (after edits)
    P->>BG: createJob {payload}
    BG->>API: POST /jobs (Bearer)
    alt 401 Unauthorized
        BG->>API: POST /auth/token/exchange (force)
        BG->>API: POST /jobs (retry once)
    end
    API-->>BG: created job
    BG-->>P: ok
    P-->>U: success message
```

Tab text wins over a server-side fetch of the URL: sites like LinkedIn answer the server with a logged-out page. A `403` from the token exchange means the PAT was revoked, so the service worker clears the stored connection.

## Resume upload and view (sequence diagram)

```mermaid
sequenceDiagram
    actor U as User
    participant FE as Web app
    participant API as NestJS API
    participant DB as Postgres
    participant ST as StorageService
    participant OS as Object storage (Oracle)

    U->>FE: choose PDF (max 8 MB)
    FE->>API: POST /jobs/:jobId/resumes (multipart) — throttled 5/min
    API->>API: size + mime validators, then %PDF magic-number check
    API->>DB: find job owned by user (+ current resume key)
    API->>ST: upload(resumes/userId/jobId/uuid.pdf)
    ST->>OS: PutObject
    API->>DB: upsert Resume (jobId unique)
    alt upsert failed
        API->>ST: delete new key (best effort)
    else replaced an older file
        API->>ST: delete old key (best effort)
    end
    API-->>FE: resume metadata

    U->>FE: View
    FE->>API: GET /jobs/:jobId/resumes/url
    API->>DB: find resume for user's job
    API->>ST: getPresignedUrl(key)
    alt oracle driver (prod)
        ST-->>API: presigned GET URL, 900s
        API-->>FE: url
        FE->>OS: open URL in new tab (no Bearer needed)
    else local driver (dev)
        ST-->>API: /jobs/resumes/file?key=…
        API-->>FE: url
        FE->>API: fetch file with Bearer token
        FE->>FE: open blob URL in new tab
    end
```

## Notification digest (sequence diagram)

```mermaid
sequenceDiagram
    participant CR as NotificationsScheduler (hourly, UTC)
    participant DB as Postgres
    participant Q as notifications queue (Redis)
    participant W as NotificationsProcessor
    participant E as EmailService → Resend

    CR->>DB: users with digestFrequency DAILY / WEEKLY
    loop each user
        CR->>CR: user's local hour is 08:00? (and Monday for weekly)
        CR->>DB: getAttentionItems(user)
        opt has items
            CR->>Q: add 'digest' with jobId digest-frequency-userId-localDate
            Note right of Q: same jobId twice in one window is a no-op
        end
    end

    Q->>W: process 'digest'
    W->>DB: load user, skip if digestFrequency OFF
    W->>DB: getAttentionItems(user)
    W->>W: drop stale items already reported (staleAppliedDigestedAt / staleInterviewingDigestedAt)
    opt items left
        W->>E: send digest email
        alt Resend resolves with {error}
            E-->>W: EmailService throws → BullMQ retries
        else sent
            E-->>W: ok
            W->>DB: stamp dedup fields on reported jobs (never throws)
        end
    end
```

Stamping happens only after a successful send, so a failed or retried send still includes the items next time. A stamp failure is logged, not thrown: the email already went out, and a BullMQ retry would send it twice.
