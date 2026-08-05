# Database Schema

```mermaid
erDiagram
    User ||--o{ Job : owns
    User ||--o{ Account : "links (OAuth)"
    User ||--o{ RefreshToken : has

    Job ||--o{ JobEvent : logs
    Job |o--|| CompanyProfile : enriches
    Job |o--|| Resume : attaches
    Job ||--o{ InterviewRound : schedules
    Job ||--o{ Contact : lists

    User {
        string id PK
        string email UK
        string password
        string name
        Role role
        DigestFrequency digestFrequency
    }
    Job {
        string id PK
        string userId FK
        string company
        string position
        JobStatus status
        JobPriority priority
        JobType jobType
        datetime nextInterviewAt
    }
    JobEvent {
        string id PK
        string jobId FK
        JobEventType type
        JobStatus fromStatus
        JobStatus toStatus
    }
    CompanyProfile {
        string id PK
        string jobId FK,UK
        EnrichmentStatus status
        string industry
        string[] techStack
    }
    Resume {
        string id PK
        string jobId FK,UK
        string originalName
        string storageKey UK
    }
    InterviewRound {
        string id PK
        string jobId FK
        string stage
        datetime scheduledAt
        InterviewOutcome outcome
    }
    Contact {
        string id PK
        string jobId FK
        string name
        string email
    }
    Account {
        string id PK
        string userId FK
        string provider
        string providerAccountId
    }
    RefreshToken {
        string id PK
        string userId FK
        string tokenHash
        datetime expiresAt
    }
```

All child tables (`Job`, `Account`, `RefreshToken`) cascade-delete on `User` removal; all `Job`-child tables (`JobEvent`, `CompanyProfile`, `Resume`, `InterviewRound`, `Contact`) cascade-delete on `Job` removal. `CompanyProfile` and `Resume` are 1:1-optional (unique `jobId`); `InterviewRound`, `Contact`, `JobEvent` are 1:many. See `backend/prisma/schema.prisma` for the full source of truth.
