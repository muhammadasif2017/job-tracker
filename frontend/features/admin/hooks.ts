import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '../../lib/api';
import type { PaginatedAdminUsers, QueueObservability } from '../../types';

export interface AdminUsersFilters {
  page: number;
  search: string;
}

export function useAdminUsersQuery(filters: AdminUsersFilters) {
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: '10',
    ...(filters.search && { search: filters.search }),
  });

  return useQuery<PaginatedAdminUsers>({
    queryKey: ['admin-users', filters],
    queryFn: () => api.get(`/admin/users?${params}`).then((r) => r.data),
  });
}

export function useDeleteAdminUserMutation(onDeleted?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User deleted');
      onDeleted?.();
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to delete user')),
  });
}

// Deliberately no `refetchInterval` short enough to be a poll. The stranded
// state this panel exists to surface does not change second to second, and a
// runaway 3s poll was half of the bug that motivated the panel — refreshing is
// a button the admin presses.
export function useAdminQueuesQuery() {
  return useQuery<QueueObservability>({
    queryKey: ['admin-queues'],
    queryFn: () => api.get('/admin/queues').then((r) => r.data),
    staleTime: 30_000,
  });
}
