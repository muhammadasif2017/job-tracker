import { cn } from './utils';

/**
 * A responsive table's columns: header text, then the column's responsive
 * class (a grid area in the phone card, or a breakpoint that hides it).
 */
export type TableColumns = readonly (readonly [string, string])[];

/**
 * Builds a table's `cellClass`: base padding (dropped inside the phone card),
 * the column's responsive class, then any extras. The header, the skeleton
 * and the data rows all call it, so they cannot drift apart. Shared by the
 * jobs list (#471) and the admin user list (#475).
 */
export function makeCellClass<const C extends TableColumns>(columns: C) {
  const byHeader = new Map<string, string>(columns);
  return (column: C[number][0], extra?: string) =>
    cn('px-4 py-3 max-sm:p-0', byHeader.get(column), extra);
}

/**
 * Below sm a row becomes a card grid. Each table adds its own
 * `grid-cols-[…]` and `[grid-template-areas:…]` to this base.
 */
export const CARD_ROW =
  'max-sm:grid max-sm:gap-x-3 max-sm:gap-y-1 max-sm:px-4 max-sm:py-3';

/**
 * For the `tr` and `td` of a full-width row (empty or error state). The card
 * layout makes the tbody a block, and a lone table-row inside it shrinks to
 * its content and loses its centering.
 */
export const CARD_FULL_ROW = 'max-sm:block';

/**
 * For a loading skeleton inside a card cell. The card's `auto` tracks size to
 * content, and a skeleton bar has none, so without a floor it draws at zero
 * width.
 */
export const CARD_SKELETON = 'max-sm:min-w-12';
