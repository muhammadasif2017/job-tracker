# ADR-012: Separate docker-compose.dev.yml for local infra only

## Status
Accepted

## Date
2026-07-07

## Context
`docker-compose.yml` builds and runs the full stack via Docker: Postgres,
Redis, backend, and frontend. But the documented local dev loop (CLAUDE.md)
runs backend and frontend directly on the host — `npm run start:dev` for
hot-reload NestJS, `npm run dev` for Next.js — not through Docker. That loop
still needs Postgres and Redis reachable at `localhost:5432` / `localhost:6379`
(matching `backend/.env`), without rebuilding backend/frontend images on every
run.

`docker-compose.prod.yml` is unrelated: it's the single-VM production stack
(Caddy + backend + Redis, Postgres hosted on Neon) and was explicitly out of
scope for this change.

## Decision
Add `docker-compose.dev.yml` at the repo root containing only `postgres` and
`redis` services, using the same image versions, credentials, and ports as
`docker-compose.yml`'s services. Usage: `docker compose -f
docker-compose.dev.yml up -d`, then run backend/frontend via their npm dev
scripts as usual. `docker-compose.yml` and `docker-compose.prod.yml` are
unchanged.

## Alternatives Considered

### Start only the relevant services from the existing docker-compose.yml
(`docker compose up postgres redis`)
- Pros: no new file, no duplication
- Cons: doesn't communicate intent as clearly — anyone reading
  `docker-compose.yml` would still assume it's meant to bring up the full
  stack by default; easy to accidentally trigger backend/frontend builds
- Rejected: a dedicated file makes "infra-only for local dev" explicit and
  discoverable

### Install Postgres/Redis natively on the host
- Pros: no Docker dependency for daily dev
- Cons: version drift from what's used in CI/prod, extra host setup burden,
  harder to reset to a clean DB state
- Rejected: Docker keeps versions pinned and matches existing tooling
  conventions already used by `docker-compose.yml`

## Consequences
- `postgres`/`redis` service definitions now exist in two compose files
  (`docker-compose.yml` and `docker-compose.dev.yml`) — if ports, image
  versions, or credentials change, both must be updated manually.
- No change to production deployment; `docker-compose.prod.yml` untouched.
