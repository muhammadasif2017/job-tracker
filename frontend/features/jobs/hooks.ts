import { useState } from 'react';
import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '../../lib/api';
import type {
  Job,
  JobEvent,
  JobStatus,
  JobPriority,
  JobType,
  ApplicationChannel,
  PaginatedJobs,
  Resume,
  InterviewOutcome,
} from '../../types';

export interface JobsFilters {
  page: number;
  search: string;
  status: JobStatus | '';
  priority: JobPriority | '';
}

export function useJobsQuery(filters: JobsFilters) {
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: '10',
    sortBy: 'appliedAt',
    sortOrder: 'desc',
    ...(filters.search && { search: filters.search }),
    ...(filters.status && { status: filters.status }),
    ...(filters.priority && { priority: filters.priority }),
  });

  return useQuery<PaginatedJobs>({
    queryKey: ['jobs', filters],
    queryFn: () => api.get(`/jobs?${params}`).then((r) => r.data),
  });
}

export function useDeleteJobMutation(onDeleted?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/jobs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['analytics', 'funnel'] });
      qc.invalidateQueries({ queryKey: ['attention'] });
      toast.success('Job deleted');
      onDeleted?.();
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, 'Failed to delete job'));
    },
  });
}

export function useJobQuery(id: string) {
  return useQuery<Job>({
    queryKey: ['job', id],
    queryFn: () => api.get(`/jobs/${id}`).then((r) => r.data),
    refetchInterval: (query) => {
      const status = query.state.data?.companyProfile?.status;
      return status === 'PENDING' || status === 'PROCESSING' ? 3000 : false;
    },
  });
}

export function useJobEventsQuery(id: string) {
  return useQuery<JobEvent[]>({
    queryKey: ['job-events', id],
    queryFn: () => api.get(`/jobs/${id}/events`).then((r) => r.data),
    enabled: !!id,
  });
}

export function usePatchJobStatusMutation(id: string) {
  const qc = useQueryClient();
  return useMutation({
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
      qc.invalidateQueries({ queryKey: ['analytics', 'funnel'] });
      qc.invalidateQueries({ queryKey: ['attention'] });
    },
    // A 409 here means another request (e.g. an interview-round
    // auto-promotion) changed the status concurrently — refetch so the
    // select snaps to the true current status instead of the stale cached
    // one the user tried to change it from.
    onError: (err: unknown) => {
      qc.invalidateQueries({ queryKey: ['job', id] });
      toast.error(getErrorMessage(err, 'Failed to update status'));
    },
  });
}

const KANBAN_QUERY_KEY = ['jobs', { limit: 100 }] as const;

export function useKanbanJobsQuery() {
  return useQuery<PaginatedJobs>({
    queryKey: KANBAN_QUERY_KEY,
    queryFn: () => api.get('/jobs?limit=100').then((r) => r.data),
  });
}

export function useKanbanPatchStatusMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) =>
      api.patch(`/jobs/${id}`, { status }).then((r) => r.data),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['jobs'] });
      const prev = qc.getQueryData<PaginatedJobs>(KANBAN_QUERY_KEY);
      qc.setQueryData<PaginatedJobs>(KANBAN_QUERY_KEY, (old) =>
        old
          ? {
              ...old,
              data: old.data.map((j) => (j.id === id ? { ...j, status } : j)),
            }
          : old,
      );
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KANBAN_QUERY_KEY, ctx.prev);
      toast.error(getErrorMessage(err, 'Failed to update status'));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      qc.invalidateQueries({ queryKey: ['analytics', 'funnel'] });
      qc.invalidateQueries({ queryKey: ['attention'] });
    },
  });
}

export function useResumeQuery(jobId: string | null, initialResume?: Resume | null) {
  const [initialTimestamp] = useState<number | undefined>(() =>
    initialResume !== undefined ? Date.now() : undefined,
  );

  return useQuery<Resume | null>({
    queryKey: ['resume', jobId],
    queryFn: () => api.get(`/jobs/${jobId}/resumes`).then((r) => r.data),
    initialData: initialResume !== undefined ? initialResume : undefined,
    initialDataUpdatedAt: initialTimestamp,
    enabled: !!jobId,
    staleTime: 60_000,
  });
}

export function useUploadResumeMutation(jobId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api
        .post(`/jobs/${jobId}/resumes`, form, {
          headers: { 'Content-Type': 'multipart/form-data' },
          // 8 MB cap (MAX_SIZE in resume-upload.tsx) — 120s is generous even
          // on a slow mobile upload, and still lets a truly stalled
          // connection surface instead of spinning forever.
          timeout: 120_000,
        })
        .then((r) => r.data);
    },
    onSuccess: (data: Resume) => {
      qc.setQueryData(['resume', jobId], data);
      toast.success('Resume uploaded');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Upload failed')),
  });
}

