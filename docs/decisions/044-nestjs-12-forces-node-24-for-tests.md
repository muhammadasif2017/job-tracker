# ADR-044: NestJS 12 raises the Node floor to 24 for the test runner

## Status

Accepted

## Date

2026-09-22

## Context

Dependabot opened four separate PRs bumping `@nestjs/*` from 11 to 12 (#402
`testing`, #404 `config`, #405 `jwt`, #406 `core`). All four failed `Backend
Tests` on the same `ERESOLVE`: `@nestjs/bullmq@11.0.5` peers
`@nestjs/core@^10.0.0||^11.0.0`, so no single-package bump can install. The
whole `@nestjs/*` set has to move in one commit.

Once the set moves, a second and larger problem appears. **NestJS 12 core
packages ship ESM-only.** This repo's backend compiles to CommonJS — there is
no `"type": "module"` in `backend/package.json`, and `nest build` emits CJS —
which is fine at runtime, because Node supports `require(esm)` from v22.12.
Jest is the problem: it has its own module registry and does not inherit
Node's interop. Every one of the 51 backend spec files imports
`@nestjs/testing` or `@nestjs/common`, and each one failed with:

```
Must use import to load ES Module: node_modules\@nestjs\testing\index.js
```

Two facts were established by running it, not by reading release notes:

- Node 24.21 **alone** still fails. Jest's `require(esm)` support is gated.
- `--experimental-vm-modules` **alone**, on Node 22.15, still fails.
- Both together pass: 51 suites, 674 tests.

## Decision

Take the Node bump. `@nestjs/*` all move to 12 (`@nestjs/throttler` to 6.7.0,
which already peers core 12), the Node floor goes to **24** across CI and the
backend images, and every `jest` invocation in `backend/package.json` becomes
`node --experimental-vm-modules ./node_modules/jest/bin/jest.js`.

The flag is spelled out in the script rather than set through `NODE_OPTIONS`,
so it works the same from PowerShell, bash and CI without adding `cross-env`
as a dependency.

## Alternatives rejected

**Migrate the backend to Vitest.** This is what NestJS 12 itself defaults to
for ESM projects, and it removes the experimental flag entirely. It also
rewrites the jest config and touches all 51 spec files' mocking
(`jest.fn` → `vi.fn`). That is a test-infrastructure project competing with a
dependency bump, and it buys nothing this quarter that the flag does not.
Worth revisiting the next time the test runtime moves for another reason.

**Run Jest in ESM mode on Node 22** (`extensionsToTreatAsEsm`, ts-jest ESM
preset). Keeps the Node floor, but ts-jest's ESM mode is historically brittle
around module mocking, which this suite leans on heavily. It also still needs
`--experimental-vm-modules`, so it trades a Node bump for a more fragile
transform.

**Stay on NestJS 11.** Viable — nothing in v12 is needed today. Rejected
because the gap only widens, and the ecosystem packages (`swagger`, `terminus`,
`passport`, `schedule`) have already published their 12.x lines, so staying
back means pinning those too.

## Consequences

- **Node 24 is the floor for running the test suite.** Node 22 can still run
  the built app — `require(esm)` works from 22.12 — but `npm test` fails on it.
  CI (`node-version: 24`) and `backend/Dockerfile*` (`node:24-slim`) both
  moved; a local checkout on Node 22 will fail tests with the error above.
- The frontend images were left on their own pins. Only the workflows' shared
  `node-version` moved, which the frontend jobs also use.
- `ExperimentalWarning: VM Modules` now prints once per Jest worker. It is
  noise, not a failure.
- Three v12 breaking changes were checked and do not apply here:
  `RedisHealthIndicator` already uses the `HealthIndicatorService` API that
  replaced the removed `HealthIndicator` base class; `@Optional()` is not used
  anywhere, so the dropped inheritance is moot; and `ConfigModule.forRoot`
  passes no `validationOptions`, so there is nothing to restructure under the
  new Standard Schema path. Joi 18 is accepted by it — confirmed by booting
  `dist/main`, which validates the environment at startup.
- `@nestjs/bullmq` v12 added an `exports` map. Two processor specs deep-imported
  `@nestjs/bullmq/dist/bull.constants.js` for `WORKER_METADATA`, which the
  package root does not re-export; both now declare the metadata key
  (`bullmq:worker_metadata`) as a local constant.
