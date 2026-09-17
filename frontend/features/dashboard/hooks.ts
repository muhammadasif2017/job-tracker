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

/**
 * Headline dashboard stats for `range`, keeping the previous range on screen
 * while loading.
 */
export function useStatsQuery(range: DashboardRange) {
  return useQuery<JobStats>({
    queryKey: ['stats', range],
    queryFn: () => api.get(`/jobs/stats?range=${range}`).then((r) => r.data),
    placeholderData: (prev) => prev,
  });
}

/** Funnel and response-insight stats for `range`. */
export function useFunnelQuery(range: DashboardRange) {
  return useQuery<FunnelStats>({
    queryKey: ['analytics', 'funnel', range],
    queryFn: () =>
      api.get(`/jobs/stats/funnel?range=${range}`).then((r) => r.data),
    placeholderData: (prev) => prev,
  });
}

/** Applications trend buckets for `range`. */
export function useTrendQuery(range: DashboardRange) {
  return useQuery<TrendStats>({
    queryKey: ['analytics', 'trend', range],
    queryFn: () =>
      api.get(`/jobs/stats/trend?range=${range}`).then((r) => r.data),
    placeholderData: (prev) => prev,
  });
}

/** The five most recently created jobs. */
export function useRecentJobsQuery() {
  return useQuery<PaginatedJobs>({
    queryKey: ['jobs', { limit: 5, sortBy: 'createdAt' }],
    queryFn: () =>
      api
        .get('/jobs?limit=5&sortBy=createdAt&sortOrder=desc')
        .then((r) => r.data),
  });
}

/** The "Needs attention" list. */
export function useAttentionQuery() {
  return useQuery<AttentionItem[]>({
    queryKey: ['attention'],
    queryFn: () => api.get('/jobs/attention').then((r) => r.data),
  });
}

/** Shared options so the card and the per-job badges use one cache entry. */
const ghostSuggestionsQuery = {
  queryKey: ['ghost-suggestions'],
  queryFn: (): Promise<GhostSuggestion[]> =>
    api.get('/jobs/ghost-suggestions').then((r) => r.data),
};

/** The "Looks ghosted" suggestions. */
export function useGhostSuggestionsQuery() {
  return useQuery(ghostSuggestionsQuery);
}

/**
 * The suggested job ids as a Set, for per-job badges in the list and kanban
 * views. Same query key as the card, so a page full of badges shares one
 * request and one cache entry.
 */
export function useGhostSuggestedIds() {
  return useQuery({
    ...ghostSuggestionsQuery,
    select: (items) => new Set(items.map(({ job }) => job.id)),
  });
}

/**
 * Marks one suggested job as GHOSTED.
 *
 * Takes the job id per call (unlike usePatchJobStatusMutation, which binds one
 * id) because a single card or list renders many suggested jobs.
 */
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

/**
 * Dismisses one ghost suggestion, restarting its 14-day clock. It also quiets
 * the job's follow-up nudges in Needs Attention.
 */
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

/**
 * Marks every suggestion the user saw as GHOSTED in one request. The server
 * skips jobs that got activity since the card loaded.
 */
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
