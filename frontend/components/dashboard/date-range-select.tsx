'use client';

import { cn } from '../../lib/utils';
import { DASHBOARD_RANGES, type DashboardRange } from '../../types';

export function DateRangeSelect({
  value,
  onChange,
}: {
  value: DashboardRange;
  onChange: (range: DashboardRange) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-line bg-paper p-0.5">
      {DASHBOARD_RANGES.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-[5px] px-3 py-1 font-mono text-xs font-medium uppercase tracking-wide transition-colors',
            value === option.value
              ? 'bg-accent text-accent-fg'
              : 'text-muted hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
