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
} from '../../types';

export interface JobsFilters {
  page: number;
  search: string;
  status: JobStatus | '';
  priority: JobPriority | '';
}

function invalidateJobListCaches(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['jobs'] });
  qc.invalidateQueries({ queryKey: ['stats'] });
  qc.invalidateQueries({ queryKey: ['analytics', 'funnel'] });
  qc.invalidateQueries({ queryKey: ['attention'] });
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
      invalidateJobListCaches(qc);
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
      invalidateJobListCaches(qc);
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
      invalidateJobListCaches(qc);
    },
  });
}

export interface ParsedJob {
  company?: string | null;
  position?: string | null;
  location?: string | null;
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
