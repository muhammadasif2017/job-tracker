# ADR-026: Disambiguate Playwright locators with exact text and accessible names

## Status
Accepted

## Date
2026-08-04

## Context

Two separate Playwright strict-mode violations landed in `frontend/e2e/interview-rounds.spec.ts`, both from locators that matched more than one element once the page had enough content:

1. `page.getByText('Phone Screen')` — substring match. Once a round's stage
   text ("Phone Screen") appeared alongside other elements containing the
   same substring (e.g. a status badge or a second round row created
   earlier in the same test), Playwright's strict mode threw instead of
   silently picking the first match. Fixed in `cd1c2e1` with
   `{ exact: true }`.
2. `roundRow.getByRole('button')` — role-only match inside an `<li>`. The
   row rendered two buttons (edit, delete); the locator resolved to
   whichever the DOM order made first, so the delete test occasionally
   clicked the wrong button and left a false-negative pass or a flaky
   failure. Fixed in `f0b4105` (#114) by adding `title="Remove round"` to
   the delete button and matching on
   `getByRole('button', { name: 'Remove round' })`.

Both bugs had the same shape: a locator that was unambiguous when the test
was first written became ambiguous as the component grew more rows/buttons
with overlapping text or role. Nightly e2e caught both, but only after
merge (see ADR-025) — expensive to bisect once other commits piled on top.

## Decision

For interactive elements with more than one instance of the same role on a
page (buttons, especially icon-only or repeated-row actions), give each a
distinct accessible name via `title` or `aria-label`, and match on that
name in tests: `getByRole('button', { name: '<accessible name>' })`.

For text assertions where the matched string could be a substring of other
visible text (status badges, repeated rows, labels that echo form input),
use `{ exact: true }` unless a partial match is the actual intent.

This is now the default locator style for new/edited e2e specs in
`frontend/e2e/`, not just a one-off fix — scoped locators
(`roundRow.getByRole(...)`) narrow the search space but don't replace
exact/named matching once more than one match is possible within that
scope.

## Alternatives Considered

### `.first()` / `.nth(n)` on the ambiguous locator
Rejected: silences the strict-mode error without fixing the underlying
ambiguity. The test keeps passing even if a future change reorders rows or
adds a third button, and it can lock in "click the wrong element" as
correct behavior instead of surfacing it.

### `data-testid` attributes instead of accessible names
Rejected for this case: `title`/`aria-label` doubles as a real
accessibility improvement (icon-only delete button had no accessible name
before `f0b4105`), whereas a `data-testid` is test-only markup with no
production value. Falls back to `data-testid` only where no reasonable
accessible name exists.

### Leave `getByText` as substring match, scope more tightly instead
Rejected as the general rule: tighter scoping (e.g. `roundRow.getByText(...)`)
reduces but doesn't eliminate collisions — a row can still contain the
matched substring in more than one place (stage name plus a status badge
that repeats it). `{ exact: true }` is the more direct fix on the assertion
itself, so it can be applied on top of the same or looser scoping.

## Consequences

- Icon-only or repeated-role buttons in future components need an explicit
  `title`/`aria-label` if they're covered by e2e — a small extra step when
  building the component, not just the test.
- e2e specs asserting on visible text default to `{ exact: true }`, so a
  copy change that turns one label into a substring of another gets a
  visible test failure instead of a silent strict-mode gamble.
- Doesn't retroactively audit existing specs for the same pattern — only
  the two instances hit in practice were fixed. Other loose `getByText`/
  `getByRole` locators elsewhere in `frontend/e2e/` may still be latent
  strict-mode violations waiting for the DOM to grow into them.
