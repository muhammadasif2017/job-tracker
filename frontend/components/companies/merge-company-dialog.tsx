'use client';

import { useState, useEffect } from 'react';
import { Modal } from '../ui/modal';
import { Button } from '../ui/button';
import api from '../../lib/api';
import { useMergeCompaniesMutation } from '../../features/companies/hooks';
import type { Company, PaginatedCompanies } from '../../types';

interface Props {
  open: boolean;
  onClose: () => void;
  // The company the "Merge" action was triggered from — kept as the
  // canonical (surviving) company. The user picks the duplicate to merge in.
  company: Company | undefined;
}

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function MergeCompanyDialog({ open, onClose, company }: Props) {
  const [search, setSearch] = useState('');
  const [duplicate, setDuplicate] = useState<Company | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [results, setResults] = useState<Company[]>([]);
  const [loading, setLoading] = useState(false);
  const debouncedSearch = useDebounce(search);

  useEffect(() => {
    if (!open) {
      setSearch('');
      setDuplicate(undefined);
      setConfirming(false);
      setResults([]);
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

  const merge = useMergeCompaniesMutation(() => {
    onClose();
  });

  if (!company) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Merge into ${company.name}`}
      description="Find the duplicate company to merge in. Its jobs and contacts move to this company, and the duplicate is deleted."
    >
      {!confirming ? (
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
                      onClick={() => {
                        setDuplicate(c);
                        setConfirming(true);
                      }}
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
      ) : (
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
              onClick={() => setConfirming(false)}
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
