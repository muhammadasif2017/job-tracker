# Code Style

The conventions this repo actually follows, derived from the code rather than
from preference. Every rule below is one the codebase already keeps; each cites
the evidence so it can be re-checked instead of trusted.

**What this file is for:** writing new code that reads like the code already
here. Match it over personal preference, and over whatever a generic style guide
for NestJS or Next.js says.

**What this file is not:** it holds _style_ — naming, layout, shape, phrasing.
It does not hold _contracts_. Those live elsewhere and are not repeated here,
because a restated contract goes stale and nobody knows which copy wins:

| Looking for                                            | Read                     |
| ------------------------------------------------------ | ------------------------ |
| Quality floor, enforced numbers, exceptions            | `CONSTRAINTS.md`         |
| Boundaries, migrations, review expectations            | `CLAUDE.md` (root)       |
| Auth, jobs authorization, event logging, Prisma quirks | `backend/CLAUDE.md`      |
| Query keys, auth state, forms, e2e                     | `frontend/CLAUDE.md`     |
| Per-component props and cache behaviour                | `frontend/COMPONENTS.md` |
| Why a design is the way it is                          | `docs/decisions/` (ADRs) |

## Enforced vs. expected

Two different things, and it matters which one a rule is:

- **Enforced** — a tool rejects the code. Don't spend review on it; run the
  command. Prettier owns quotes, commas, spacing and line breaks
  (`.prettierrc`: `singleQuote: true`, `trailingComma: "all"`; `.editorconfig`:
  2-space indent, LF, final newline, trimmed trailing whitespace). ESLint owns
  the mechanical layer (`eslint.config.mjs` in both packages).
  `npm run check:floor` owns the floor in `CONSTRAINTS.md`.
- **Expected** — nothing checks it; it holds because every file does it and
  review keeps it that way. **Everything in this document is a review
  expectation unless it says otherwise.** That is the point of writing it down:
  the enforced rules already have a command.

One deliberate ESLint choice worth knowing before you "fix" a warning: the
`no-unsafe-*` family is `warn`, not `error`, in the backend, because it fires
almost entirely on untyped third-party boundaries (passport profiles,
`req.user`, Prisma error objects). A warning there is expected, not debt. Never
silence one with a TypeScript or ESLint suppression comment — `check:floor`
rejects every new suppression outright, and `CONSTRAINTS.md` lists which ones
it recognizes.

---

## Layout

### Backend — one directory per feature module

```
backend/src/
  common/                     cross-module: decorators/ dto/ filters/ guards/ validators/
  modules/<feature>/
    <feature>.module.ts
    <feature>.controller.ts
    <feature>.service.ts
    <feature>.service.spec.ts
    <feature>.constants.ts
    <concern>.helper.ts
    dto/
      create-<entity>.dto.ts
      update-<entity>.dto.ts
      <entity>-response.dto.ts
```

`modules/jobs/` is the full-size example; `modules/contacts/` is the small,
recent one. Copy the smaller one.

A module directory is flat — no `services/` or `utils/` subdirectory. `dto/` is
the only subdirectory, and it holds **one file per shape**, never a barrel.
There are no `index.ts` re-export barrels anywhere in `backend/src`.

