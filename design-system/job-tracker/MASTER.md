# Job Tracker — Design System (MASTER)

Global source of truth for UI work in this repo. Page-specific overrides live in
`design-system/job-tracker/pages/<page>.md` and take precedence over this file.

**Status:** This document records the design system that is already shipped in
`frontend/app/globals.css` and `frontend/components/`. It was cross-checked against the
ui-ux-pro-max database, but the database's generated palette (blue/green), typography
(Plus Jakarta Sans) and landing-page "Funnel" pattern were rejected — the app already has a
distinct identity. What was kept from the database: the Flat Design style classification,
transition timings, anti-patterns, and the pre-delivery checklist.

**Stack:** Next.js 16 (app router) · React 19 · Tailwind CSS 4 (`@theme inline`, no
`tailwind.config`) · Radix primitives (dialog, dropdown-menu, select, tooltip) ·
lucide-react icons · recharts · TanStack Query · react-hook-form + Zod · sonner toasts.

---

## 1. Style

**Flat Design.** No gradients, no drop shadows. Depth comes from three surface levels and a
1px border, not from elevation. Bold, restrained color; typography and iconography carry the
hierarchy. Both light and dark modes are first-class — dark mode is class-based
(`@custom-variant dark (&:where(.dark, .dark *))`), not media-query-based, so every color
decision needs an explicit `dark:` counterpart or a semantic token that already flips.

---

## 2. Color tokens

Defined in `frontend/app/globals.css` on `:root` and `.dark`, exposed to Tailwind through
`@theme inline` as `--color-*`. **Always use these semantic names** (`bg-paper`, `text-ink`,
`border-line`, `bg-accent`) — never raw hex and never a raw Tailwind palette color when a
token exists.

| Token | Utility | Light | Dark | Role |
|---|---|---|---|---|
| `--surface` | `bg-surface` | `#f7f8fa` | `#0a0d11` | Page background |
| `--paper` | `bg-paper` | `#ffffff` | `#12171d` | Cards, panels, primary containers |
| `--paper-raised` | `bg-paper-raised` | `#f0f2f5` | `#171d24` | Hover / nested / secondary-button surface |
| `--line` | `border-line` | `#e2e5ea` | `#232b34` | All borders and dividers (global `*` default) |
| `--ink` | `text-ink` | `#10151b` | `#f2f4f6` | Primary text |
| `--muted` | `text-muted` | `#626d7a` | `#8b97a3` | Secondary text, labels |
| `--muted-2` | `text-muted-2` | `#96a1ac` | `#5a6570` | Tertiary text, placeholders |
| `--accent` | `bg-accent` / `text-accent` | `#b45e07` | `#ff9f45` | Primary action, brand |
| `--accent-fg` | `text-accent-fg` | `#ffffff` | `#100a04` | Foreground on accent fill |
| `--accent-soft` | `bg-accent-soft` | `#fdf1e3` | `rgba(255,159,69,.12)` | Accent tint background |
| `--accent-ink` | `text-accent-ink` | `#9c4f06` | `#ff9f45` | Accent-colored **text on an accent tint** (see §2.3) |
| `--accent-2` | `text-accent-2` | `#0c7a6e` | `#38d4c6` | Secondary accent (teal) |
| `--accent-2-soft` | `bg-accent-2-soft` | `#e5f6f3` | `rgba(56,212,198,.12)` | Secondary tint |
| `--danger` | `text-danger` | `#c73535` | `#ff5d5d` | Errors, destructive |
| `--danger-soft` | `bg-danger-soft` | `#fbeaea` | `rgba(255,93,93,.12)` | Error tint |
| `--warning` | `text-warning` | `#96590a` | `#f5b544` | Warnings, recoverable problems |
| `--warning-soft` | `bg-warning-soft` | `#fdf3e0` | `rgba(245,181,68,.12)` | Warning tint |
| `--success` | `text-success` | `#047857` | `#34d399` | Success outcomes (green, distinct from `--accent-2`) |
| `--success-soft` | `bg-success-soft` | `#ecfdf5` | `rgba(52,211,153,.12)` | Success tint |

`color-scheme: light dark` is set on `:root`, so native form controls and scrollbars follow
the mode.

### 2.1 Contrast audit (measured, WCAG 2.1 relative luminance)

Every ratio below is opaque-pair math against a nominal background. The dark-mode `*-soft`
tints are alpha (`rgba(…, .12)`) and composite over whatever sits behind them, so any
dark-mode row involving a tint is an approximation, not a measurement of the rendered pixel.

