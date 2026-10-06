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
  `dynamic a backend 3001` with a one-second refresh, so it sends traffic to every container
  Docker's DNS lists for `backend`. A request whose connection is refused is
  retried on another upstream for up to 30 seconds (`lb_try_duration`). The
  script reloads Caddy, which reads the Caddyfile only at startup.
- **The old container shuts down gracefully.** The image's command ends in
  `exec node dist/main`, so Node is the main process and receives SIGTERM.
  `main.ts` calls `enableShutdownHooks()`: Nest stops accepting connections,
  finishes in-flight requests and closes the BullMQ workers and Redis
  connections. `stop_grace_period` is 30 seconds.
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
- A local run of the script against a stand-in backend with a 15-second boot
  served 279 of 279 short requests and 14 of 14 five-second requests during
  the swap, and kept the old container when the new one never became healthy.
