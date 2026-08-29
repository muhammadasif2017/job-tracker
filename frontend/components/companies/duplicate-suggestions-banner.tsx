'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { useDuplicateSuggestionsQuery } from '../../features/companies/hooks';
import type { Company, DuplicateSuggestion } from '../../types';

interface Props {
  // Opens MergeCompanyDialog with `canonical` as the surviving company and
  // `duplicate` pre-seeded, skipping the dialog's search step.
  onReview: (canonical: Company, duplicate: Company) => void;
}

// Phase 5c (docs/specs/company-fk-phase5c.md) — dismissal is session-only
// (component state, no persistence): a dismissed pair reappears on next
// page load/refresh if still unmerged, by design (see spec).
export function DuplicateSuggestionsBanner({ onReview }: Props) {
  const { data: suggestions } = useDuplicateSuggestionsQuery();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const pairKey = (s: DuplicateSuggestion) =>
    [s.companyA.id, s.companyB.id].sort().join(':');

  const visible = (suggestions ?? []).filter((s) => !dismissed.has(pairKey(s)));

  if (visible.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Duplicate company suggestions"
      className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40"
    >
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
        Possible duplicate {visible.length === 1 ? 'company' : 'companies'}
      </p>
      <ul className="space-y-1.5">
        {visible.map((s) => {
          const key = pairKey(s);
          return (
            <li
              key={key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-paper/70 px-3 py-2 text-sm"
            >
              <span>
                <strong>{s.companyA.name}</strong> and{' '}
                <strong>{s.companyB.name}</strong>
                <span className="ml-1.5 text-xs text-muted">
                  ({s.reason === 'website' ? 'same website' : 'similar name'})
                </span>
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onReview(s.companyA, s.companyB)}
                >
                  Review
                </Button>
                <button
                  aria-label={`Dismiss suggestion: ${s.companyA.name} and ${s.companyB.name}`}
                  className="rounded p-1 text-muted-2 hover:bg-paper-raised hover:text-muted"
                  onClick={() =>
                    setDismissed((prev) => new Set(prev).add(key))
                  }
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
