'use client';

import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import api from '../../lib/api';
import {
  useMergeCompaniesMutation,
  type MergeFieldOverrides,
} from '../../features/companies/hooks';
import type { Company, PaginatedCompanies } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  // The company the "Merge" action was triggered from — kept as the
  // canonical (surviving) company. The user picks the duplicate to merge in.
  company: Company | undefined;
  // Phase 5c (docs/specs/company-fk-phase5c.md) — when set, the dialog skips
  // the search step and jumps straight to conflicts/confirm for this
  // pre-picked duplicate (auto-suggest "Review" action).
  preSeedDuplicate?: Company;
}

type Step = 'search' | 'conflicts' | 'confirm';

// Phase 5b (docs/specs/company-fk-phase5b.md) — only the AI-enrichment field
// set is pickable; user-curated identity fields (websiteUrl, personalNotes,
// businessMode, etc.) stay canonical-wins unconditionally, no picker for them.
const CONFLICT_FIELDS: {
  key: keyof MergeFieldOverrides;
  confidenceKey?: keyof MergeFieldOverrides;
  label: string;
}[] = [
  { key: 'industry', label: 'Industry' },
  { key: 'companySize', label: 'Company Size' },
  { key: 'techStack', label: 'Tech Stack' },
  { key: 'cultureSummary', label: 'Culture' },
  { key: 'workPolicy', label: 'Work Policy' },
  { key: 'workLifeBalance', label: 'Work-Life Balance' },
  {
    key: 'headquarters',
    confidenceKey: 'headquartersLowConfidence',
    label: 'Headquarters',
  },
  { key: 'address', confidenceKey: 'addressLowConfidence', label: 'Address' },
  { key: 'founded', label: 'Founded' },
];

function normalize(value: unknown): string {
  if (value == null) return '';
  if (Array.isArray(value)) return [...new Set(value)].sort().join(', ');
  return String(value);
}

