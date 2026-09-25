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
  whole backlog at once. The trial has its own 60s deadline
  (`GROQ_TRIAL_TIMEOUT_MS`); running past it counts as a failure. The SDK's
  45s timeout is cleared once response headers arrive, so on its own it
  doesn't bound a stalled body or a long 429 `retry-after` that the SDK
  sleeps through. Without the deadline, one such trial could keep every Groq
  call failing fast for minutes.

**Generations.** Every open starts a new generation, and each call records
the generation it was admitted in. A call admitted before the latest open
settles as stale and is ignored, whether it succeeds or fails. With 90s
calls, requests admitted while the circuit was still closed keep failing
after it opens. Before this rule, such a failure landing during the trial
reopened the circuit, restarted the cool-down and let a second trial run
alongside the first. The strict review reproduced that.

**Clock and hook.** The breaker times itself with `performance.now()`,
which is monotonic. A backward wall-clock step would otherwise hold the
circuit open for the size of the step. An `onStateChange` hook that throws
is swallowed, because a failing logger must not turn a good Groq call into
a counted failure.

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

**Callers skip paid work the open circuit would waste.** Groq is the last
step of both the enrichment run and Quick Add's URL fallback, and both spend
Tavily quota first:

- **Company enrichment.** While the circuit is open and still cooling down,
  the job is **deferred** with `job.moveToDelayed(now + retryAfterMs + 1s)`
  and `DelayedError`. It spends no search or fetch, keeps its attempts, and
  the row stays `PENDING`, shown as "Queued". Once the cool-down is over the
  job runs normally, and its extraction may be the trial.
- **Quick Add.** When the primary extraction hit the open circuit, or the
  circuit is open and cooling down, the Tavily search fallback is skipped
  and the answer is `parserUnavailable` right away.

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
  the page shows a row per breaker: closed, half-open, or open with the
  **clock time** of the trial call. The frontend turns `retryAfterMs` into
  an absolute time when the response arrives, because the query cache is
  shared with the sidebar badge and stays fresh for as long as the
  cool-down itself; a relative countdown read from it could be off by all
  of it. The frontend also defaults a missing `circuits` field to `[]`,
  since it deploys before the backend. The state is kept out of `/health`
  on purpose. A Groq outage must not turn the API's health check red,
  because CI's boot wait and container monitoring poll it.
- **Background jobs wait the outage out.** Enrichment jobs are deferred
  rather than failed, as described above. A timeline summary still fails
  fast during an outage; it is re-queued on the job's next change, and it
  spends no paid search.
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
