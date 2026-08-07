import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '../../lib/api';
import type { PaginatedAdminUsers } from '../../types';

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
