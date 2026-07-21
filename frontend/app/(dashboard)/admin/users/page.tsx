'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../../components/ui/button';
import { Modal } from '../../../../components/ui/modal';
import { Skeleton } from '../../../../components/ui/skeleton';
import { formatDate, cn } from '../../../../lib/utils';
import type { AdminUser, PaginatedAdminUsers } from '../../../../types';
import api from '../../../../lib/api';

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | undefined>();

  const debouncedSearch = useDebounce(search);

  const params = new URLSearchParams({
    page: String(page),
    limit: '10',
    ...(debouncedSearch && { search: debouncedSearch }),
  });

  const { data, isLoading } = useQuery<PaginatedAdminUsers>({
    queryKey: ['admin-users', { page, search: debouncedSearch }],
    queryFn: () => api.get(`/admin/users?${params}`).then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      setDeleteTarget(undefined);
      toast.success('User deleted');
    },
    onError: (err: unknown) =>
      toast.error(
        isAxiosError(err)
          ? (err.response?.data?.message ?? 'Failed to delete user')
          : 'Failed to delete user',
      ),
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Admin — Users</h1>
        <p className="text-sm text-slate-500">
          {data?.meta.total ?? 0} registered users
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
        <input
          aria-label="Search users"
          className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="rounded-xl border bg-white dark:bg-slate-900 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b bg-slate-50 dark:bg-slate-800/50">
            <tr>
              {['Name', 'Email', 'Role', 'Jobs', 'Joined', ''].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i}>
                  {[...Array(6)].map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data?.data.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-16 text-center text-slate-400">
                  <p className="text-base font-medium">No users found</p>
                </td>
              </tr>
            ) : (
              data?.data.map((u) => (
                <tr
                  key={u.id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                    {u.name}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                    {u.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                        u.role === 'ADMIN'
                          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
                          : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
                      )}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{u.jobCount}</td>
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                    {formatDate(u.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => setDeleteTarget(u)}
                        aria-label={`Delete ${u.email}`}
                        className="rounded p-1.5 text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {data && data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-slate-500">
            <span>
              Page {page} of {data.meta.totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page === data.meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(undefined)}
        title="Delete user?"
        description={
          deleteTarget
            ? `Remove ${deleteTarget.name} (${deleteTarget.email})? This deletes all their jobs and cannot be undone.`
            : undefined
        }
      >
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => setDeleteTarget(undefined)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={deleteMutation.isPending}
            onClick={() =>
              deleteTarget && deleteMutation.mutate(deleteTarget.id)
            }
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
