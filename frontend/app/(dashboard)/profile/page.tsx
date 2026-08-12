'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { Modal } from '../../../components/ui/modal';
import { Skeleton } from '../../../components/ui/skeleton';
import { useAuthStore } from '../../../store/auth.store';
import { DIGEST_FREQUENCIES, DIGEST_FREQUENCY_LABELS } from '../../../types';
import { formatDate, formatRelative } from '../../../lib/utils';
import {
  useProfileQuery,
  useUpdateProfileMutation,
  useUpdateNotificationsMutation,
  useChangePasswordMutation,
  useDeleteAccountMutation,
} from '../../../features/profile/hooks';
import {
  useTokensQuery,
  useCreateTokenMutation,
  useRevokeTokenMutation,
  type ApiToken,
  type CreatedApiToken,
} from '../../../features/tokens/hooks';

// Reads Intl.supportedValuesOf('timeZone'), which depends on the runtime's
// ICU data — SSR (Node) and hydration (browser) can disagree, which produced
// a real hydration mismatch on the <option> list. ssr: false keeps it out of
// the server-rendered HTML entirely so there's nothing to mismatch.
const TimezoneField = dynamic(
  () => import('../../../components/profile/timezone-field').then((m) => m.TimezoneField),
  { ssr: false, loading: () => <Skeleton className="h-9 w-full max-w-xs" /> },
);

const profileSchema = z.object({ name: z.string().min(1, 'Name is required') });
const notificationsSchema = z.object({
  interviewRemindersEnabled: z.boolean(),
  digestFrequency: z.enum(DIGEST_FREQUENCIES),
  timezone: z.string().min(1, 'Required'),
});
type NotificationsFormData = z.infer<typeof notificationsSchema>;
const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Required'),
    newPassword: z.string().min(8, 'Min 8 characters'),
    confirm: z.string(),
  })
  .refine((d) => d.newPassword === d.confirm, {
    message: "Passwords don't match",
    path: ['confirm'],
  });

const tokenNameSchema = z.object({
  name: z.string().min(1, 'Required').max(100, 'Max 100 characters'),
});
type TokenNameFormData = z.infer<typeof tokenNameSchema>;

