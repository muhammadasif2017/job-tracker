'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, Pencil, Trash2 } from 'lucide-react';
import { isAxiosError } from 'axios';
import { Button } from '../../../../components/ui/button';
import { Skeleton, LoadingStatus } from '../../../../components/ui/skeleton';
import {
  CityBadge,
  PriorityBadge,
  BusinessModeBadge,
} from '../../../../components/ui/badge';
import { CompanyProfileCard } from '../../../../components/company-profile-card';
import { CompanyForm } from '../../../../components/companies/company-form';
import { CompanyContacts } from '../../../../components/companies/company-contacts';
import { CompanyJobs } from '../../../../components/companies/company-jobs';
import { useCompanyQuery, useDeleteCompanyMutation } from '../../../../features/companies/hooks';

export default function CompanyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);

  const {
    data: company,
    isLoading,
    isError,
    error,
    refetch,
  } = useCompanyQuery(id);

  const isNotFound = isAxiosError(error) && error.response?.status === 404;

  const deleteMutation = useDeleteCompanyMutation(() =>
    router.replace('/companies'),
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/companies"
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Companies
      </Link>

      {isLoading ? (
        <LoadingStatus
          label="Loading company"
          className="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-900"
        >
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-5 w-32" />
        </LoadingStatus>
      ) : company ? (
        <>
          <div className="rounded-xl border bg-white p-6 dark:bg-slate-900 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-bold break-words">{company.name}</h1>
                <div className="mt-2 flex flex-wrap gap-2">
                  <CityBadge city={company.city} />
                  <PriorityBadge priority={company.priority} />
                  {company.businessMode && (
                    <BusinessModeBadge businessMode={company.businessMode} />
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  loading={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(id)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>

            {company.productDescription && (
              <p className="text-sm text-slate-600 dark:text-slate-400 break-words">
                {company.productDescription}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2 text-sm">
              {company.location && (
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
                    Office Location
                  </p>
                  <p className="break-words">{company.location}</p>
                </div>
              )}
              {company.websiteUrl && (
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
                    Website
                  </p>
                  <a
                    href={company.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                  >
                    Visit <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              {company.linkedinUrl && (
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
                    LinkedIn
                  </p>
                  <a
                    href={company.linkedinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                  >
                    Open <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>

            {company.personalNotes && (
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">
                  Your Notes
                </p>
                <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
                  {company.personalNotes}
                </p>
              </div>
            )}
          </div>

          <CompanyProfileCard
            profile={company}
            companyId={id}
            invalidateKey={['company', id]}
          />

          <CompanyJobs jobs={company.jobs ?? []} />

          <CompanyContacts companyId={id} contacts={company.contacts ?? []} />

          <CompanyForm
            open={editOpen}
            onClose={() => setEditOpen(false)}
            company={company}
          />
        </>
      ) : isError && !isNotFound ? (
        <div className="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-900">
          <p className="text-red-500">Failed to load company.</p>
          <p className="text-sm text-slate-400">
            Check your connection and try again.
          </p>
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
            <Link
              href="/companies"
              className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
            >
              <ArrowLeft className="h-4 w-4" /> Back to Companies
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-900">
          <p className="text-slate-500">Company not found.</p>
          <Link
            href="/companies"
            className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Companies
          </Link>
        </div>
      )}
    </div>
  );
}