| Pair | Ratio | Verdict |
|---|---|---|
| `ink` on `paper` (light) | 18.34 | Pass AAA |
| `ink` on `paper` (dark) | 16.33 | Pass AAA |
| `muted` on `paper` (light) | 5.27 | Pass AA body |
| `muted` on `paper` (dark) | 6.05 | Pass AA body |
| `accent` on `paper` (dark) | 8.83 | Pass AAA |
| `accent-2` on `paper` (dark) | 9.78 | Pass AAA |
| `accent` / `accent-fg` (dark) | 9.65 | Pass AAA |
| `danger` on `paper` (dark) | 5.98 | Pass AA body |
| `accent` / `accent-fg` (light) | 4.62 | Pass AA body |
| `accent-2` on white (light) | 5.22 | Pass AA body |
| `accent-2` on `accent-2-soft` (light) | 4.67 | Pass AA body |
| `danger` on white (light) | 5.26 | Pass AA body |
| `danger` on `danger-soft` (light) | 4.53 | Pass AA body |
| `warning` on white (light) | 5.63 | Pass AA body |
| `warning` on `warning-soft` (light) | 5.11 | Pass AA body |
| `warning` on `paper` (dark) | 9.93 | Pass AAA |
| `ink` on `paper-raised` (light) | 16.35 | Pass AAA |
| `muted` on `paper-raised` (light) | 4.70 | Pass AA body |
| `accent-ink` on `accent-soft` (light) | 5.34 | Pass AA body |
| `accent-ink` on white (light) | 5.94 | Pass AA body |
| `success` on white (light) | 5.48 | Pass AA body |
| `success` on `success-soft` (light) | 5.21 | Pass AA body |
| `success` on `paper` (dark) | 9.37 | Pass AAA |
| `accent` on `surface` (light) | 4.35 | Just under 4.5 — emphasis and headings, not paragraphs |
| `accent` on `accent-soft` (light) | 4.15 | **Fails 4.5:1 body text** — use `text-accent-ink` on tints instead (§2.3) |
| `muted-2` on `paper` (light) | 2.63 | **Fails 3:1** — decorative and disabled states only, never meaningful text |
| `line` on `paper` (both) | 1.26 | Expected — border, not text; do not carry meaning by border color alone |

**Constraints that follow:**

- `bg-accent text-accent-fg` at body size (the `Button` `primary` variant uses `text-sm`)
  measures 4.62:1 in light mode — passes. This was 3.25:1 before `--accent` was darkened
  from `#d9740c` to `#b45e07`.
- `text-accent` on a **tinted** background (`bg-accent-soft`) is only 4.15:1, and no accent
  value fixes it — the ceiling for accent text is 4.62:1 on pure white. Use
  `text-accent-ink` there instead (5.34:1). See §2.3.
- `text-muted-2` is placeholder/disabled only. Anything a user must read uses `text-muted`
  or `text-ink`.
- Dark mode passes across the board and was not changed.

### 2.2 Remaining raw-palette usage

Warning and success states now use `--warning` / `--warning-soft` and `--success` /
`--success-soft`. Raw Tailwind palette colors survive in two places, both deliberate:

- **`frontend/types/index.ts`** — the categorical badge maps: `STATUS_COLORS`,
  `PRIORITY_COLORS`, `JOB_TYPE_COLORS`, `DISCOVERY_SOURCE_COLORS`,
  `APPLICATION_CHANNEL_COLORS`, `DERIVED_STATUS_COLORS`, `CITY_COLORS`,
  `BUSINESS_MODE_COLORS`. Thirteen distinct hues, more than any semantic token set should
  provide — the whole point is that these values are *not* semantic.
- **`badge.tsx`** — imports those maps and adds `ENRICHMENT_STATUS_COLORS`. That one map is
  semantic (queued / researching / done / failed) and could use `--warning` / `--success` /
  `--danger`, but it renders alongside the categorical badges and shares their visual
  language; converting it alone would split badge rendering across two color systems.

**Measured, so this is a decision and not an unknown:** every `bg-<hue>-100 text-<hue>-700`
pair in those maps passes AA in light mode (lowest 4.51, amber) and every
`dark:bg-<hue>-900/40 dark:text-<hue>-300` pair passes in dark (lowest 7.82, indigo, with
the alpha composited over `--paper`). There is no contrast reason to convert them, and
converting would mean ~52 token declarations that only restate Tailwind.

Audited across `bg-`, `text-`, `border-`, `ring-`, `from-`, `to-` prefixes and bare hex
literals over `frontend/**/*.{ts,tsx}` — note `.ts` as well as `.tsx`, which is where the
maps above and `STATUS_DOT_COLORS` live. That wider sweep surfaced the raw-hex chart and
error-boundary colors recorded in §11.7 and §11.8.

