# ADR-057: Zero-downtime backend deploys

## Status

Accepted.

## Date

2026-10-06

## Context

The deploy ran `docker compose up -d`, which stops the old backend container
before starting the new one. The new container runs `prisma migrate deploy`
and then boots Nest, and on 2026-10-06 that left the API without a backend
for about 80 seconds: Caddy logged `connect: connection refused`, and the
jobs list showed "Failed to load jobs" to a user filtering at the time.

Two things also stood in the way of a clean handover. The image's command was
`sh -c "... && node dist/main"`, so `sh` was the container's main process and
`docker stop`'s SIGTERM never reached Node; Docker killed it after the grace
period, mid-request. And Nest did not listen for SIGTERM at all.

## Decision

- **`scripts/deploy-backend.sh` replaces the backend in a rolling swap.** It
  scales the `backend` service to two containers without recreating the old
  one, polls the new container's `/health` from inside it, and only then
  stops and removes the old one. If the new container does not become
  healthy within 180 seconds, the script removes it, prints its logs and
  fails the deploy, and the old container keeps serving. `deploy.yml` runs
  the script from the checkout it has just pulled.
- **Caddy follows the containers.** `reverse_proxy` uses
  `dynamic a backend 3001` with a one-second refresh, so it sends traffic to
  every container Docker's DNS lists for `backend`. A request whose
  connection is refused is retried on another upstream for up to 5 seconds
  (`lb_try_duration`); longer would also delay every 502 while the only
  backend is down. The Caddyfile lives in `caddy/`, mounted as a directory:
  `git pull` replaces the file, and a single-file bind mount would keep
  showing the old copy, so `caddy reload` would reload stale config. The
  script reloads Caddy, retrying while a freshly recreated Caddy starts.
- **The old container drains before it closes anything.**
  `registerGracefulShutdown` (`src/common/graceful-shutdown.helper.ts`)
  handles SIGTERM: it closes the HTTP server and waits up to 20 seconds for
  in-flight requests, then runs Nest's `app.close()`, then exits. Nest's
  `enableShutdownHooks()` is not used, because it disconnects Prisma and
  Redis before it closes the server, so requests still reaching the old
  container would fail against closed clients. The image's command ends in
  `exec node dist/main`, so Node is the main process and receives the signal
  at all. The explicit exit matters too: as PID 1, Node ignores the signal
  Nest re-raises, and the metrics listener keeps the process alive.
  `stop_grace_period` is 30 seconds.
- **No Docker healthcheck.** `/health` pings Postgres, and polling it all day
  would keep Neon's free-tier compute from suspending. The script probes only
  while a new container boots.

## Consequences

- **Every migration must work with the previous release's code.** The new
  container migrates the database while the old one still serves requests
  for up to a few minutes. Dropping or renaming a column the old code reads
  breaks it for that window. Make such a change in two releases: stop using
  the column, then drop it.
- For about a minute per deploy two backends run at once: roughly 120 MB more
  memory on the 1 GB VM, two sets of BullMQ workers (safe, since BullMQ hands
  each job to one worker) and two sets of cron schedules. A deploy in the
  same minute as a cron run could run that scan twice.
- **A broken release can serve some traffic before it is removed.** Caddy
  routes to the new container as soon as it listens, before the script's
  `/health` check passes. If a release boots but fails its health check,
  about half the requests reach it for up to 180 seconds, then the script
  removes it. Preventing that needs Caddy to probe `/health` continuously,
  which would keep Neon's compute awake; a short partial window followed by
  an automatic rollback is accepted instead of the full outage it replaces.
- A local run of the script against a stand-in backend with a 15-second boot
  served 279 of 279 short requests and 14 of 14 five-second requests during
  the swap, and kept the old container when the new one never became healthy.
