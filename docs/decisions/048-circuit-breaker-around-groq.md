# ADR-048: A circuit breaker around every Groq call

## Status

Accepted

## Date

2026-09-24

## Context

Every Groq call goes through the SDK with a 45s timeout and one retry
(`LlmService`), so one call can take up to about 90s before it fails. Two of
the callers make a user wait synchronously:

- Quick Add's `POST /v1/jobs/parse` (`extractJobPosting`).
- Saving an interview debrief, which generates the next round's prep
  (`generateRoundPrep`).

The other two run in BullMQ workers: company enrichment (`extract`) and
timeline summaries (`summarizeEvents`).

When Groq is down or hanging, every one of those calls pays the full wait
and then fails anyway. Every caller already treats a failed call as
best-effort. The parse endpoint answers `parserUnavailable`, round prep is
wrapped in a try/catch, and the workers retry and then give up. So the wait
buys nothing, and during an outage it ties up requests and workers for
minutes.

## Decision

A small hand-rolled `CircuitBreaker`
(`backend/src/infrastructure/resilience/circuit-breaker.ts`) wraps every
`chat.completions.create` in `LlmService`. There is one breaker per upstream,
shared by all four methods, because they all hit the same Groq endpoint.

- **Closed:** calls pass through. Three consecutive **outage** errors
  (`GROQ_FAILURE_THRESHOLD`) open the circuit.
- **Open:** calls throw `CircuitOpenError` at once, without touching Groq,
  for 30s (`GROQ_RESET_TIMEOUT_MS`).
- **Half-open:** the first call after the cool-down is a trial. Success
  closes the circuit; an outage error reopens it for another 30s. Other calls
  made during the trial fail fast, so a recovering Groq isn't hit by the
  whole backlog at once.

`isGroqOutage` decides what counts. An error with no HTTP status (a
connection failure or client-side timeout), a 429 or any 5xx counts. Any
other 4xx does not: Groq answered, and the request or the generation was at
fault. `tool_use_failed` is a 400, and a malformed generation says nothing
about Groq's health. An error that doesn't count resets the failure count,
just as a success does.

State transitions are logged: `llm_circuit_opened` at `warn`, and
`llm_circuit_state` for half-open and closed.

No new 503 mapping is needed. `CircuitOpenError` reaches the same catch
blocks a Groq failure already reached, so each caller degrades exactly as it
did before, only without the wait.

## Consequences

- **During a Groq outage, requests fail fast.** Measured on 2026-09-24
  against a stub that accepts connections and never answers, standing in
  for a hanging Groq:

  | `POST /v1/jobs/parse` | Time |
  |---|---|
  | calls 1–3, circuit closed | 90.5s each (45s SDK timeout, retried once) |
  | calls 4–5, circuit open | 0.05s, 0.01s, `parserUnavailable` |

  Without the breaker, the frontend's 60s timeout on this call fired first,
  so the user saw a timeout while the server kept working for another 30s.
- **The state is visible on the admin queues page.** `GET
  /v1/admin/queues` returns `circuits: [{ name, state, retryAfterMs }]`, and
  the page shows a row per breaker: closed, open with the time left until
  the trial call, or half-open. It is kept out of `/health` on purpose. A
  Groq outage must not turn the API's health check red, since CI's boot
  wait and container monitoring poll it.
- **Background jobs fail fast too.** An enrichment job that hits an open
  circuit fails, is retried by BullMQ after 10s, and most likely hits the
  circuit again, so the company ends up `FAILED`. That is where it would
  have ended during an outage anyway, just 90s sooner per attempt, and the
  Refresh button recovers it. A timeline summary is re-queued on the job's
  next change.
- **The state lives in one process.** The API runs as a single instance.
  With several, each instance would learn about an outage on its own, which
  costs at most three slow calls per instance, not a correctness problem.

## Alternatives rejected

- **`opossum`.** It is the standard Node breaker, but it is a new
  dependency. Its API would have needed wrapping for the outage classifier
  anyway, and the state machine is about 80 lines. A hand-rolled class is
  also easier to explain and to test with an injected clock.
- **A breaker around Tavily too.** Search only runs in background
  enrichment, already has a 10s timeout, and already degrades to empty
  results, so a breaker would save little.
- **A breaker per method.** All four methods hit the same upstream, so
  separate breakers would each need three failures to learn the same fact.
