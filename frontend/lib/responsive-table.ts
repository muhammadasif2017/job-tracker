import { cn } from './utils';

/**
 * A responsive table's columns: header text, then the column's responsive
 * class (a grid area in the phone card, or a breakpoint that hides it).
 * Declare them `as const` so a cell's column name is checked against the
 * headers at compile time.
 */
export type TableColumns = readonly (readonly [string, string])[];

/**
 * Builds a table's `cellClass`: base padding (dropped inside the phone card),
 * the column's responsive class, then any extras. The skeleton and the data
 * rows call it; the header adds the same column class to its own `th` styling,
 * so a breakpoint that hides a column hides its header too. Each column's
 * fixed part is merged once here, not per cell per render. An unknown column
 * throws rather than silently losing its grid area. Shared by the jobs list
 * (#471) and the admin user list (#475).
 */
export function makeCellClass<const C extends TableColumns>(columns: C) {
  const byHeader = new Map(
    columns.map(([h, colClass]) => [h, cn('px-4 py-3 max-sm:p-0', colClass)]),
  );
  return (column: C[number][0], extra?: string) => {
    const base = byHeader.get(column);
    if (base === undefined) throw new Error(`Unknown column "${column}"`);
    return extra ? cn(base, extra) : base;
  };
}

/**
 * Below sm the table, its head and its body stop being table boxes so each
 * row can become a card. Keep explicit `role` attributes on the table, row
 * groups, rows and cells: display:block drops the table semantics in Chrome
 * and Safari.
 */
export const CARD_TABLE = 'max-sm:block';

/** The header row has no place in a card layout. */
export const CARD_HEAD = 'max-sm:hidden';

/** See `CARD_TABLE`. */
export const CARD_BODY = 'max-sm:block';

/**
 * Below sm a row becomes a card grid. Each table adds its own
 * `grid-cols-[…]` and `[grid-template-areas:…]` to this base.
 */
export const CARD_ROW =
  'max-sm:grid max-sm:gap-x-3 max-sm:gap-y-1 max-sm:px-4 max-sm:py-3';

/**
 * For the `tr` of a full-width row (empty or error state); it reaches the
 * cells too. Inside the block tbody a lone table-row shrinks to its content
 * and loses its centering.
 */
export const CARD_FULL_ROW = 'max-sm:block max-sm:*:block';

/**
 * For a loading skeleton inside a card cell. The card's `auto` tracks size to
 * content, and a skeleton bar has none, so without a floor it draws at zero
 * width.
 */
export const CARD_SKELETON = 'max-sm:min-w-12';
