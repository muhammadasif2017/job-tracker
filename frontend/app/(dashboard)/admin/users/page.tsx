'use client';

import { useState } from 'react';
import { useDebounce } from '../../../../lib/use-debounce';
import { Search, Trash2 } from 'lucide-react';
import { Button } from '../../../../components/ui/button';
import { Modal } from '../../../../components/ui/modal';
import { Skeleton } from '../../../../components/ui/skeleton';
import { RoleBadge } from '../../../../components/ui/badge';
import { formatDateTime, cn } from '../../../../lib/utils';
import {
  CARD_FULL_ROW,
  CARD_ROW,
  CARD_SKELETON,
  makeCellClass,
} from '../../../../lib/responsive-table';
import type { AdminUser } from '../../../../types';
import {
  useAdminUsersQuery,
  useDeleteAdminUserMutation,
} from '../../../../features/admin/hooks';

/**
 * Users-table columns and each one's responsive class. Below sm each row
 * becomes a card (see `ROW_CARD`) and every column takes a named grid area in
 * it. The header, the skeleton and the data rows all read this, so they cannot
 * drift apart — the same shape as the jobs list (#471).
 */
const COLUMNS = [
  ['Name', 'max-sm:[grid-area:nm] max-sm:min-w-0'],
  ['Email', 'max-sm:[grid-area:em] max-sm:min-w-0 max-sm:text-xs'],
  ['Role', 'max-sm:[grid-area:rl]'],
  ['Jobs', 'max-sm:[grid-area:jb] max-sm:self-center max-sm:text-xs'],
  ['Joined', 'max-sm:[grid-area:jn] max-sm:self-center max-sm:text-xs'],
  ['', 'max-sm:[grid-area:act]'],
] as const;

/** Class for one users-table cell. */
const cellClass = makeCellClass(COLUMNS);

/**
 * Below sm a row is a card: name and delete on top, email under it, then
 * role, job count and join date. No horizontal scroll to reach delete.
 */
const ROW_CARD = cn(
  CARD_ROW,
  "max-sm:grid-cols-[auto_auto_1fr_auto] max-sm:[grid-template-areas:'nm_nm_nm_act'_'em_em_em_act'_'rl_jb_jn_jn']",
);

/**
 * The header's count line. Under a search `meta.total` counts the matches,
 * not the install, so it says so.
 */
function userCount(total: number, searching: boolean) {
  const noun = total === 1 ? 'user' : 'users';
  return searching
    ? `${total} matching ${noun}`
    : `${total} registered ${noun}`;
}

/**
 * Admin users page (`/admin/users`): searchable, paginated user list with
 * delete.
 */
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
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          Admin — Users
        </h1>
        {/* Nothing until the count is known: a "0 registered users" flash
            while loading reads as an empty install. */}
        <p className="min-h-5 text-sm text-muted">
          {isError && !data
            ? 'Failed to load'
            : data && userCount(data.meta.total, !!debouncedSearch)}
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
        {/* Explicit roles: the display:block below sm would otherwise drop the
            table semantics in Chrome and Safari. */}
        <table role="table" className="w-full text-sm max-sm:block">
          <thead
            role="rowgroup"
            className="border-b border-line bg-paper-raised max-sm:hidden"
          >
            <tr role="row">
              {COLUMNS.map(([h]) => (
                <th
                  role="columnheader"
                  key={h}
                  className="px-4 py-3 text-left text-xs font-medium text-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody
            role="rowgroup"
            className="divide-y divide-line max-sm:block"
            aria-busy={isLoading}
          >
            {isLoading ? (
              <>
                <tr role="row">
                  <td colSpan={6} className="sr-only" role="status">
                    Loading users
                  </td>
                </tr>
                {[...Array(5)].map((_, i) => (
                  <tr role="row" key={i} className={ROW_CARD}>
                    {COLUMNS.map(([h]) => (
                      <td role="cell" key={h} className={cellClass(h)}>
                        <Skeleton className={cn('h-4 w-full', CARD_SKELETON)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </>
            ) : isError && !data ? (
              <tr role="row" className={CARD_FULL_ROW}>
                <td
                  role="cell"
                  colSpan={6}
                  className={cn('py-16 text-center', CARD_FULL_ROW)}
                >
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
              <tr role="row" className={CARD_FULL_ROW}>
                <td
                  role="cell"
                  colSpan={6}
                  className={cn(
                    'py-16 text-center text-muted-2',
                    CARD_FULL_ROW,
                  )}
                >
                  <p className="text-base font-medium">No users found</p>
                </td>
              </tr>
            ) : (
              data?.data.map((u) => (
                <tr
                  role="row"
                  key={u.id}
                  className={cn(
                    'transition-colors hover:bg-paper-raised',
                    ROW_CARD,
                  )}
                >
                  <td
                    role="cell"
                    className={cellClass(
                      'Name',
                      'font-medium text-ink [overflow-wrap:anywhere]',
                    )}
                  >
                    {u.name}
                  </td>
                  {/* An email has no spaces to wrap at; without anywhere-wrap
                      a long one pushes the card past a phone's width. */}
                  <td
                    role="cell"
                    className={cellClass(
                      'Email',
                      'text-muted [overflow-wrap:anywhere]',
                    )}
                  >
                    {u.email}
                  </td>
                  <td role="cell" className={cellClass('Role')}>
                    <RoleBadge role={u.role} />
                  </td>
                  <td role="cell" className={cellClass('Jobs', 'text-muted')}>
                    <span>{u.jobCount}</span>
                    {/* The card hides the header, so a bare count needs its
                        unit. */}
                    <span className="sm:hidden">
                      {u.jobCount === 1 ? ' job' : ' jobs'}
                    </span>
                  </td>
                  <td
                    role="cell"
                    className={cellClass(
                      'Joined',
                      'text-muted whitespace-nowrap',
                    )}
                  >
                    {formatDateTime(u.createdAt)}
                  </td>
                  <td role="cell" className={cellClass('')}>
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
          <Button
            variant="secondary"
            onClick={() => setDeleteTarget(undefined)}
          >
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
