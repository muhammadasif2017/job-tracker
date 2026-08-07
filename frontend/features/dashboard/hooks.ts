import { useQuery } from '@tanstack/react-query';
import api from '../../lib/api';
import type {
  JobStats,
  PaginatedJobs,
  FunnelStats,
  TrendStats,
  DashboardRange,
  AttentionItem,
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
