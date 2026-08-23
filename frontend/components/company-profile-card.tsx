'use client';

import { RefreshCw, AlertTriangle, SearchX } from 'lucide-react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Skeleton } from './ui/skeleton';
import { FieldValue } from './ui/field-value';
import api, { getErrorMessage } from '../lib/api';
import type { Company, CompanyProfile } from '../types';

// Company and CompanyProfile share the exact same enrichment-field subset
// (status, industry, ..., enrichedAt) — Company is that subset plus identity
// fields (name, city, priority, ...). Renders identically from either shape,
// which is what lets the job-detail and company-detail pages share this one
// component instead of each hand-maintaining their own field list.
type EnrichmentFieldsSource = CompanyProfile | Company;

interface Props {
  profile: EnrichmentFieldsSource | null | undefined;
  companyId?: string | null;
  // Query key to invalidate after a successful Refresh — ['job', jobId] on
  // the job-detail page, ['company', id] on the company-detail page.
  invalidateKey: QueryKey;
}

// Only NO_DATA carries a distinct, actionable message (add a website) — it's
// not really a failure. Every other cause (rate limit, bad key, vendor
// outage, ...) reduces to the same action for this app's single technical
// user: retry, and check server logs yourself if it keeps happening.
// Deliberately not a vendor-error-text classifier anymore — that regex-based
// approach previously misclassified Tavily quota exhaustion as a false
// "not configured correctly" message.
type FailureKind = 'NO_DATA' | 'FAILED';

const FAILURE_COPY: Record<
  FailureKind,
  { icon: typeof AlertTriangle; tone: 'amber' | 'red'; message: string }
> = {
  NO_DATA: {
    icon: SearchX,
    tone: 'amber',
    message:
      "We couldn't find any public information about this company. Adding a company website will let us pull details straight from their site.",
  },
  FAILED: {
    icon: AlertTriangle,
    tone: 'amber',
    message:
      "Company research couldn't complete. Try Refresh — if it keeps failing, check the server logs.",
  },
};

function UnverifiedBadge() {
  return (
    <span
      title="Couldn't confirm this against the company's own site — may belong to a different company with the same name."
      className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-xs font-normal text-amber-600 dark:text-amber-400"
    >
      <AlertTriangle className="h-3 w-3" />
      unverified
    </span>
  );
}

// Never falls through to displaying the raw message — an unrecognized shape
// (e.g. a vendor error format nobody's seen yet) still gets a safe, generic
// message via 'FAILED' rather than leaking backend/vendor internals to the UI.
function classifyFailure(message: string | null | undefined): FailureKind {
  if (
    message &&
    (/no extractable content/i.test(message) ||
      /did not call a tool|tool_use_failed/i.test(message))
  ) {
    return 'NO_DATA';
  }
  return 'FAILED';
}

function FailureBanner({
  errorMessage,
  prefix,
  suffix,
}: {
  errorMessage: string | null | undefined;
  prefix?: string;
  suffix?: string;
}) {
  const copy = FAILURE_COPY[classifyFailure(errorMessage)];
  const Icon = copy.icon;
  return (
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
        {prefix}
        {copy.message}
        {suffix}
      </p>
    </div>
  );
}

function ProfileFields({ profile }: { profile: EnrichmentFieldsSource }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
            Industry
          </p>
          <p className="break-words">
            <FieldValue value={profile.industry} />
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
            Size
          </p>
          <p className="break-words">
            <FieldValue value={profile.companySize} />
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
            HQ
          </p>
          <p className="break-words">
            <FieldValue value={profile.headquarters} />
            {profile.headquarters && profile.headquartersLowConfidence && (
              <UnverifiedBadge />
            )}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
            Founded
          </p>
          <p>
            <FieldValue value={profile.founded} />
          </p>
        </div>
      </div>

      {profile.techStack?.length > 0 && (
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

      <div>
        <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
          Address
        </p>
        <p className="text-sm break-words">
          <FieldValue value={profile.address} />
          {profile.address && profile.addressLowConfidence && (
            <UnverifiedBadge />
          )}
        </p>
      </div>

      <div>
        <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
          Work Policy
        </p>
        <p className="text-sm break-words">
          <FieldValue value={profile.workPolicy} />
        </p>
      </div>

      <div>
        <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
          Work-Life Balance
        </p>
        <p className="text-sm break-words">
          <FieldValue value={profile.workLifeBalance} />
        </p>
      </div>

      <div>
        <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
          Culture
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-300 break-words">
          <FieldValue value={profile.cultureSummary} />
        </p>
      </div>
    </>
  );
}

export function CompanyProfileCard({ profile, companyId, invalidateKey }: Props) {
  const qc = useQueryClient();

  const refresh = useMutation({
    // Company-scoped (docs/specs/company-fk-phase3b.md) — a profile only
    // ever renders when the job has a linked Company (a blank-company-name
    // job never has a profile to show a Refresh button for), so companyId
    // is always set here.
    mutationFn: () =>
      api.post(`/companies/${companyId}/enrichment`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: invalidateKey });
      toast.success('Enrichment queued');
    },
    onError: (err) =>
      toast.error(getErrorMessage(err, 'Failed to queue enrichment')),
  });

  if (!profile) return null;

  // On the job-detail page a profile's fields are only ever populated by a
  // COMPLETED enrichment run, so `enrichedAt` alone used to be a reliable
  // "is there anything to show" check. On the company-detail page that's no
  // longer true — these same columns are also directly user-editable
  // (CompanyForm) and mergeable (fieldOverrides), independent of enrichment
  // ever completing, so a fresh company sitting in PENDING/PROCESSING can
  // still have a real, user-set industry/headquarters/etc. worth showing
  // immediately rather than stuck behind a loading skeleton. Checking the
  // fields themselves (not just `enrichedAt`) covers both contexts — on the
  // job page these are equivalent, since enrichedAt and the fields are only
  // ever written together in the same completed-run update.
  const hasData = Boolean(
    profile.enrichedAt ||
      profile.industry ||
      profile.companySize ||
      profile.techStack?.length > 0 ||
      profile.cultureSummary ||
      profile.workPolicy ||
      profile.workLifeBalance ||
      profile.headquarters ||
      profile.address ||
      profile.founded,
  );
  const inFlight = profile.status === 'PENDING' || profile.status === 'PROCESSING';

  if (inFlight && !hasData) {
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

  if (profile.status === 'FAILED' && !hasData) {
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
        <FailureBanner errorMessage={profile.errorMessage} />
      </div>
    );
  }

  // COMPLETED, or PENDING/PROCESSING/FAILED with last-known-good data to show.
  return (
    <div className="rounded-xl border bg-white p-6 dark:bg-slate-900 space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm uppercase tracking-wide text-slate-500">
          Company Profile
        </h2>
        {inFlight ? (
          <span className="text-xs text-slate-400 animate-pulse">
            {profile.status === 'PROCESSING' ? 'Refreshing…' : 'Queued…'}
          </span>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            loading={refresh.isPending}
            onClick={() => refresh.mutate()}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        )}
      </div>

      {profile.status === 'FAILED' && (
        <FailureBanner
          errorMessage={profile.errorMessage}
          prefix="Last refresh failed: "
          suffix=" Showing your last successful result below."
        />
      )}

      <ProfileFields profile={profile} />
    </div>
  );
}
