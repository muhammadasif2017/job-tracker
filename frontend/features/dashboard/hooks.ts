import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '../../lib/api';
import { invalidateJobListCaches } from '../jobs/hooks';
import type {
  JobStats,
  PaginatedJobs,
  FunnelStats,
  TrendStats,
  DashboardRange,
  AttentionItem,
  GhostSuggestion,
} from '../../types';

export function useStatsQuery(range: DashboardRange) {
  return useQuery<JobStats>({
    queryKey: ['stats', range],
    queryFn: () => api.get(`/jobs/stats?range=${range}`).then((r) => r.data),
    placeholderData: (prev) => prev,
  });
}

export function useFunnelQuery(range: DashboardRange) {
  return useQuery<FunnelStats>({
    queryKey: ['analytics', 'funnel', range],
    queryFn: () =>
      api.get(`/jobs/stats/funnel?range=${range}`).then((r) => r.data),
    placeholderData: (prev) => prev,
  });
}

export function useTrendQuery(range: DashboardRange) {
  return useQuery<TrendStats>({
    queryKey: ['analytics', 'trend', range],
    queryFn: () =>
      api.get(`/jobs/stats/trend?range=${range}`).then((r) => r.data),
    placeholderData: (prev) => prev,
  });
}

export function useRecentJobsQuery() {
  return useQuery<PaginatedJobs>({
    queryKey: ['jobs', { limit: 5, sortBy: 'createdAt' }],
    queryFn: () =>
      api
        .get('/jobs?limit=5&sortBy=createdAt&sortOrder=desc')
        .then((r) => r.data),
  });
}

export function useAttentionQuery() {
  return useQuery<AttentionItem[]>({
    queryKey: ['attention'],
    queryFn: () => api.get('/jobs/attention').then((r) => r.data),
  });
}

export function useGhostSuggestionsQuery() {
  return useQuery<GhostSuggestion[]>({
    queryKey: ['ghost-suggestions'],
    queryFn: () => api.get('/jobs/ghost-suggestions').then((r) => r.data),
  });
}

// Takes the job id per call (unlike usePatchJobStatusMutation, which binds one
// id) because a single card or list renders many suggested jobs.
export function useMarkJobGhostedMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.patch(`/jobs/${id}`, { status: 'GHOSTED' }).then((r) => r.data),
    onSuccess: (_data, id) => {
      invalidateJobListCaches(qc);
      qc.invalidateQueries({ queryKey: ['job', id] });
      qc.invalidateQueries({ queryKey: ['job-events', id] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, 'Failed to mark as ghosted'));
    },
  });
}

export function useDismissGhostSuggestionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/jobs/${id}/ghost-suggestion/dismiss`).then((r) => r.data),
    // A dismissal also hides the job's follow-up nudges in Needs Attention.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ghost-suggestions'] });
      qc.invalidateQueries({ queryKey: ['attention'] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, 'Failed to dismiss suggestion'));
    },
  });
}

export function useMarkAllGhostedMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobIds: string[]) =>
      api
        .post<{ updated: number }>('/jobs/ghost-suggestions/mark-ghosted', {
          jobIds,
        })
        .then((r) => r.data),
    onSuccess: ({ updated }) => {
      invalidateJobListCaches(qc);
      // The server skips jobs that got activity since the card loaded, so
      // report its count rather than how many were sent.
      toast.success(
        `Marked ${updated} ${updated === 1 ? 'job' : 'jobs'} as ghosted`,
      );
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, 'Failed to mark jobs as ghosted'));
    },
  });
}
