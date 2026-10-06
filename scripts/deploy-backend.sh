#!/usr/bin/env bash
# Zero-downtime deploy of the production stack (ADR-057). Run on the VM from
# the repo checkout, after `git pull`, by deploy.yml.
#
# `compose up -d` replaces the backend by stopping the old container before
# the new one has booted, which took the API down for the ~80s that
# `prisma migrate deploy` and Nest's startup need. Instead this starts the new
# backend next to the old one, waits until its /health answers, then stops the
# old one. Caddy resolves `backend` to every running container
# (caddy/Caddyfile), so traffic moves across without a gap, and the old
# container finishes its in-flight requests on SIGTERM before it exits.
#
# COMPOSE overrides the compose command, for a local test run.
set -euo pipefail

compose=${COMPOSE:-docker compose -f docker-compose.prod.yml --env-file .env}
health_timeout=${HEALTH_TIMEOUT:-180}

$compose pull

# Everything but the backend updates in place. --no-deps keeps Caddy's
# depends_on from recreating the backend here.
$compose up -d --no-deps redis alloy caddy
# Caddy reads its config only at startup, and `up -d` leaves the container
# alone when only the mounted Caddyfile changed. When `up -d` did recreate
# Caddy (a new image), its admin API may not be listening yet, so retry.
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if $compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile; then break; fi
  if [ "$attempt" -eq 10 ]; then echo "deploy: caddy reload failed" >&2; exit 1; fi
  sleep 1
done
# Same for Alloy's config; its write-ahead log keeps unsent samples (ADR-052).
$compose restart alloy

old=$($compose ps -q backend)
if [ -z "$old" ]; then
  # Nothing is serving yet, so there is nothing to keep up.
  $compose up -d --no-deps backend
  docker image prune -f
  exit 0
fi

# A second container from the freshly pulled image, beside the old one.
$compose up -d --no-deps --no-recreate --scale backend=2 backend
new=$($compose ps -q backend | grep -vxF "$old" || true)
if [ -z "$new" ]; then
  echo "deploy: no new backend container was started" >&2
  exit 1
fi

# The probe runs inside the container, so it reaches this backend and not
# whichever one Caddy would pick. /health checks Postgres and Redis too.
probe='fetch("http://localhost:3001/health", { signal: AbortSignal.timeout(5000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))'
deadline=$((SECONDS + health_timeout))
until docker exec "$new" node -e "$probe" >/dev/null 2>&1; do
  if [ "$SECONDS" -ge "$deadline" ] || [ "$(docker inspect -f '{{.State.Running}}' "$new")" != true ]; then
    echo "deploy: new backend not healthy after ${health_timeout}s; keeping the old one" >&2
    docker logs --tail 50 "$new" >&2 || true
    docker rm -f "$new" >/dev/null
    exit 1
  fi
  sleep 2
done

# SIGTERM: the backend stops accepting connections, finishes in-flight
# requests, then closes its clients (graceful-shutdown.helper.ts). Caddy
# retries anything refused meanwhile on the new container. `docker stop` uses
# the stop_grace_period from docker-compose.prod.yml.
for id in $old; do
  docker stop "$id" >/dev/null
  docker rm "$id" >/dev/null
done
docker image prune -f
