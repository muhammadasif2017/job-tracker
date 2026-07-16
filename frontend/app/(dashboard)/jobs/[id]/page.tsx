'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  Pencil,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { Button } from '../../../../components/ui/button';
import { SourceBadge, StatusBadge } from '../../../../components/ui/badge';
import { Skeleton } from '../../../../components/ui/skeleton';
import { JobForm } from '../../../../components/jobs/job-form';
import { ResumeUpload } from '../../../../components/jobs/resume-upload';
import { CompanyProfileCard } from '../../../../components/company-profile-card';
import { formatDate } from '../../../../lib/utils';
import {
  JOB_STATUSES,
  STATUS_LABELS,
  type Job,
  type JobEvent,
  type JobStatus,
} from '../../../../types';
import api from '../../../../lib/api';

function Timeline({ events }: { events: JobEvent[] }) {
  if (events.length === 0) return null;

  return (
    <div className="rounded-xl border bg-white p-6 dark:bg-slate-900 space-y-4">
      <h2 className="font-semibold text-sm uppercase tracking-wide text-slate-500">
        Timeline
      </h2>
      <ol className="space-y-0">
        {events.map((event, i) => (
          <li key={event.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-indigo-500 shrink-0" />
              {i < events.length - 1 && (
                <span className="w-px flex-1 bg-slate-200 dark:bg-slate-700 my-1" />
              )}
            </div>
            <div className="pb-4">
              {event.type === 'CREATED' ? (
                <p className="text-sm">
                  Application created <StatusBadge status={event.toStatus} />
                </p>
              ) : (
                <p className="text-sm flex flex-wrap items-center gap-1">
                  Status changed from <StatusBadge status={event.fromStatus!} />{' '}
                  to <StatusBadge status={event.toStatus} />
                </p>
              )}
              <p className="text-xs text-slate-400 mt-0.5">
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
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data: job, isLoading } = useQuery<Job>({
    queryKey: ['job', id],
    queryFn: () => api.get(`/jobs/${id}`).then((r) => r.data),
    refetchInterval: (query) => {
      const status = query.state.data?.companyProfile?.status;
      return status === 'PENDING' || status === 'PROCESSING' ? 3000 : false;
    },
  });

  const { data: events = [] } = useQuery<JobEvent[]>({
    queryKey: ['job-events', id],
    queryFn: () => api.get(`/jobs/${id}/events`).then((r) => r.data),
    enabled: !!id,
  });

  const patchStatus = useMutation({
    mutationFn: (status: JobStatus) =>
      api.patch(`/jobs/${id}`, { status }).then((r) => r.data),
    onSuccess: (updated) => {
      qc.setQueryData<Job>(['job', id], (prev) => ({
        ...updated,
        companyProfile: prev?.companyProfile,
      }));
      qc.invalidateQueries({ queryKey: ['job-events', id] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['attention'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/jobs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['attention'] });
      toast.success('Job deleted');
      router.replace('/jobs');
    },
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/jobs"
        className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Jobs
      </Link>

      {isLoading ? (
        <div className="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-900">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-5 w-32" />
        </div>
      ) : job ? (
        <>
          <div className="rounded-xl border bg-white p-6 dark:bg-slate-900 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-xl font-bold break-words">{job.company}</h1>
                <p className="mt-0.5 text-slate-500 break-words">
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
                  onClick={() => deleteMutation.mutate()}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 text-sm">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
                  Status
                </p>
                <select
                  value={job.status}
                  onChange={(e) =>
                    patchStatus.mutate(e.target.value as JobStatus)
                  }
                  className="h-8 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                >
                  {JOB_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
                  Applied
                </p>
                <p>{formatDate(job.appliedAt)}</p>
              </div>
              {job.nextInterviewAt && (
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
                    Next Interview
                  </p>
                  <p className="inline-flex items-center gap-1.5 text-violet-600 dark:text-violet-400 font-medium">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {formatDate(job.nextInterviewAt)}
                  </p>
                </div>
              )}
              {job.location && (
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
                    Location
                  </p>
                  <p className="break-words">{job.location}</p>
                </div>
              )}
              {job.source && (
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
                    Source
                  </p>
                  <SourceBadge source={job.source} />
                </div>
              )}
              {job.url && (
                <div>
                  <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">
                    Job Posting
                  </p>
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
                  >
                    Open link <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>

            {job.notes && (
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">
                  Notes
                </p>
                <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">
                  {job.notes}
                </p>
              </div>
            )}

            <ResumeUpload jobId={id} initialResume={job.resume ?? null} />
          </div>

          <Timeline events={events} />
          <CompanyProfileCard profile={job.companyProfile} jobId={id} />
          <JobForm
            open={editOpen}
            onClose={() => setEditOpen(false)}
            job={job}
          />
        </>
      ) : (
        <div className="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-900">
          <p className="text-slate-500">Job not found.</p>
          <Link
            href="/jobs"
            className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Jobs
          </Link>
        </div>
      )}
    </div>
  );
}
