# ADR-052: Prometheus metrics, shipped to Grafana Cloud by Alloy

## Status

Accepted

## Date

2026-09-25

## Context

Logs (ADR-049) say what happened to one request, and Sentry (ADR-050, 051)
says what broke. Nothing yet showed how the service behaves over time: request
rates and latency, whether the queues are backing up, whether the Groq circuit
keeps opening, or whether memory is creeping up on a 1 GB VM. The admin
queues page shows some of this, but only when someone opens it, and it keeps
no history.

## Decision

The backend exposes Prometheus metrics (`prom-client`), and a Grafana Alloy
container on the VM scrapes them and pushes them to Grafana Cloud.

- **Own port, never public.** `startMetricsServer`
  (`infrastructure/metrics/metrics-server.helper.ts`) serves `GET /metrics`
  on `METRICS_PORT` with a plain `node:http` server, outside the Nest app. It
  therefore skips the API's guards, throttler, versioning and CORS, and Caddy,
  which proxies port 3001 only, never exposes it. Compose sets
  `METRICS_PORT: 9464` and does not publish it; only Alloy, on the same
  compose network, reaches it. Unset or empty means no listener, so local
  runs and the test suites open no extra port (the env schema allows `''`,
  as ADR-050 learned it must). An e2e test checks `/metrics` is a 404 on the
  API port.
- **A registry per app, not the global one.** `MetricsService` owns it. The
  e2e setup builds apps in one process, and registering a metric name twice
  on prom-client's global registry throws.
- **What is exported:**
  - Node's default process metrics: CPU, memory, heap, event-loop lag, GC.
    `main.ts` starts them only when `METRICS_PORT` is set, because they
    install monitors that nothing stops.
  - `http_request_duration_seconds`, a histogram by `method`, `route` and
    `status_class`. It is recorded by Express middleware placed right after
    the correlation-ID middleware, not by a Nest interceptor, because guards
    run before interceptors and an interceptor never sees the 401, 403 and
    429 responses they send.
  - `jobtracker_queue_jobs{queue,state}` and `jobtracker_queue_up{queue}`
    from `QueueMetricsService` (admin module). It and `AdminQueuesService`
    read counts through one helper, `readQueueCounts`, so the admin page and
    the gauges cannot disagree. Counts are read at scrape time, once per
    scrape for both gauges. A slow Redis cannot stall the scrape: the queues'
    connection already has a 2 s `commandTimeout` (ADR-046). A queue that
    fails or times out reports `up 0` and has its counts removed, not left
    at a stale value, and the rest of the scrape still succeeds. The
    Postgres company-status buckets are not exported: a `groupBy` over every
    company every 60 s is not worth it.
  - `jobtracker_circuit_state{circuit}`: 0 closed, 1 half-open, 2 open
    (ADR-048).
- **Bounded labels.** The free Grafana Cloud tier caps active series.
  - `route` is the matched template (`/v1/jobs/:id`), never the raw URL.
  - A request no controller handled is `unmatched`. That includes the
    `{/*splat}` route `nestjs-pino` mounts its middleware on, which Express
    leaves as `req.route`.
  - Status is its class (`4xx`), not the exact code.
  - The histogram has eight buckets, not prom-client's eleven.
  - `/v1/...` and the unversioned alias (ADR-047) keep separate labels, which
    shows how much traffic still uses the old paths.
  - A local run exported about 130 series. The worst case for the histogram,
    with every route hit on both paths with three status classes, is about
    68 × 2 × 3 × 11 ≈ 4,500 series, under the free tier's 10,000. In
    practice only the combinations that get traffic exist.
- **Alloy in compose, not the install script.** `alloy` in
  `docker-compose.prod.yml` runs the pinned image `grafana/alloy:v1.20.0`
  with the `alloy/` directory mounted read-only. It scrapes every 60 s and
  pushes to Grafana Cloud with a write-only token (`GRAFANA_CLOUD_TOKEN`,
  read with `sys.env`), which exists only in the VM's `.env`. The URL and
  username are not secrets and sit in the config. The service publishes no
  ports, keeps its write-ahead log in a volume, and is capped
  (`mem_limit: 160m`, `GOMEMLIMIT: 100MiB`) because the VM has 1 GB of RAM.
  The backend does not depend on it.
- **Config changes need a restart.** Alloy reads its config only at startup,
  and `docker compose up -d` leaves the container alone when only the config
  changed. So `deploy.yml` deploys on changes under `alloy/` and runs
  `docker compose restart alloy` on every deploy; the write-ahead log keeps
  unsent samples across it. The directory is mounted rather than the file
  because `git pull` replaces the file with a new one, and a single-file
  bind mount keeps showing the old one.

## Consequences

- Request rate, latency percentiles, error rate, queue depth, circuit state
  and process health are graphable over time in Grafana Cloud, and can be
  alerted on later.
- A metrics failure never takes the API down. A listener or render error is
  logged, and a missing target shows in Grafana as `up == 0`.
- One new production dependency, `prom-client` (two small dependencies). The
  production `npm audit` count is unchanged.
- A green deploy run only proves the containers started. Check
  `docker compose logs alloy` on the VM for push errors (401 means a token
  problem), then query `up{job="job-tracker-backend"}` in Grafana Explore.

## Alternatives rejected

- **`/metrics` on the API port.** It would inherit the global JWT guard and
  throttler and need a Caddy rule to keep it private. A separate port is
  private by construction.
- **A Nest interceptor for HTTP timing.** It misses every response a guard
  sends.
- **Host and Redis exporters.** Host metrics need `/proc` and `/sys` mounts
  and `pid: host`, and both add series. They are a follow-up once the series
  count in Grafana Cloud is known.
- **OpenTelemetry metrics.** More moving parts for the same result today.
  Traces may bring it in later, and prom-client metrics can be bridged.
