import Link from 'next/link';
import { Pencil, Trash2, Globe, GitMerge } from 'lucide-react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import {
  CityBadge,
  PriorityBadge,
  BusinessModeBadge,
  EnrichmentStatusBadge,
} from '../ui/badge';
import type { Company } from '../../types';

interface CompanyListProps {
  companies: Company[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onEdit: (company: Company) => void;
  onDelete: (company: Company) => void;
  onMerge: (company: Company) => void;
}

const COLUMNS = [
  'Name',
  'City',
  'Priority',
  'Business Mode',
  'Research',
  '',
];

export function CompanyList({
  companies,
  isLoading,
  isError,
  onRetry,
  onEdit,
  onDelete,
  onMerge,
}: CompanyListProps) {
  return (
    <div className="rounded-md border border-line bg-paper overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line bg-paper-raised">
          <tr>
            {COLUMNS.map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left font-mono text-[11px] font-medium text-muted uppercase tracking-wide"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody
          className="divide-y divide-line"
          aria-busy={isLoading}
        >
          {isLoading ? (
            <>
              <tr>
                <td colSpan={COLUMNS.length} className="sr-only" role="status">
                  Loading companies
                </td>
              </tr>
              {[...Array(5)].map((_, i) => (
                <tr key={i}>
                  {COLUMNS.map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))}
            </>
          ) : isError ? (
            <tr>
              <td colSpan={COLUMNS.length} className="py-16 text-center">
                <p className="text-base font-medium text-danger">
                  Failed to load companies
                </p>
                <p className="mt-1 text-sm text-muted-2">
                  Check your connection and try again.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={onRetry}
                >
                  Retry
                </Button>
              </td>
            </tr>
          ) : companies.length === 0 ? (
            <tr>
              <td
                colSpan={COLUMNS.length}
                className="py-16 text-center text-muted-2"
              >
                <p className="text-base font-medium">No target companies yet</p>
                <p className="mt-1 text-sm">
                  Add a company you&apos;d like to work for to get started.
                </p>
              </td>
            </tr>
          ) : (
            companies.map((company) => (
              <tr
                key={company.id}
                className="transition-colors hover:bg-paper-raised"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/companies/${company.id}`}
                    className="font-medium text-ink hover:text-accent"
                  >
                    {company.name}
                  </Link>
                  {company.businessMode === null &&
                    company.productDescription && (
                      <p className="mt-0.5 text-xs text-muted">
                        {company.productDescription}
                      </p>
                    )}
                </td>
                <td className="px-4 py-3">
                  <CityBadge city={company.city} />
                </td>
                <td className="px-4 py-3">
                  <PriorityBadge priority={company.priority} />
                </td>
                <td className="px-4 py-3">
                  {company.businessMode ? (
                    <BusinessModeBadge businessMode={company.businessMode} />
                  ) : (
                    <span className="text-muted-2">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <EnrichmentStatusBadge status={company.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 justify-end">
                    {company.websiteUrl && (
                      <a
                        href={company.websiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Visit ${company.name} website`}
                        className="rounded p-1.5 text-muted-2 hover:text-accent"
                      >
                        <Globe className="h-3.5 w-3.5" />
                      </a>
                    )}
                    <button
                      onClick={() => onMerge(company)}
                      aria-label={`Merge ${company.name} with another company`}
                      className="rounded p-1.5 text-muted-2 hover:text-accent"
                    >
                      <GitMerge className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => onEdit(company)}
                      aria-label={`Edit ${company.name}`}
                      className="rounded p-1.5 text-muted-2 hover:text-accent"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => onDelete(company)}
                      aria-label={`Delete ${company.name}`}
                      className="rounded p-1.5 text-muted-2 hover:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