### 2.3 Accent text on accent tints

`--accent` is tuned as a **fill** color: white on it is 4.62:1, which passes. As a *text*
color on the accent tint it is only 4.15:1, and darkening `--accent` cannot fix that — its
own ceiling against pure white is 4.62:1, so the tinted case can never reach AA.

`--accent-ink` (`#9c4f06`) exists for exactly that case: accent-colored text sitting on
`bg-accent-soft`. It measures 5.34:1 on the tint and 5.94:1 on white. In dark mode it is the
same value as `--accent` (`#ff9f45`), which already clears AAA there.

Rule: `bg-accent` → `text-accent-fg`. `bg-accent-soft` → `text-accent-ink`. Plain
`text-accent` on an untinted surface stays for icons, emphasis and headings.

In dark mode `--accent-ink` is deliberately the same value as `--accent` (`#ff9f45`): the
dark tint is a 12% alpha wash over a near-black surface, so the ordinary accent already
measures ~8.4:1 on it. The duplication is intentional — a distinct dark value would only
break the light/dark pairing.

Sites using it: the sidebar active nav item and avatar initials, the profile avatar, the
admin role badge, and the matched-company banner in `job-form.tsx`.

`kanban-board.tsx` also uses `bg-accent-soft`, on the drag-over column, but nothing renders
text directly on that tint — the job cards inside it are opaque `bg-paper`. That is why it
is not in the list above.

## 3. Typography

Loaded via `next/font/google` in `frontend/app/layout.tsx`, exposed as CSS variables and
mapped in `@theme inline`.

| Role | Family | Variable | Utility |
|---|---|---|---|
| Display / headings | Space Grotesk | `--font-display` | `font-display` |
| Body / UI | Inter | `--font-body` | `font-sans` |
| Mono / data | IBM Plex Mono | `--font-mono` | `font-mono` |

`body` sets `font-feature-settings: 'ss01' 1`.

**Scale in practice** (from actual usage, most to least common): `text-sm` is the UI
default, `text-xs` for metadata and badges, `text-base` for emphasis, `text-2xl` for page
headings. Never go below `text-xs` (12px) for anything readable. Body line-height stays at
Tailwind's default 1.5 or looser.

Headings use `font-display` with `tracking-tight`; numeric and ID-like data uses
`font-mono` so columns align.

---

## 4. Spacing, radius, density

The app runs on **Tailwind's default spacing scale** — there is no custom `--space-*` table
and none should be introduced. Dominant values in the codebase: `gap-2` / `gap-3` inside
components, `gap-4` between them, `space-y-4` for stacked sections, `px-3` / `px-4` and
`py-2` / `py-3` for controls, `p-3` for compact cards, `p-5` / `p-6` for page-level panels.

Radius: `rounded-md` is the default for buttons, inputs, cards and modals; `rounded-sm` for
badges and small chips. Nothing is fully rounded except avatars and spinners.

Density target is **dense/dashboard** — this is a data-heavy internal tool, so prefer the
tighter end of that range (`gap-2`, `p-3`) for list and table rows, and reserve the roomier
values for page shells and empty states. This is a target, not a token set: express it with
Tailwind utilities.

---

## 5. Motion

- **No animation library.** GSAP and Framer Motion are not dependencies and must not be
  added for decorative motion (see `CLAUDE.md` — no new dependency without a bundle-size
  check). Use CSS transitions and Tailwind's `transition-*` utilities.
- Standard duration **150–200ms**, `ease-out` for entering, slightly faster for exiting.
  `transition-colors` is the workhorse (already on `Button`, `Input`, nav items).
- Motion must convey meaning — state change, spatial continuity, loading. Do not animate
  layout properties (`width`, `height`, `top`); animate `opacity` and `transform`.
- Every non-essential animation must be skipped under
  `@media (prefers-reduced-motion: reduce)`.
- Loading is communicated with `Skeleton` (placeholders that reserve space, so no layout
  shift) or `Spinner` / `Button loading` for in-place actions — never a bare frozen UI.

---

## 6. Component inventory

Primitives in `frontend/components/ui/` — reuse these before writing anything new:

