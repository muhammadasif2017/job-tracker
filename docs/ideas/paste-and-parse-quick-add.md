# Paste & Parse Quick Add

## Problem Statement
How might we let a solo user add a job application to the tracker by pasting a URL or job description, instead of typing every field by hand?

## Recommended Direction
Extend the existing enrichment infrastructure (`WebFetchService` + `LlmService`, currently used for `CompanyProfile` enrichment) with a second extraction path for job postings. User pastes either a job posting URL or raw job-description text into a "Quick Add" entry point. If a URL is given, the backend fetches the page (`WebFetchService`, cheerio) and runs it through a new Groq tool-calling extraction (same pattern as `EXTRACT_TOOL` in `llm.service.ts`) to pull structured fields: title, company, location, `JobType`, `JobSource` guess, salary if present. If the fetch fails (login-walled posting, JS-rendered page, or the user just has raw text copied from an email/DM), the same extraction step runs directly on pasted text — no separate code path, just skip the fetch.

Extracted fields prefill the existing `JobForm` (`frontend/components/jobs/job-form.tsx`) as a normal create flow — user reviews, edits anything wrong, and submits through the existing `POST /jobs`. No new job model, no new submit path — this only changes how the form gets populated.

This is deliberately the smallest version of "reduce data entry": it reuses two already-built services almost as-is, adds no new dependencies, and doesn't touch auth, storage, or the event pipeline.

## Key Assumptions to Validate
- [ ] LLM extraction is reliable enough on real postings (LinkedIn/Indeed public postings, Rozee, plain-text JDs) to save more time than it costs correcting mistakes — test against 10-15 real postings before considering it done.
- [ ] `WebFetchService` can reach a meaningful fraction of postings without hitting login walls — if most postings are gated, the URL path degrades to "always paste text," which is fine but changes the pitch.
- [ ] Groq extraction cost/latency stays acceptable for a synchronous (not queued) request — confirm p95 latency is tolerable for a form-prefill UX (target: well under the BullMQ async path used for company enrichment, since this should feel instant, not "check back later").

## MVP Scope
**In:**
- One new backend endpoint (e.g. `POST /jobs/parse`) accepting `{ url? , text? }`, returning best-effort extracted fields (never fails hard — falls back to empty/partial fields on extraction miss).
- Reuse `WebFetchService` as-is; add a new Groq tool schema for job-posting fields (title, company, location, type, source, salary) alongside the existing company-data tool in `llm.service.ts`.
- Frontend: a "Quick Add" entry point (paste box) that calls the new endpoint, then opens `JobForm` pre-filled and editable.
- Synchronous request/response — no queue, no new job status states.

**Out (see Not Doing):**
- Auto-save without user review.
- Any queued/background processing for this path.
- Browser extension or Gmail integration.

## Not Doing (and Why)
- **Browser extension capture** — solves a different pain (capture-at-source), adds a whole second codebase/maintenance surface. Revisit only if paste-URL fetch fails often enough to be annoying.
- **Gmail auto-log** — highest ceiling but disproportionate lift/risk (OAuth scope review, fragile per-ATS email parsing, inbox privacy handling) for a personal tool. Revisit only if Quick Add proves the extraction concept works well and manual paste itself becomes the bottleneck.
- **Bulk CSV import** — one-time migration value only, doesn't help ongoing entry. Cheap enough to reconsider independently later if there's an existing spreadsheet to migrate from.
- **Auto-creating the Job without user confirmation** — extraction will sometimes be wrong; always route through the existing `JobForm` review step rather than trusting the LLM blindly.

## Open Questions
- Should `JobSource` guess from URL domain (e.g. linkedin.com → `LINKEDIN`) rather than relying on the LLM to infer it?
- Where should "Quick Add" live in the UI — replace the existing "Add Job" button, or sit alongside it as an alternate entry path?
- Any budget/rate-limit ceiling on Groq calls to watch now that a second extraction path adds call volume?
