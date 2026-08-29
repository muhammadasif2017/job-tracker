'use client';

import { useState, useEffect } from 'react';
import { Plus, Search, Upload } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Modal } from '../../../components/ui/modal';
import { CompanyList } from '../../../components/companies/company-list';
import { CompanyForm } from '../../../components/companies/company-form';
import { CsvImportDialog } from '../../../components/companies/csv-import-dialog';
import { MergeCompanyDialog } from '../../../components/companies/merge-company-dialog';
import { DuplicateSuggestionsBanner } from '../../../components/companies/duplicate-suggestions-banner';
import {
  COMPANY_CITIES,
  CITY_LABELS,
  JOB_PRIORITIES,
  PRIORITY_LABELS,
  type Company,
  type CompanyCity,
  type JobPriority,
} from '../../../types';
import {
  useCompaniesQuery,
  useDeleteCompanyMutation,
} from '../../../features/companies/hooks';

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function CompaniesPage() {
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState<CompanyCity | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<JobPriority | ''>('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editCompany, setEditCompany] = useState<Company | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<Company | undefined>();
  const [mergeTarget, setMergeTarget] = useState<Company | undefined>();
  const [preSeedDuplicate, setPreSeedDuplicate] = useState<Company | undefined>();

  const debouncedSearch = useDebounce(search);

  const { data, isLoading, isError, refetch } = useCompaniesQuery({
    page,
    search: debouncedSearch,
    city: cityFilter,
    priority: priorityFilter,
  });

  const deleteMutation = useDeleteCompanyMutation(() =>
    setDeleteTarget(undefined),
  );

  const openEdit = (company: Company) => {
    setEditCompany(company);
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
    setEditCompany(undefined);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Target Companies</h1>
          <p className="text-sm text-muted">
            {isError && !data
              ? 'Failed to load'
              : `${data?.meta.total ?? 0} companies saved`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Import CSV
          </Button>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" /> Add Company
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-2" />
          <input
            aria-label="Search companies"
            className="h-9 w-full rounded-md border border-line bg-paper pl-9 pr-3 text-sm text-ink placeholder:text-muted-2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            placeholder="Search company name…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          aria-label="Filter by city"
          className="h-9 rounded-md border border-line bg-paper px-3 text-sm text-ink"
          value={cityFilter}
          onChange={(e) => {
            setCityFilter(e.target.value as CompanyCity | '');
            setPage(1);
          }}
        >
          <option value="">All cities</option>
          {COMPANY_CITIES.map((c) => (
            <option key={c} value={c}>
              {CITY_LABELS[c]}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by priority"
          className="h-9 rounded-md border border-line bg-paper px-3 text-sm text-ink"
          value={priorityFilter}
          onChange={(e) => {
            setPriorityFilter(e.target.value as JobPriority | '');
            setPage(1);
          }}
        >
          <option value="">All priorities</option>
          {JOB_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </div>

      <DuplicateSuggestionsBanner
        onReview={(canonical, duplicate) => {
          setMergeTarget(canonical);
          setPreSeedDuplicate(duplicate);
        }}
      />

      <CompanyList
        companies={data?.data ?? []}
        isLoading={isLoading}
        isError={isError && !data}
        onRetry={() => refetch()}
        onEdit={openEdit}
        onDelete={setDeleteTarget}
        onMerge={setMergeTarget}
      />

      {data && data.meta.totalPages > 1 && (
        <div className="flex items-center justify-between px-1 text-sm text-muted">
          <span>
            Page {page} of {data.meta.totalPages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page === data.meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <CompanyForm open={formOpen} onClose={closeForm} company={editCompany} />
      <CsvImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <MergeCompanyDialog
        open={!!mergeTarget}
        onClose={() => {
          setMergeTarget(undefined);
          setPreSeedDuplicate(undefined);
        }}
        company={mergeTarget}
        preSeedDuplicate={preSeedDuplicate}
      />

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(undefined)}
        title="Delete company?"
        description={
          deleteTarget
            ? `Remove ${deleteTarget.name} from your target list? This cannot be undone.`
            : undefined
        }
      >
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(undefined)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={deleteMutation.isPending}
            onClick={() =>
              deleteTarget && deleteMutation.mutate(deleteTarget.id)
            }
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