function formatValue(value: unknown): string {
  const n = normalize(value);
  return n === '' ? '(empty)' : n;
}

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function MergeCompanyDialog({
  open,
  onClose,
  company,
  preSeedDuplicate,
}: Props) {
  const [step, setStep] = useState<Step>('search');
  const [search, setSearch] = useState('');
  const [duplicate, setDuplicate] = useState<Company | undefined>();
  const [results, setResults] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  // Field key -> 'canonical' | 'duplicate'. Absent key defaults to
  // 'canonical' — matches the spec's "canonical wins unless overridden"
  // boundary exactly, no field is force-decided.
  const [picks, setPicks] = useState<Record<string, 'canonical' | 'duplicate'>>(
    {},
  );
  const debouncedSearch = useDebounce(search);

  useEffect(() => {
    if (!open) {
      setStep('search');
      setSearch('');
      setDuplicate(undefined);
      setResults([]);
      setPicks({});
    }
  }, [open]);

  useEffect(() => {
    if (!open || !debouncedSearch.trim() || !company) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .get<PaginatedCompanies>('/companies', {
        params: { search: debouncedSearch, limit: 10 },
      })
      .then((r) => {
        if (!cancelled) {
          setResults(r.data.data.filter((c) => c.id !== company.id));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, open, company]);

  const conflicts = useMemo(() => {
    if (!company || !duplicate) return [];
    return CONFLICT_FIELDS.filter(
      (f) => normalize(company[f.key]) !== normalize(duplicate[f.key]),
    );
  }, [company, duplicate]);

  const merge = useMergeCompaniesMutation(() => {
    onClose();
  });

  const selectDuplicate = (c: Company) => {
    if (!company) return;
    setDuplicate(c);
    const nextConflicts = CONFLICT_FIELDS.filter(
      (f) => normalize(company[f.key]) !== normalize(c[f.key]),
    );
    setStep(nextConflicts.length > 0 ? 'conflicts' : 'confirm');
  };

  useEffect(() => {
    if (open && preSeedDuplicate) {
      selectDuplicate(preSeedDuplicate);
    }
    // Only re-run when the dialog opens or the pre-seed target changes —
    // selectDuplicate is recreated every render and isn't a stable dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preSeedDuplicate]);

  if (!company) return null;

  const buildFieldOverrides = (): MergeFieldOverrides => {
    if (!duplicate) return {};
    const overrides: Record<string, unknown> = {};
    for (const field of conflicts) {
      if (picks[field.key] !== 'duplicate') continue;
      overrides[field.key] = duplicate[field.key];
      if (field.confidenceKey) {
        overrides[field.confidenceKey] = duplicate[field.confidenceKey];
      }
    }
    return overrides as MergeFieldOverrides;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Merge into ${company.name}`}
      description={
        step === 'search'
          ? 'Find the duplicate company to merge in. Its jobs and contacts move to this company, and the duplicate is deleted.'
          : step === 'conflicts'
            ? 'These fields differ between the two companies. Pick which value to keep — unpicked fields keep this company\'s current value.'
            : undefined
      }
    >
      {step === 'search' && (
        <div className="space-y-3">
          <input
            aria-label="Search for a duplicate company"
            autoFocus
            className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
            placeholder="Search company name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800">
            {loading ? (
              <p className="p-3 text-sm text-slate-400">Searching…</p>
            ) : !debouncedSearch.trim() ? (
              <p className="p-3 text-sm text-slate-400">
                Type a company name to search.
              </p>
            ) : results.length === 0 ? (
              <p className="p-3 text-sm text-slate-400">No matches found.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {results.map((c) => (
                  <li key={c.id}>
                    <button
                      className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60"
                      onClick={() => selectDuplicate(c)}
                    >
                      {c.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {step === 'conflicts' && duplicate && (
        <div className="space-y-4">
          <div className="max-h-80 space-y-3 overflow-y-auto">
            {conflicts.map((field) => {
              const pick = picks[field.key] ?? 'canonical';
              return (
                <fieldset
                  key={field.key}
                  className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                >
                  <legend className="px-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                    {field.label}
                  </legend>
                  <div className="space-y-1.5">
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        className="mt-0.5"
                        name={`conflict-${field.key}`}
                        aria-label={`${company.name}: ${formatValue(company[field.key])}`}
                        checked={pick === 'canonical'}
                        onChange={() =>
                          setPicks((p) => ({ ...p, [field.key]: 'canonical' }))
                        }
                      />
                      <span>
                        <span className="text-slate-400">{company.name}: </span>
                        {formatValue(company[field.key])}
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="radio"
                        className="mt-0.5"
                        name={`conflict-${field.key}`}
                        aria-label={`${duplicate.name}: ${formatValue(duplicate[field.key])}`}
                        checked={pick === 'duplicate'}
                        onChange={() =>
                          setPicks((p) => ({ ...p, [field.key]: 'duplicate' }))
                        }
                      />
                      <span>
                        <span className="text-slate-400">{duplicate.name}: </span>
                        {formatValue(duplicate[field.key])}
                      </span>
                    </label>
                  </div>
                </fieldset>
              );
            })}
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setStep('search')}>
              Back
            </Button>
            <Button onClick={() => setStep('confirm')}>Continue</Button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            <strong>{duplicate?.name}</strong> will be merged into{' '}
            <strong>{company.name}</strong>. All of its jobs and contacts move
            to {company.name}, and {duplicate?.name} is permanently deleted.
            This cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => setStep(conflicts.length > 0 ? 'conflicts' : 'search')}
              disabled={merge.isPending}
            >
              Back
            </Button>
            <Button
              variant="danger"
              loading={merge.isPending}
              onClick={() =>
                duplicate &&
                merge.mutate({
                  canonicalId: company.id,
                  duplicateId: duplicate.id,
                  fieldOverrides: buildFieldOverrides(),
                })
              }
            >
              Merge companies
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
