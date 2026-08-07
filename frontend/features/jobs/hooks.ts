import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '../../lib/api';
import type {
  Job,
  JobEvent,
  JobStatus,
  JobPriority,
  PaginatedJobs,
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
