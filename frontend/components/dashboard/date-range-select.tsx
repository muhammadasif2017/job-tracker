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
    <div className="inline-flex rounded-lg border bg-white p-0.5 dark:bg-slate-900">
      {DASHBOARD_RANGES.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-3 py-1 text-sm font-medium transition-colors',
            value === option.value
              ? 'bg-indigo-600 text-white'
              : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
