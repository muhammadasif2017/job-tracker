'use client';

import { useState, useEffect } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import { Modal } from '../../../../components/ui/modal';
import { Skeleton } from '../../../../components/ui/skeleton';
import { formatDateTime, cn } from '../../../../lib/utils';
import type { AdminUser } from '../../../../types';
import {
  useAdminUsersQuery,
  useDeleteAdminUserMutation,
} from '../../../../features/admin/hooks';

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function AdminUsersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | undefined>();

  const debouncedSearch = useDebounce(search);

  const { data, isLoading, isError, refetch } = useAdminUsersQuery({
    page,
    search: debouncedSearch,
  });

  const deleteMutation = useDeleteAdminUserMutation(() =>
    setDeleteTarget(undefined),
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Admin — Users</h1>
        <p className="text-sm text-muted">
          {isError && !data
            ? 'Failed to load'
            : `${data?.meta.total ?? 0} registered users`}
        </p>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-2" />
        <input
          aria-label="Search users"
          className="h-9 w-full rounded-md border border-line bg-paper pl-9 pr-3 text-sm text-ink placeholder:text-muted-2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="rounded-md border border-line bg-paper overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-paper-raised">
            <tr>
              {['Name', 'Email', 'Role', 'Jobs', 'Joined', ''].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left font-mono text-[11px] font-medium text-muted uppercase tracking-wide"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody
            className="divide-y divide-line"
            aria-busy={isLoading}
          >
            {isLoading ? (
              <>
                <tr>
                  <td colSpan={6} className="sr-only" role="status">
                    Loading users
                  </td>
                </tr>
                {[...Array(5)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(6)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            ) : isError && !data ? (
              <tr>
                <td colSpan={6} className="py-16 text-center">
                  <p className="text-base font-medium text-danger">
                    Failed to load users
                  </p>
                  <p className="mt-1 text-sm text-muted-2">
                    Check your connection and try again.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-3"
                    onClick={() => refetch()}
                  >
                    Retry
                  </Button>
                </td>
              </tr>
            ) : data?.data.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-16 text-center text-muted-2">
                  <p className="text-base font-medium">No users found</p>
                </td>
              </tr>
            ) : (
              data?.data.map((u) => (
                <tr
                  key={u.id}
                  className="transition-colors hover:bg-paper-raised"
                >
                  <td className="px-4 py-3 font-medium text-ink">
                    {u.name}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {u.email}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-sm border border-line/70 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide',
                        u.role === 'ADMIN'
                          ? 'bg-accent-soft text-accent-ink'
                          : 'bg-paper-raised text-muted',
                      )}
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted">{u.jobCount}</td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">
                    {formatDateTime(u.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end">
                      <button
                        onClick={() => setDeleteTarget(u)}
                        aria-label={`Delete ${u.email}`}
                        className="rounded p-1.5 text-muted-2 hover:text-danger"
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
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
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