| Component | Notes |
|---|---|
| `Button` | Variants `primary`, `secondary`, `ghost`, `danger`, `outline`; sizes `sm` (h-8), `md` (h-9), `lg` (h-10). Ships `focus-visible:ring-2 ring-offset-2 ring-offset-surface` and a `loading` spinner. |
| `Input` | Paired with a visible label; autofill is neutralized in `globals.css`. |
| `Badge` | Status/priority/type/source/channel/city/business-mode variants, all label+color mapped from `types/`. |
| `Modal` | Radix dialog wrapper. |
| `Skeleton` | Loading placeholder — reserve the real element's dimensions. |
| `Spinner` | In-place async indicator. |
| `FieldValue` | Label/value pair for detail views. |

Feature components live in `components/{auth,companies,dashboard,jobs,layout,profile}/`;
icons in `components/icons/`.

**Icons:** lucide-react only. Never emoji as an icon. Decorative icons get
`aria-hidden="true"`; an icon-only button needs an `aria-label`.

**Utility:** `.signal-trace` in `globals.css` draws a dashed horizontal rule from `--line`
— the one decorative flourish in the system.

---

## 7. Charts and data

recharts, on the dashboard. Rules:

- Never encode meaning by color alone — pair with a label, pattern or direct annotation.
- Every series needs a legend or direct label; every interactive chart needs a tooltip.
- Categorical series draw from the badge color families already in `types/` so a status
  means the same color in a chart as it does in a table row.
- Chart text respects the same minimums as body text (§2.1, §3).
- Reserve chart container height before data arrives — a chart that pops in shifts the page.
- Per `CLAUDE.md`, run `npm run build` after touching recharts props: the production
  type-check catches prop-type mismatches (e.g. `Tooltip formatter`) that `tsc --noEmit` misses.

---

## 8. Surfaces and patterns

- **Public surfaces:** only `(auth)/login`, `(auth)/register`, `(auth)/callback`. These are
  the only pages where marketing/conversion structure is even relevant, and they are
  currently simple centered forms — keep them that way. There is no landing page in this
  repo; do not import landing-page section patterns into the app.
- **Authenticated app:** `(dashboard)/` shell with the dashboard, `jobs`, `jobs/[id]`,
  `companies`, `companies/[id]`, `profile` and `admin/users`. These are dense data views:
  list/table + filters + detail panel. Filters stay visible, not hidden behind a menu.
- **Data fetching:** route pages call hooks from `features/<domain>/hooks.ts` and hold only
  local UI state. Every async view needs three designed states — loading (skeleton), empty
  (explains what to do next), and error — not just the happy path.
- **Forms:** react-hook-form + Zod, following `components/jobs/job-form.tsx`. Visible
  labels (never placeholder-as-label), errors inline next to the field, helper text where
  the requirement isn't obvious.
- **Toasts:** sonner, for confirmation of an action that leaves no other visible trace.
  Errors a user must act on belong in the page, not in a toast.

---

## 9. Anti-patterns

- Placeholder text used as the only label.
- Validation errors shown only in a summary at the top of a form.
- Filters or primary actions hidden behind a menu on a data-dense page.
- Removing focus rings, or an icon-only button with no accessible name.
- Emoji standing in for an icon.
- Raw hex or an ad-hoc Tailwind palette color where a semantic token exists.
- Hover as the only way to reach an action (breaks touch and keyboard).
- Instant, unanimated state changes (0ms) on interactive controls.
- One duration for every transition regardless of distance or importance.
- Animating `width` / `height` / layout position.
- Fixed pixel container widths, horizontal page scroll, or disabling zoom.
- Gray-on-gray text (`text-muted-2` for content).

---

## 10. Pre-delivery checklist

Run before calling any frontend change done:

- [ ] `npm run build` passes — not just `lint` / `tsc --noEmit` (`CLAUDE.md` requirement).
- [ ] Semantic tokens used throughout; no new raw hex.
- [ ] Light **and** dark mode both checked; contrast ≥ 4.5:1 for body text, ≥ 3:1 for
      large text and UI components (see §2.1 for the light-mode accent constraint).
- [ ] Keyboard reachable, tab order sane, focus ring visible on every control.
- [ ] Icon-only controls have `aria-label`; decorative icons have `aria-hidden`.
- [ ] Touch targets ≥ 44×44px effective, ≥ 8px apart (`size="sm"` at h-8 needs padding
      around it on touch surfaces).
- [ ] Loading, empty and error states all designed, not just the success path.
- [ ] No layout shift — skeletons and chart containers reserve their real dimensions.
- [ ] Transitions 150–200ms; `prefers-reduced-motion` respected.
- [ ] Responsive at 375 / 768 / 1024 / 1440px, no horizontal scroll.
- [ ] `cursor-pointer` on every clickable element.

---

## 11. Open items

All items raised by the initial audit are now resolved. Kept here as a record of what
changed and why.