export function useRemoveResumeMutation(
  jobId: string | null,
  onSettled?: () => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/jobs/${jobId}/resumes`).then((r) => r.data),
    onSuccess: () => {
      qc.setQueryData(['resume', jobId], null);
      toast.success('Resume removed');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Remove failed')),
    onSettled: () => onSettled?.(),
  });
}

export interface ContactPayload {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  notes: string | null;
}

export function useCreateContactMutation(jobId: string, onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ContactPayload) =>
      api.post(`/jobs/${jobId}/contacts`, payload).then((r) => r.data),
    onSuccess: () => {
      // Contacts never touch Job.status/nextInterviewAt, so the job detail
      // query is the only cache that needs refreshing — unlike interview
      // rounds, there's no Kanban/stats/funnel invalidation to do here.
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      toast.success('Contact added');
      onSuccess?.();
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to add contact')),
  });
}

export function useUpdateContactMutation(jobId: string, onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      contactId,
      payload,
    }: {
      contactId: string;
      payload: ContactPayload;
    }) =>
      api
        .patch(`/jobs/${jobId}/contacts/${contactId}`, payload)
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      toast.success('Contact updated');
      onSuccess?.();
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to update contact')),
  });
}

export function useRemoveContactMutation(
  jobId: string,
  onSettled?: () => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contactId: string) =>
      api.delete(`/jobs/${jobId}/contacts/${contactId}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      toast.success('Contact removed');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to remove contact')),
    onSettled: () => onSettled?.(),
  });
}

// Creating/updating/removing a round can silently flip Job.status (APPLIED ->
// INTERVIEWING auto-promotion, see interview-rounds.service.ts). Match the
// invalidation set the manual status-change mutation uses
// (usePatchJobStatusMutation) so the Kanban board and dashboard stats don't
// show a stale status.
function invalidateInterviewRoundCaches(qc: QueryClient, jobId: string) {
  qc.invalidateQueries({ queryKey: ['job', jobId] });
  qc.invalidateQueries({ queryKey: ['job-events', jobId] });
  qc.invalidateQueries({ queryKey: ['attention'] });
  qc.invalidateQueries({ queryKey: ['jobs'] });
  qc.invalidateQueries({ queryKey: ['stats'] });
  qc.invalidateQueries({ queryKey: ['analytics', 'funnel'] });
}

export interface CreateInterviewRoundPayload {
  stage: string;
  scheduledAt: string;
  notes?: string;
}

export function useCreateInterviewRoundMutation(
  jobId: string,
  onSuccess?: () => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateInterviewRoundPayload) =>
      api
        .post(`/jobs/${jobId}/interview-rounds`, payload)
        .then((r) => r.data),
    onSuccess: () => {
      invalidateInterviewRoundCaches(qc, jobId);
      toast.success('Interview round added');
      onSuccess?.();
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to add round')),
  });
}

export function useInterviewRoundOutcomeMutation(jobId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      roundId,
      outcome,
    }: {
      roundId: string;
      outcome: InterviewOutcome;
    }) =>
      api
        .patch(`/jobs/${jobId}/interview-rounds/${roundId}`, { outcome })
        .then((r) => r.data),
    onSuccess: () => {
      invalidateInterviewRoundCaches(qc, jobId);
      toast.success('Outcome updated');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to update outcome')),
  });
}

export function useRemoveInterviewRoundMutation(
  jobId: string,
  onSettled?: () => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roundId: string) =>
      api
        .delete(`/jobs/${jobId}/interview-rounds/${roundId}`)
        .then((r) => r.data),
    onSuccess: () => {
      invalidateInterviewRoundCaches(qc, jobId);
      toast.success('Interview round removed');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to remove round')),
    onSettled: () => onSettled?.(),
  });
}

export interface ParsedJob {
  company?: string;
  position?: string;
  location?: string;
  url?: string;
  jobType?: JobType;
  applicationChannel?: ApplicationChannel;
}

function looksLikeUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function useParseJobMutation(onParsed?: (data: ParsedJob) => void) {
  return useMutation({
    mutationFn: (value: string) => {
      const payload = looksLikeUrl(value)
        ? { url: value.trim() }
        : { text: value };
      return api
        .post<ParsedJob>('/jobs/parse', payload, { timeout: 60_000 })
        .then((r) => r.data);
    },
    onSuccess: (data) => onParsed?.(data),
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Could not parse that posting')),
  });
}
