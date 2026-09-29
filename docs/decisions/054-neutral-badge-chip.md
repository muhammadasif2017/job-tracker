# ADR-054: One neutral chip for every badge, color only as a status dot

## Status

Accepted

## Date

2026-09-28

## Context

Every badge in `frontend/components/ui/badge.tsx` (status, priority, job type,
discovery source, application channel, city, business mode, enrichment status)
used to draw its own tinted chip, from a `*_COLORS` map of raw Tailwind pairs
(`bg-<hue>-100 text-<hue>-700`, with `dark:` variants) in
`frontend/types/index.ts`. That came to thirteen hues. The design-system
reference (`design-system/job-tracker/MASTER.md` §2.2) recorded this as
deliberate: the pairs pass AA, and the values were meant to be categorical,
not semantic.

In use it did not read well. A job row or company card carries three to five
badges, so a row became a wall of unrelated tints. Most of those hues meant
nothing: nobody needs "LinkedIn" to be blue or "Karachi" to be teal. And the
status colors on badges did not match the status colors on the kanban board
and dashboard charts (`--status-*` tokens), so one status showed in two colors.

The change landed in two steps:

- **#462** drew the status badge (and interview round badges) as a neutral
  chip with a dot in the `--status-*` token color, so status matched the
  board and charts.
- **#473** extended that to every badge through one shared `Chip` component.

## Decision

Every badge renders through `Chip` in `badge.tsx`: neutral fill
(`bg-paper-raised`), ink label, `border-line/70`. Color appears only as an
optional leading dot, and only for enums whose value carries meaning:

| Badge | Dot |
|-------|-----|
| `StatusBadge` | `STATUS_COLORS`, the `--status-*` tokens the board and charts use |
| `PriorityBadge` | `PRIORITY_COLORS`: low `muted-2`, medium `warning`, high `danger` |
| `EnrichmentStatusBadge` | `ENRICHMENT_STATUS_COLORS`: pending `muted-2`, processing `warning`, completed `success`, failed `danger` |
| Job type, source, channel, city, business mode | None, label only |

The dot is `aria-hidden` and the label always carries the value, so the dot
is a scanning aid, never the only signal.

The `*_COLORS` maps for job type, discovery source, application channel,
city and business mode were deleted. The maps that remain hold token
background classes (`bg-status-*`, `bg-warning`, …), not raw palette pairs.

## Alternatives Considered

### Keep the thirteen categorical hues

- Pros: already measured AA in both themes; each value recognizable by color.
- Cons: noisy rows; color spent on values that mean nothing; status badges
  disagreed with the board and charts.
- Rejected: color should mark what needs attention. The contrast was never
  the problem.

### Stop at #462: dot on the status badge, tints on the rest

- Pros: smallest change; already shipped.
- Cons: two badge styles side by side (dotted neutral and tinted), and the
  tints still carried no meaning.
- Rejected: one chip with an optional dot covers both cases in one component.

## Consequences

- A new badge variant is `<Chip>` plus a `_LABELS` map. Add a `_COLORS` map
  only if the value carries meaning, and fill it with token `bg-*` classes,
  never raw palette pairs.
- The test hook is `data-testid="badge-dot"` on every badge (was
  `status-dot` on the status badge only).
- Badges no longer have raw Tailwind palette colors, which closes most of
  MASTER.md §2.2.
- The dot is decorative, so its contrast is not held to the 3:1 non-text
  minimum. `bg-muted-2` (low priority, pending research) measures 2.63:1 on
  `paper`. That is acceptable only because the label says the same thing. Do
  not introduce a dot-only indicator without a label.
- Chip text stays uppercase mono. #472 moved field and section labels to
  sentence case but did not touch badges.
