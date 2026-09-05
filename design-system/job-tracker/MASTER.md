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
| `--accent` | `bg-accent` / `text-accent` | `#d9740c` | `#ff9f45` | Primary action, brand |
| `--accent-fg` | `text-accent-fg` | `#ffffff` | `#100a04` | Foreground on accent fill |
| `--accent-soft` | `bg-accent-soft` | `#fdf1e3` | `rgba(255,159,69,.12)` | Accent tint background |
| `--accent-2` | `text-accent-2` | `#0f8a7c` | `#38d4c6` | Secondary / success |
| `--accent-2-soft` | `bg-accent-2-soft` | `#e5f6f3` | `rgba(56,212,198,.12)` | Secondary tint |
| `--danger` | `text-danger` | `#d64545` | `#ff5d5d` | Errors, destructive |
| `--danger-soft` | `bg-danger-soft` | `#fbeaea` | `rgba(255,93,93,.12)` | Error tint |

`color-scheme: light dark` is set on `:root`, so native form controls and scrollbars follow
the mode.

### 2.1 Contrast audit (measured, WCAG 2.1 relative luminance)

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
| `accent-2` on white (light) | 4.25 | **Fails 4.5:1 body text** — large/bold ≥18.66px or non-text only |
| `danger` on white (light) | 4.38 | **Fails 4.5:1 body text** — marginal |
| `accent` / `accent-fg` (light) | 3.25 | **Fails 4.5:1 body text** — passes 3:1 for UI components and large text |
| `accent` on `surface` (light) | 3.06 | **Fails 4.5:1 body text** — do not use for body copy in light mode |
| `muted-2` on `paper` (light) | 2.63 | **Fails 3:1** — decorative and disabled states only, never meaningful text |
| `line` on `paper` (both) | 1.26 | Expected — border, not text; do not carry meaning by border color alone |

**Constraints that follow:**

- `bg-accent text-accent-fg` at body size (the `Button` `primary` variant uses `text-sm`)
  measures 3.25:1 in light mode. It clears the 3:1 bar for non-text UI components but not
  the 4.5:1 bar for text. Do not build new body-size text on an accent fill in light mode
  without either darkening `--accent` (`#b45e07` reaches 4.62:1 against white; `#b85f08` is 4.49:1, still short) or
  using a dark foreground.
- `text-accent` on `surface`/`paper` in light mode is for emphasis, icons and large
  headings — not for paragraph text.
- `text-muted-2` is placeholder/disabled only. Anything a user must read uses `text-muted`
  or `text-ink`.
- Dark mode passes across the board. Every failure above is light-mode only.

These are recorded as known constraints, not applied changes — `--accent` is load-bearing
across the whole app and changing it is a product decision.

### 2.2 Known drift: no warning token

There is no `--warning` token, so warning states fall back to raw Tailwind palette values
(`text-amber-600 dark:text-amber-400`, `bg-amber-100 text-amber-700`). Until `--warning` /
`--warning-soft` exist, match that exact amber pairing rather than inventing a third
warning color.

Raw Tailwind palette colors appear in exactly four non-test files — `badge.tsx`,
`csv-import-dialog.tsx`, `duplicate-suggestions-banner.tsx`, `company-profile-card.tsx` —
using the `amber-*`, `red-*` and `emerald-*` families (audited across `bg-`, `text-`,
`border-`, `ring-`, `from-`, `to-` prefixes). Nowhere else in `frontend/**/*.tsx` bypasses
the semantic tokens.

`badge.tsx` uses raw Tailwind palette colors for its many categorical dimensions
(status, priority, job type, discovery source, channel, city, business mode). That is a
categorical-encoding decision, not drift — see §7.

---

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

1. **Light-mode accent contrast** (§2.1). `bg-accent` + body text is 3.25:1. Fix requires
   darkening `--accent` to about `#b45e07` (4.62:1) or using a dark foreground on the fill. Product
   decision — not applied.
2. **No `--warning` token** (§2.2). Warning states use raw `amber-*` across four files.
3. **`danger` and `accent-2` on white** sit just under 4.5:1 in light mode (4.38 / 4.25).
   Fine as icon/border/large-text colors, marginal for body copy.
4. ~~**`--paper-raised` was `#ffffff` in light mode — the same value as `--paper`**, so
   `hover:bg-paper-raised` on `Button` `secondary` and `ghost` produced no visible hover
   feedback in light mode.~~ **Fixed:** light `--paper-raised` is now `#f0f2f5`
   (1.12:1 against `--paper`, enough to read as a raised surface without becoming a second
   border; `ink` 16.35:1 and `muted` 4.70:1 both still pass on it).
