# Architecture Review

In-depth review of the Job Tracker project — written to understand the whole
architecture and the reasoning behind each decision, and to prep for interviews.
No application code was changed; these are read-and-act documents.

| Doc | What it covers |
| --- | --- |
| [01-architecture.md](./01-architecture.md) | Full structural walkthrough: stack rationale, request lifecycle, auth model, OAuth flow, jobs/timeline, enrichment pipeline, Prisma 7, frontend routing/state/data-fetching, data model, deployment topology, testing. The "understand the whole project" document. |
| [02-code-review.md](./02-code-review.md) | Line-level deficiencies and improvements, ranked High/Medium/Low with file:line and fixes — plus a list of *good* decisions worth defending. |
| [03-interview-guide.md](./03-interview-guide.md) | The 60-second pitch, trade-offs to volunteer, likely Q&A with answers, diagrams to practice, and a "what I'd do next" roadmap. |

Read order: **01 → 03 → 02** to learn and present the project; **01 → 02** if you
want to start improving the code.

## Architecture Decision Records

Significant decisions with full alternatives-considered write-ups are in
[`../decisions/`](../decisions/README.md):

| ADR | Decision |
|-----|----------|
| [001](../decisions/001-async-enrichment-queue.md) | Why BullMQ + Redis for enrichment (vs inline, cron, managed queues) |
| [002](../decisions/002-llm-tool-use-extraction.md) | Why Claude Haiku + tool_use (vs JSON mode, OpenAI, Clearbit, local LLM) |
| [003](../decisions/003-company-profile-separate-model.md) | Why CompanyProfile is a separate table (vs JSON column or nullable cols on Job) |
| [004](../decisions/004-dual-jwt-auth.md) | Why dual JWT with hashed refresh (vs sessions, single token, HttpOnly cookie) |
