'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  Pencil,
  Trash2,
} from 'lucide-react';
import { isAxiosError } from 'axios';
import Link from 'next/link';
import { Button } from '../../../../components/ui/button';
import { SourceBadge, StatusBadge } from '../../../../components/ui/badge';
import { Skeleton, LoadingStatus } from '../../../../components/ui/skeleton';
import { JobForm } from '../../../../components/jobs/job-form';
import { ResumeUpload } from '../../../../components/jobs/resume-upload';
import { InterviewRounds } from '../../../../components/jobs/interview-rounds';
import { Contacts } from '../../../../components/jobs/contacts';
import { CompanyProfileCard } from '../../../../components/company-profile-card';
import { formatDate, formatCivilDate } from '../../../../lib/utils';
import {
  JOB_STATUSES,
  STATUS_LABELS,
  type JobEvent,
  type JobStatus,
} from '../../../../types';
import {
  useJobQuery,
  useJobEventsQuery,
  usePatchJobStatusMutation,
  useDeleteJobMutation,
} from '../../../../features/jobs/hooks';

function Timeline({ events }: { events: JobEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div className="rounded-md border border-line bg-paper p-6 space-y-4">
      <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
        Timeline
      </h2>
      <ol className="space-y-0">
        {events.map((event, i) => (
          <li key={event.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-accent shrink-0" />
              {i < events.length - 1 && (
                <span className="w-px flex-1 bg-line my-1" />
              )}
            </div>
            <div className="pb-4">
              {event.type === 'CREATED' ? (
                <p className="text-sm text-ink">
                  Application created <StatusBadge status={event.toStatus} />
                </p>
              ) : event.type === 'STATUS_CHANGE' ? (
                <>
                  <p className="text-sm flex flex-wrap items-center gap-1 text-ink">
                    Status changed from{' '}
                    <StatusBadge status={event.fromStatus!} /> to{' '}
                    <StatusBadge status={event.toStatus} />
                  </p>
                  {event.note && (
                    <p className="text-sm text-muted">→ {event.note}</p>
                  )}
                </>
              ) : (
                <>
                  <p className="text-sm text-ink">Interview round scheduled</p>
                  {event.note && (
                    <p className="text-sm text-muted">→ {event.note}</p>
                  )}
                </>
              )}
              <p className="text-xs text-muted-2 mt-0.5">
                {formatDate(event.createdAt)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);

  const { data: job, isLoading, isError, error, refetch } = useJobQuery(id);

  const isNotFound =
    isAxiosError(error) && error.response?.status === 404;

  const { data: events = [] } = useJobEventsQuery(id);

  const patchStatus = usePatchJobStatusMutation(id);

  const deleteMutation = useDeleteJobMutation(() => router.replace('/jobs'));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/jobs"
        className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Jobs
      </Link>

      {isLoading ? (
        <LoadingStatus
          label="Loading job"
          className="space-y-4 rounded-md border border-line bg-paper p-6"
        >
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-5 w-32" />
        </LoadingStatus>
      ) : job ? (
        <>
          <div className="rounded-md border border-line bg-paper p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="font-display text-2xl font-bold tracking-tight text-ink break-words">{job.company}</h1>
                <p className="mt-0.5 text-muted break-words">
                  {job.position}
                </p>
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

            <div className="grid gap-4 sm:grid-cols-2 text-sm">
              <div>
                <label
                  htmlFor="job-detail-status"
                  className="block font-mono text-[11px] text-muted-2 uppercase tracking-wide mb-1"
                >
                  Status
                </label>
                <select
                  id="job-detail-status"
                  value={job.status}
                  onChange={(e) =>
                    patchStatus.mutate(e.target.value as JobStatus)
                  }
                  className="h-8 rounded-md border border-line bg-paper px-2 text-sm text-ink"
                >
                  {JOB_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="font-mono text-[11px] text-muted-2 uppercase tracking-wide mb-1">
                  Applied
                </p>
                <p className="text-ink">{formatCivilDate(job.appliedAt)}</p>
              </div>
              {job.nextInterviewAt && (
                <div>
                  <p className="font-mono text-[11px] text-muted-2 uppercase tracking-wide mb-1">
                    Next Interview
                  </p>
                  <p className="inline-flex items-center gap-1.5 text-accent-2 font-medium">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {formatDate(job.nextInterviewAt)}
                  </p>
                </div>
              )}
              {job.location && (
                <div>
                  <p className="font-mono text-[11px] text-muted-2 uppercase tracking-wide mb-1">
                    Location
                  </p>
                  <p className="break-words text-ink">{job.location}</p>
                </div>
              )}
              {job.discoverySource && (
                <div>
                  <p className="font-mono text-[11px] text-muted-2 uppercase tracking-wide mb-1">
                    Discovery Source
                  </p>
                  <SourceBadge kind="discovery" source={job.discoverySource} />
                </div>
              )}
              {job.applicationChannel && (
                <div>
                  <p className="font-mono text-[11px] text-muted-2 uppercase tracking-wide mb-1">
                    Application Channel
                  </p>
                  <SourceBadge kind="channel" source={job.applicationChannel} />
                </div>
              )}
              {job.url && (
                <div>
                  <p className="font-mono text-[11px] text-muted-2 uppercase tracking-wide mb-1">
                    Job Posting
                  </p>
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    Open link <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>

            {job.notes && (
              <div>
                <p className="font-mono text-[11px] text-muted-2 uppercase tracking-wide mb-2">
                  Notes
                </p>
                <p className="whitespace-pre-wrap break-words rounded-md bg-paper-raised p-3 text-sm text-ink">
                  {job.notes}
                </p>
              </div>
            )}

            <ResumeUpload jobId={id} initialResume={job.resume ?? null} />
          </div>

          <Timeline events={events} />
          <InterviewRounds jobId={id} rounds={job.interviewRounds ?? []} />
          <Contacts jobId={id} contacts={job.contacts ?? []} />
          <CompanyProfileCard
            profile={job.companyProfile}
            companyId={job.companyId}
            invalidateKey={['job', id]}
          />
          <JobForm
            open={editOpen}
            onClose={() => setEditOpen(false)}
            job={job}
          />
        </>
      ) : isError && !job && !isNotFound ? (
        <div className="space-y-4 rounded-md border border-line bg-paper p-6">
          <p className="text-danger">Failed to load job.</p>
          <p className="text-sm text-muted-2">
            Check your connection and try again.
          </p>
          <div className="flex items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              Retry
            </Button>
            <Link
              href="/jobs"
              className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"
            >
              <ArrowLeft className="h-4 w-4" /> Back to Jobs
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4 rounded-md border border-line bg-paper p-6">
          <p className="text-muted">Job not found.</p>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-2 text-sm text-muted hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Jobs
          </Link>
        </div>
      )}
    </div>
  );
}