1. ~~**Text on the accent tint** was 2.92:1, then 4.15:1 after the accent darkening — still
   short of 4.5:1 and unfixable by accent value.~~ **Fixed:** added `--accent-ink`
   (`#9c4f06`, 5.34:1 on the tint). Applied to the sidebar active nav item and avatar
   initials, the profile avatar, the admin role badge, and the matched-company banner in
   `job-form.tsx`. See §2.3.
2. ~~**`badge.tsx` `ENRICHMENT_STATUS_COLORS` and the categorical maps still use raw
   Tailwind palette colors** (§2.2).~~ **Closed, verified no defect:** all 13 hue pairs were
   measured — light `-100`/`-700` pairs bottom out at 4.51:1 (amber), dark `-900/40`/`-300`
   pairs at 7.82:1 (indigo). All pass AA. Converting them would add ~52 token declarations
   that only restate Tailwind, for no accessibility gain. The maps live in
   `frontend/types/index.ts`, not `badge.tsx` — the doc previously named the wrong file.
3. ~~**No `--success` token** — `--accent-2` claimed the success role but the emerald in use
   was a different green.~~ **Fixed:** added `--success` / `--success-soft` (`#047857` /
   `#ecfdf5`, dark `#34d399` / `rgba(52,211,153,.12)`), matching the green already in use
   rather than folding success into teal. This also fixed a contrast failure — the previous
   `text-emerald-600` was 3.77:1 on white; `--success` is 5.48:1. `--accent-2` is now
   documented as a plain secondary accent.
4. ~~**`--paper-raised` was `#ffffff` in light mode — the same value as `--paper`**, so
   `hover:bg-paper-raised` on `Button` `secondary` and `ghost` produced no visible hover
   feedback in light mode.~~ **Fixed:** light `--paper-raised` is now `#f0f2f5`
   (1.12:1 against `--paper`, enough to read as a raised surface without becoming a second
   border; `ink` 16.35:1 and `muted` 4.70:1 both still pass on it).
5. ~~**Light-mode `--accent`, `--accent-2` and `--danger` failed AA for body text**
   (3.25 / 4.25 / 4.38).~~ **Fixed:** darkened to `#b45e07` / `#0c7a6e` / `#c73535`
   (4.62 / 5.22 / 5.26). Dark mode already passed and was not touched.
6. ~~**No `--warning` token** — warning states used raw `amber-*`.~~ **Fixed:** added
   `--warning` / `--warning-soft` and applied them in `duplicate-suggestions-banner.tsx`,
   `csv-import-dialog.tsx` and `company-profile-card.tsx`.

7. **Charts hardcode dark-mode token values.** `trend-chart.tsx` uses `fill="#38d4c6"` and
   `stroke="#ff9f45"`; `funnel-chart.tsx` uses `color: '#ff9f45'`. Those are the *dark*
   values of `--accent-2` and `--accent`, rendered unchanged in light mode where the tokens
   are `#0c7a6e` and `#b45e07`. Against light `--paper` they measure 1.84:1 and 2.04:1,
   under the 3:1 bar for a non-text UI component such as a 2px line or a bar fill. The
   correct light values measure 5.22:1 and 4.62:1. `STATUS_DOT_COLORS` (also
   `frontend/types/index.ts`, raw hex) has the same problem — on light `--paper`:
   WISHLIST `#94a3b8` 2.56, APPLIED `#38d4c6` 1.84, INTERVIEWING `#ff9f45` 2.04,
   OFFER `#22c55e` 2.28 all fail 3:1; REJECTED 3.76 and GHOSTED 4.83 pass. It feeds the
   kanban status dot, the card left border, and three chart series.
   Fix needs a decision: six `--status-*` tokens consumed as `var(--color-…)`, or migrating
   the recharts props to CSS variables. Recharts and SVG presentation attributes do not
   always resolve `var()` as expected, and `STATUS_DOT_COLORS` also feeds inline `style` in
   three components, so this needs testing rather than a blind swap. Not applied.
8. **`global-error.tsx` hardcodes an inaccessible button.** White text on `#ff9f45` is
   2.04:1 at `0.875rem`, and its muted paragraph `#8b97a3` on white is 2.98:1. The file
   deliberately uses inline styles — it replaces the root layout when the app crashes, so
   Tailwind classes are not available — but the values should at least be the light-mode
   ones. Not applied.

**Known, unrelated:** `company-profile-card.tsx`'s `tone === 'red'` branch is dead code —
both `FAILURE_COPY` entries are `tone: 'amber'`, so the `danger` arm of those three
ternaries never executes. Pre-existing; left in place.