A service grows out of one file by **extracting a named collaborator, not by
adding a folder**: when `jobs.service.ts` outgrew itself it became
`job-company-link.service.ts`, `job-ghosting.service.ts` and four `.helper.ts`
files beside it (#409–#412). The parent keeps thin delegating methods so the
controller's routes don't move.

### Frontend — routes, components, features, lib

```
frontend/
  app/(dashboard)/<route>/page.tsx    route pages, default export
  components/<feature>/<thing>.tsx    presentational + feature components
  components/ui/<thing>.tsx           generic primitives (button, modal, badge)
  features/<feature>/hooks.ts         TanStack Query hooks
  lib/                                api client, utils, download helpers
  store/                              Zustand stores
  types/index.ts                      hand-written shared types + label/color maps
```

Each `.tsx` sits next to its own `.test.tsx` — `job-form.tsx` /
`job-form.test.tsx`. No `__tests__/` directory.

A route page holds local UI state and calls hooks. It does not hold a
`queryFn`, an axios call, or a `mutationFn`; those live in
`features/<feature>/hooks.ts`. `app/(dashboard)/jobs/page.tsx` is the model.

`features/<feature>/hooks.ts` is the feature's own file. A **sub-entity inside a
feature** gets a prefixed sibling rather than a subdirectory:
`features/jobs/contacts.hooks.ts`, `interview-rounds.hooks.ts`,
`resume.hooks.ts`, `job-events.hooks.ts`. A bare `hooks.ts` plus prefixed
siblings is the pattern, not an inconsistency.

---

## File naming

**Every file is kebab-case**, including files whose default export is a
PascalCase React component (`kanban-board.tsx` exports `KanbanBoard`). No
exceptions in either package.

The suffix is a type declaration. Backend census: 57 `.dto`, 50 `.spec`, 25
`.service`, 17 `.module`, 11 `.controller`, 10 `.helper`, 6 `.constants`, 5
`.strategy`, 4 `.decorator`, 3 each `.validator` / `.processor` / `.guard`, 1
each `.scheduler` / `.filter`.

| Suffix           | Holds                                                                            |
| ---------------- | -------------------------------------------------------------------------------- |
| `.service.ts`    | An `@Injectable()` class. Business logic and every DB call.                      |
| `.controller.ts` | An `@Controller()` class. Routing, Swagger, nothing else.                        |
| `.dto.ts`        | One request or response shape, one class per file.                               |
| `.helper.ts`     | Free functions for one module's concern. **The default for new extracted code.** |
| `.constants.ts`  | Shared constant values and the query builders over them.                         |
| `.spec.ts`       | Backend unit test (Jest), beside its subject.                                    |
| `.test.ts(x)`    | Frontend unit test (Vitest), beside its subject.                                 |

There is no `.util.ts`. Two files carried that suffix historically —
`timezone.util.ts` and `interview-round-status.util.ts` — and neither
cross-module use nor purity distinguished them from a `.helper.ts`, so both
were renamed rather than leaving two words for one thing.

A helper file is named for the **concern**, not the module it came out of:
`job-update-rules.helper.ts`, `ghost-suggestions.helper.ts`,
`company-name-match.helper.ts`. Never `jobs-misc.helper.ts`.

---

## Naming

### Classes and types

PascalCase, and the suffix repeats the file's: `JobsService`,
`ContactsController`, `CreateContactDto`, `JobCompanyLinkService`. Interfaces
carry no `I` prefix — except the one storage-driver contract
(`IStorageService`), which is paired with an injection token.

A service name is a **noun phrase for what it owns**, not what it does:
`JobGhostingService`, `CompanyEnrichmentService`, `TimelineSummaryService`.

### Service methods — the CRUD five, then verbs

A resource service uses the NestJS resource names exactly, and nothing else
means the same thing: `create`, `findAll`, `findOne`, `update`, `remove`. Not
`getAll`, not `delete`, not `fetchOne`.

Everything beyond CRUD is a verb phrase naming the action:
`markGhosted`, `dismissGhostSuggestion`, `triggerEnrichment`,
`revokeToken`, `writeStatusChange`.

Private helpers on a service follow the same grammar, with an established
prefix vocabulary that tells you what the function does before you read it:

| Prefix                 | Means                                                       | Example                                             |
| ---------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| `build…`               | Returns a query clause or data object, touches nothing      | `buildJobWhere`, `buildUpdateData`                  |
| `resolve…`             | Turns input into an entity, may create one                  | `resolveCompanyId`                                  |
| `ensure…`              | Asserts a precondition or returns the row, throws otherwise | `ensureJobOwned`, `ensureNameAvailable`             |
| `assert…`              | Throws or returns void. Never returns a value               | `assertCompanyNotCleared`                           |
| `should…`              | Pure predicate, returns boolean                             | `shouldRestampAppliedAt`                            |
| `is…` / `has…`         | Pure predicate over a value                                 | `isTransactionWriteConflict`                        |
| `derive…` / `compute…` | Pure calculation from inputs                                | `deriveInterviewRoundStatus`, `computeTrendBuckets` |
| `enqueue…`             | Hands work to BullMQ, best-effort                           | `enqueueIfStale`, `enqueueLinkedCompany`            |
| `with…`                | Returns a copy of its argument, enriched                    | `withUpcomingInterview`                             |

A predicate helper that the caller then uses the value of should **return the
value, not a boolean** — `companyLabelToResolve` returns the trimmed label or
`null` precisely so the caller needs no non-null assertion.

### React hooks — the grammar is strict

Every one of the ~60 exported hooks fits one of two shapes:

- `use<Entity>Query` — `useJobsQuery`, `useCompanyQuery`, `useStatsQuery`
- `use<Verb><Entity>Mutation` — `useCreateJobMutation`, `useDeleteJobMutation`,
  `useExportJobsMutation`, `usePatchJobStatusMutation`

The `Query` / `Mutation` suffix is never dropped, and a plain `useJobs` does not
exist. Non-fetching hooks are the exception and read as plain English:
`useDebounce`, `useGhostSuggestedIds`.

### Components

PascalCase, named exports — **except route pages**, which are
`export default function <Route>Page()`. Props interfaces are named
`<Component>Props` and declared in the same file, immediately above the
component, each with a one-line doc comment.

### Constants

`SCREAMING_SNAKE_CASE`, module scope. Enum-adjacent display data comes in
matched pairs named after the enum: `STATUS_LABELS` / `STATUS_COLORS`,
`JOB_TYPE_LABELS` / `JOB_TYPE_COLORS`, `PRIORITY_LABELS` / `PRIORITY_COLORS`.
Add both halves or neither, in `frontend/types/index.ts`.

Backend thresholds are named constants in `.constants.ts` or the helper that
uses them, never inline numbers: `GHOST_AFTER_DAYS`, `MAX_GHOST_SUGGESTIONS`,
`PAT_EXPIRY_DAYS`.

---

## Imports

**Backend: always `.js` extensions on local imports**, even though the files are
`.ts` (ESM-style paths; `jest-e2e.json` maps them back). Never drop the
extension.

```ts
import { ContactsService } from "./contacts.service.js";
import { CurrentUser } from "../../common/decorators/current-user.decorator.js";
```

**Frontend: relative paths only.** There are **zero** `@/`-alias imports in the
whole frontend — `import { cn } from '../../lib/utils'`. Don't introduce the
alias for one file.

Ordering, in both packages: framework/external packages, then cross-cutting
local modules, then same-directory modules. Type-only imports are split out with
`import type { … }` or an inline `type` specifier rather than mixed into a value
import — `isolatedModules` is on, and Express types in decorated parameters
require it.

`'use client'` sits on line 1, above every import, in the 46 of 129 `.tsx` files
that need it. Server components are the default; add it only when the file uses
state, effects, or browser APIs.

---

## Comments

The convention is defined in `backend/CLAUDE.md` ("Doc Comment Convention") and
mirrored in `frontend/CLAUDE.md`. It is the single most distinctive thing about
this codebase, so the two rules that carry it, restated once:

- **Every exported declaration carries a `/** */` block**, including private
  service helpers. No `@param` / `@returns` — the signature already says the
  types.
- **Say why, not what.** The valuable sentence is the constraint a reader would
  otherwise violate: the race a CAS closes, the ADR behind a decision, the
  reason a field is written as `null` rather than omitted, the bug that the
  guard prevents from returning.

Two consequences visible throughout:

A doc comment is often **longer than the function**. That is correct here.
`companyLabelToResolve` is 6 lines of code under 20 lines of comment explaining
that JobForm resends every field, so "the client sent it" cannot mean "the user
changed it". Delete the code and you could rewrite it; delete the comment and
the next person reintroduces ADR-030's bug.

**Comments name their evidence** — an ADR (`ADR-022`), a migration
(`add_company_ci_unique`), a PR (`#314`), a spec file
(`docs/specs/target-companies.md`). A claim with a reference survives; one
without gets deleted as speculation.

Use `//` for reasoning **inside** a function body, `/** */` above a declaration.
Never both for the same fact — a doc comment repeated verbatim as an inline
comment is a defect, not emphasis.

---

## Types and nullability

**`T | null` vs `T | undefined` is semantic, not stylistic.** An optional field
on a PATCH/update DTO is typed `T | null` when the client must be able to
**clear** it, and the frontend sends an explicit `null`. `JSON.stringify` drops
`undefined` keys, and Prisma reads an omitted key as "leave the column alone",
so only an explicit `null` clears a column. Full rule and the bug behind it:
ADR-022 and the root `CLAUDE.md`.

A non-nullable column gets the opposite treatment — an explicit `null` is
rejected with a 400 rather than coerced, because there is no state to clear
into.

Prefer inferred return types on internal helpers, and
`ReturnType<typeof buildUpdateData>` over restating a shape that one function
already defines.

Inline structural types are used for narrow parameters rather than declaring an
interface for a two-field argument: `existing: { company: string; companyId:
string | null }`. Declare an interface once it is shared or named in a public
signature.

---

## Backend shapes

**Controllers are thin.** A handler is one line delegating to a service, with
its route, Swagger decorators and a one-line doc comment. No business logic, no
Prisma. The user comes from `@CurrentUser() user: { id: string }` and the parent
id from the route (`@Param`), never from the body.

Decorator order on a handler: `@Post()` / `@Get()` first, then `@ApiOperation`,
then the remaining `@Api*Response` decorators. The doc comment sits **above all
decorators**.

DTO field order: `@ApiProperty` / `@ApiPropertyOptional` first, then the
`class-validator` decorators, then the field. `@IsOptional()` comes first among
the validators.

**Services own the DB.** Every method touching a specific row scopes its query
by `userId` — see `backend/CLAUDE.md` ("Jobs: Authorization Pattern") for the
three shapes and why it is 404 and never 403.

**Errors are NestJS exceptions**, never bare `Error`: `NotFoundException`,
`BadRequestException`, `ConflictException`. A bare `Error` falls through to the
500 catch-all. Best-effort side effects (queue enqueues, storage deletes) are
wrapped in `try`/`catch` that logs a `warn` with structured fields and lets the
mutation stand — and the shared contract lives in one function so several call
sites cannot drift (`bestEffortEnqueueTimelineSummary`).

---

## Frontend shapes

**Forms: React Hook Form + Zod, schema inline** in the component file, passed to
`zodResolver`. One component handles both create and edit (`isEdit = !!job`);
`job-form.tsx` is the canonical example.

**Data fetching: hooks only.** A component never calls `api` directly. Shared
query-param construction lives in one exported function per feature
(`jobFilterParams`) so the list, the board and the export cannot drift on which
filters they honour. Invalidation sets that several mutations share are
extracted the same way (`invalidateJobListCaches`).

Query keys and the invalidation rules are contracts — `frontend/CLAUDE.md`,
"Data Fetching Conventions".

**Styling is Tailwind utilities composed with `cn()`** from `lib/utils`. No CSS
modules, no styled-components, no inline `style` objects. A variant is a lookup
map keyed by the enum (`STATUS_COLORS[status]`), not a chain of ternaries.

---

## Tests

**`it('…')` describes behaviour in the third person. Zero of 1176 test names in
this repo start with `should`** — that is a real count, and the most reliably
copied convention here.

```ts
it('throws NotFoundException when the job does not belong to the user', …)
it('maps Prisma P2002 (unique constraint) to 409 Conflict', …)
it('does not re-stamp an edit that left the status alone', …)
```

Backend unit tests: `describe('<Subject>')` at the top, nested
`describe('<behaviour group>')` for a distinct rule, a `const mockPrisma = {…}`
object at module scope, `jest.clearAllMocks()` in `beforeEach`, and the module
built with `Test.createTestingModule`. Collaborators that were extracted from
the subject are registered **real**, not mocked, so a refactor is proved
equivalent by the tests that already existed
(`jobs.service.spec.ts` registers `JobCompanyLinkService` and
`JobGhostingService` over the same `mockPrisma`).

Assert the **absence** of an effect too, not only its presence:
`expect(mockPrisma.contact.create).not.toHaveBeenCalled()`.

A test that pins a query clause rather than a row carries a comment saying so
and names where the row-level cases run instead (usually e2e). Say what a unit
test cannot prove rather than pretending it did.

Pure helpers get their own `.spec.ts` beside them, covering the guard cases the
comment explains. Frontend uses Vitest with the same phrasing rules; e2e is
Playwright in `frontend/e2e/`.

---

## Commits

Short, single-line, imperative, capitalized, no body unless the _why_ isn't
obvious from the diff. GitHub appends `(#PR)`. Never mention Claude, Claude
Code or Anthropic; no `Co-Authored-By` trailer.

```
Extract the case-insensitive company name match into one helper (#412)
Decompose JobsService.update into relink, restamp and status-change steps (#410)
Default dashboard stats range to all time (#407)
```

Leading verbs, by frequency over the last 200 commits: `Fix` (29), `Add` (16),
`Document` (13), `Remove` (6), `Update` (4), then `Use` / `Move` / `Split` /
`Extract` / `Scope`. Dependabot's `build(deps):` prefix is the bot's, not the
house style — don't copy it for hand-written commits.

Commits are atomic: one behaviour change, or one refactor, never both. The
#408–#412 series is the reference — five commits, each separately revertable.

A deliberate change to the quality bar carries a `Constraints-Change:` trailer
(`CONSTRAINTS.md`).

---

## Taking this to another project

Portable as written, for any TypeScript + NestJS + Next.js repo:

- The file-suffix vocabulary and flat module directory
- kebab-case files exporting PascalCase symbols
- The verb-prefix vocabulary (`build` / `resolve` / `ensure` / `assert` /
  `should` / `derive` / `with`) and the CRUD five
- `use<Entity>Query` / `use<Verb><Entity>Mutation`
- "Say why, not what", every export documented, comments citing their evidence
- Third-person `it()` with no `should`
- Extracting a collaborator instead of adding a folder
- Short imperative single-line commits

Project-specific, re-decide rather than copy:

- `.js` import extensions (this repo's ESM setup) and relative-only frontend
  imports (a repo with a configured alias should use it)
- `T | null` clearing semantics (that is a Prisma + JSON behaviour; the
  underlying rule — decide and document what "clear this field" looks like on
  the wire — transfers, the shape may not)
- The `userId`-scoping authorization pattern, which assumes single-tenant
  per-user ownership
- Every ADR number, module name and threshold quoted in the examples
