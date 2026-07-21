'use client';

import { RefreshCw, Clock, WifiOff, KeyRound } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import api from '../lib/api';
import type { CompanyProfile } from '../types';

interface Props {
  profile: CompanyProfile | null | undefined;
  jobId: string;
}

type FailureKind = 'RATE_LIMITED' | 'UNAVAILABLE' | 'CONFIG';

const FAILURE_COPY: Record<
  FailureKind,
  { icon: typeof Clock; tone: 'amber' | 'red'; message: string }
> = {
  RATE_LIMITED: {
    icon: Clock,
    tone: 'amber',
    message:
      'Daily quota reached for company research. This resets automatically — try Refresh again in a few hours.',
  },
  UNAVAILABLE: {
    icon: WifiOff,
    tone: 'amber',
    message:
      'Company research service is temporarily unreachable. Try Refresh again in a few minutes.',
  },
  CONFIG: {
    icon: KeyRound,
    tone: 'red',
    message:
      "Company research isn't configured correctly (API key issue). Check GROQ_API_KEY on the backend.",
  },
};

function classifyFailure(message: string | null | undefined): FailureKind | null {
  if (!message) return null;
  if (/rate.?limit/i.test(message) || /^429\b/.test(message)) {
    return 'RATE_LIMITED';
  }
  if (
    /^40[13]\b/.test(message) ||
    /invalid api key|unauthorized|forbidden/i.test(message)
  ) {
    return 'CONFIG';
  }
  if (
    /^50[0234]\b/.test(message) ||
    /internal server error|service unavailable|bad gateway/i.test(message) ||
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(message) ||
    /timeout|timed out|network|fetch failed|AbortError/i.test(message)
  ) {
    return 'UNAVAILABLE';
  }
  return null;
}

export function CompanyProfileCard({ profile, jobId }: Props) {
  const qc = useQueryClient();

  const refresh = useMutation({
    mutationFn: () => api.post(`/jobs/${jobId}/enrichment`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      toast.success('Enrichment queued');
    },
    onError: () => toast.error('Failed to queue enrichment'),
  });

  if (!profile) return null;

  if (profile.status === 'PENDING' || profile.status === 'PROCESSING') {
    return (
      <div className="rounded-xl border bg-white p-6 dark:bg-slate-900 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-slate-500">
            Company Profile
          </h2>
          <span className="text-xs text-slate-400 animate-pulse">
            {profile.status === 'PROCESSING' ? 'Researching…' : 'Queued…'}
          </span>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    );
  }

  if (profile.status === 'FAILED') {
    const kind = classifyFailure(profile.errorMessage);
    const copy = kind ? FAILURE_COPY[kind] : null;
    const Icon = copy?.icon;

    return (
      <div className="rounded-xl border bg-white p-6 dark:bg-slate-900 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm uppercase tracking-wide text-slate-500">
            Company Profile
          </h2>
          <Button
            variant="secondary"
            size="sm"
            loading={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
        {copy && Icon ? (
          <div
            className={
              copy.tone === 'amber'
                ? 'flex items-start gap-2 rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30'
                : 'flex items-start gap-2 rounded-lg bg-red-50 p-3 dark:bg-red-950/30'
            }
          >
            <Icon
              className={
                copy.tone === 'amber'
                  ? 'h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400'
                  : 'h-4 w-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400'
              }
            />
            <p
              className={
                copy.tone === 'amber'
                  ? 'text-sm text-amber-700 dark:text-amber-400'
                  : 'text-sm text-red-700 dark:text-red-400'
              }
            >
              {copy.message}
            </p>
          </div>
        ) : (
          <p className="text-sm text-red-600 dark:text-red-400 break-words">
            {profile.errorMessage ?? 'Enrichment failed. Try again.'}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white p-6 dark:bg-slate-900 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-slate-500">
          Company Profile
        </h2>
        <Button
          variant="secondary"
          size="sm"
          loading={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        {profile.industry && (
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              Industry
            </p>
            <p className="break-words">{profile.industry}</p>
          </div>
        )}
        {profile.companySize && (
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              Size
            </p>
            <p className="break-words">{profile.companySize}</p>
          </div>
        )}
        {profile.headquarters && (
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              HQ
            </p>
            <p className="break-words">{profile.headquarters}</p>
          </div>
        )}
        {profile.founded && (
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
              Founded
            </p>
            <p>{profile.founded}</p>
          </div>
        )}
      </div>

      {profile.techStack.length > 0 && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">
            Tech Stack
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[...new Set(profile.techStack)].map((tech) => (
              <span
                key={tech}
                className="max-w-full break-words rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300"
              >
                {tech}
              </span>
            ))}
          </div>
        </div>
      )}

      {profile.address && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
            Address
          </p>
          <p className="text-sm break-words">{profile.address}</p>
        </div>
      )}

      {profile.workPolicy && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
            Work Policy
          </p>
          <p className="text-sm break-words">{profile.workPolicy}</p>
        </div>
      )}

      {profile.workLifeBalance && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
            Work-Life Balance
          </p>
          <p className="text-sm break-words">{profile.workLifeBalance}</p>
        </div>
      )}

      {profile.cultureSummary && (
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
            Culture
          </p>
          <p className="text-sm text-slate-600 dark:text-slate-300 break-words">
            {profile.cultureSummary}
          </p>
        </div>
      )}
    </div>
  );
}