export default function ProfilePage() {
  const { user: storeUser } = useAuthStore();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<CreatedApiToken | null>(
    null,
  );
  const [revokeTarget, setRevokeTarget] = useState<ApiToken | null>(null);

  const { data: profile } = useProfileQuery();
  const user = profile ?? storeUser;

  const profileForm = useForm<{ name: string }>({
    resolver: zodResolver(profileSchema),
    values: { name: profile?.name ?? storeUser?.name ?? '' },
    resetOptions: { keepDirtyValues: true },
  });
  const passwordForm = useForm({ resolver: zodResolver(passwordSchema) });
  const tokenNameForm = useForm<TokenNameFormData>({
    resolver: zodResolver(tokenNameSchema),
    defaultValues: { name: '' },
  });
  const notificationsForm = useForm<NotificationsFormData>({
    resolver: zodResolver(notificationsSchema),
    values: {
      interviewRemindersEnabled: profile?.interviewRemindersEnabled ?? true,
      digestFrequency: profile?.digestFrequency ?? 'OFF',
      timezone: profile?.timezone ?? 'UTC',
    },
    resetOptions: { keepDirtyValues: true },
  });

  const updateProfile = useUpdateProfileMutation();
  const updateNotifications = useUpdateNotificationsMutation();
  const changePassword = useChangePasswordMutation(() => passwordForm.reset());
  const deleteAccount = useDeleteAccountMutation();
  const { data: tokens } = useTokensQuery();
  const createToken = useCreateTokenMutation();
  const revokeToken = useRevokeTokenMutation();
  // A single shared mutation only tracks the most recent call's `variables`,
  // so revoking two different rows in quick succession would otherwise
  // desync the spinner from `revokeToken.isPending`. Track pending ids
  // per-row instead.
  const [pendingRevokeIds, setPendingRevokeIds] = useState<Set<string>>(
    new Set(),
  );

  const hasPassword = !!profile?.hasPassword;

  const closeTokenModal = () => {
    setTokenModalOpen(false);
    setCreatedToken(null);
    tokenNameForm.reset();
  };

  const confirmRevoke = (id: string) => {
    setRevokeTarget(null);
    setPendingRevokeIds((prev) => new Set(prev).add(id));
    revokeToken.mutate(id, {
      onSettled: () => {
        setPendingRevokeIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      },
    });
  };

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy — select the token text and copy it manually');
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Profile</h1>
        <p className="text-sm text-slate-500">Manage your account</p>
      </div>

      <div className="rounded-xl border bg-white p-5 dark:bg-slate-900 space-y-4">
        <h2 className="font-medium">Personal Info</h2>
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 text-lg font-bold text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">
            {user?.name?.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-medium break-words">{user?.name}</p>
            <p className="text-sm text-slate-500 break-words">{user?.email}</p>
          </div>
        </div>
        <form
          onSubmit={profileForm.handleSubmit((d) => updateProfile.mutate(d))}
          className="space-y-4"
        >
          <Input
            label="Name"
            error={profileForm.formState.errors.name?.message}
            disabled={!profile}
            {...profileForm.register('name')}
          />
          <Button type="submit" size="sm" loading={updateProfile.isPending}>
            Save changes
          </Button>
        </form>
      </div>

      <div className="rounded-xl border bg-white p-5 dark:bg-slate-900 space-y-4">
        <h2 className="font-medium">Email Notifications</h2>
        <form
          onSubmit={notificationsForm.handleSubmit((d) =>
            updateNotifications.mutate(d),
          )}
          className="space-y-4"
        >
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-700"
              {...notificationsForm.register('interviewRemindersEnabled')}
            />
            Email me a reminder before scheduled interviews
          </label>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="digest-frequency"
              className="text-sm font-medium text-slate-700 dark:text-slate-300"
            >
              Email digest
            </label>
            <select
              id="digest-frequency"
              className="h-9 w-full max-w-[200px] rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              {...notificationsForm.register('digestFrequency')}
            >
              {DIGEST_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {DIGEST_FREQUENCY_LABELS[f]}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">
              A summary of upcoming interviews and stalled applications that
              need your attention.
            </p>
          </div>

          <TimezoneField
            registerProps={notificationsForm.register('timezone')}
            onUseBrowserTimezone={(tz) =>
              notificationsForm.setValue('timezone', tz, { shouldDirty: true })
            }
          />

          <Button
            type="submit"
            size="sm"
            loading={updateNotifications.isPending}
          >
            Save preferences
          </Button>
        </form>
      </div>

      {user?.connectedProviders && user.connectedProviders.length > 0 && (
        <div className="rounded-xl border bg-white p-5 dark:bg-slate-900 space-y-3">
          <h2 className="font-medium">Connected Accounts</h2>
          {['github'].map((provider) => {
            const connected = user.connectedProviders!.includes(provider);
            return (
              <div key={provider} className="flex items-center justify-between">
                <div className="flex items-center gap-2 capitalize text-sm">
                  <span
                    className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`}
                  />
                  {provider}
                </div>
                <span className="text-xs text-slate-400">
                  {connected ? 'Connected' : 'Not connected'}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {hasPassword && (
        <div className="rounded-xl border bg-white p-5 dark:bg-slate-900 space-y-4">
          <h2 className="font-medium">Change Password</h2>
          <form
            onSubmit={passwordForm.handleSubmit((d) =>
              changePassword.mutate(d),
            )}
            className="space-y-4"
          >
            <Input
              label="Current password"
              type="password"
              error={passwordForm.formState.errors.currentPassword?.message}
              {...passwordForm.register('currentPassword')}
            />
            <Input
              label="New password"
              type="password"
              error={passwordForm.formState.errors.newPassword?.message}
              {...passwordForm.register('newPassword')}
            />
            <Input
              label="Confirm new password"
              type="password"
              error={passwordForm.formState.errors.confirm?.message}
              {...passwordForm.register('confirm')}
            />
            <Button type="submit" size="sm" loading={changePassword.isPending}>
              Update password
            </Button>
          </form>
        </div>
      )}

      <div className="rounded-xl border bg-white p-5 dark:bg-slate-900 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium">Personal access tokens</h2>
            <p className="text-sm text-slate-500">
              Used by the browser extension to import job postings.
            </p>
          </div>
          <Button size="sm" onClick={() => setTokenModalOpen(true)}>
            Generate token
          </Button>
        </div>

        {tokens && tokens.length === 0 && (
          <p className="text-sm text-slate-500">No tokens yet.</p>
        )}

        {tokens && tokens.length > 0 && (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {tokens.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-slate-500">
                    Created {formatDate(t.createdAt)} &middot;{' '}
                    {t.lastUsedAt
                      ? `Last used ${formatRelative(t.lastUsedAt)}`
                      : 'Never used'}{' '}
                    &middot; Expires {formatDate(t.expiresAt)}
                  </p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  loading={pendingRevokeIds.has(t.id)}
                  onClick={() => setRevokeTarget(t)}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-red-200 bg-white p-5 dark:border-red-900 dark:bg-slate-900 space-y-3">
        <h2 className="font-medium text-red-600 dark:text-red-400">
          Danger Zone
        </h2>
        <p className="text-sm text-slate-500">
          This will permanently delete your account and all job data.
        </p>
        <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
          Delete account
        </Button>
      </div>

      <Modal
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        title="Revoke token?"
        description={
          revokeTarget
            ? `"${revokeTarget.name}" will stop working immediately, including for the browser extension. This can't be undone.`
            : undefined
        }
      >
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => setRevokeTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={() => revokeTarget && confirmRevoke(revokeTarget.id)}
          >
            Yes, revoke token
          </Button>
        </div>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete account?"
        description="This action cannot be undone. All your jobs and data will be permanently deleted."
      >
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => setDeleteOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={deleteAccount.isPending}
            onClick={() => deleteAccount.mutate()}
          >
            Yes, delete my account
          </Button>
        </div>
      </Modal>

      <Modal
        open={tokenModalOpen}
        onClose={closeTokenModal}
        title={createdToken ? 'Token created' : 'Generate access token'}
        description={
          createdToken
            ? "Copy this now — it won't be shown again."
            : 'Give it a name so you can recognize it later, e.g. "Chrome extension".'
        }
      >
        {createdToken ? (
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 select-all break-all rounded-lg border bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800">
                {createdToken.token}
              </code>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => copyToken(createdToken.token)}
              >
                Copy
              </Button>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={closeTokenModal}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={tokenNameForm.handleSubmit((d) =>
              createToken.mutate(d.name, {
                onSuccess: (token) => setCreatedToken(token),
              }),
            )}
            className="space-y-4 pt-2"
          >
            <Input
              id="token-name"
              label="Name"
              placeholder="Chrome extension"
              error={tokenNameForm.formState.errors.name?.message}
              {...tokenNameForm.register('name')}
            />
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="secondary"
                onClick={closeTokenModal}
              >
                Cancel
              </Button>
              <Button type="submit" loading={createToken.isPending}>
                Generate
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
