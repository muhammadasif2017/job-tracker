import { describe, it, expect } from 'vitest';
import { makeCellClass } from './responsive-table';

const COLUMNS = [
  ['Name', 'max-sm:[grid-area:nm]'],
  ['Email', 'hidden md:table-cell'],
  ['', 'max-sm:[grid-area:act]'],
] as const;

describe('makeCellClass', () => {
  const cellClass = makeCellClass(COLUMNS);

  it('joins the base padding, the column class and any extras', () => {
    expect(cellClass('Name', 'font-medium')).toBe(
      'px-4 py-3 max-sm:p-0 max-sm:[grid-area:nm] font-medium',
    );
  });

  it('looks up the unnamed actions column like any other', () => {
    expect(cellClass('')).toBe('px-4 py-3 max-sm:p-0 max-sm:[grid-area:act]');
  });
});
