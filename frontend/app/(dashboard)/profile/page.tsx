'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { Modal } from '../../../components/ui/modal';
import { useAuthStore } from '../../../store/auth.store';
import api from '../../../lib/api';

const profileSchema = z.object({ name: z.string().min(1, 'Name is required') });
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

export default function ProfilePage() {
  const { user: storeUser, setUser, logout } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get('/users/me').then((r) => r.data),
  });
  const user = profile ?? storeUser;

  const profileForm = useForm({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: storeUser?.name ?? '' },
  });
  const passwordForm = useForm({ resolver: zodResolver(passwordSchema) });

  const updateProfile = useMutation({
    mutationFn: (data: { name: string }) =>
      api.patch('/users/me', data).then((r) => r.data),
    onSuccess: (updated) => {
      setUser(updated);
      qc.invalidateQueries({ queryKey: ['profile'] });
      toast.success('Profile updated');
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message ?? 'Failed to update'),
  });

  const changePassword = useMutation({
    mutationFn: ({
      currentPassword,
      newPassword,
    }: {
      currentPassword: string;
      newPassword: string;
      confirm: string;
    }) => api.patch('/users/me/password', { currentPassword, newPassword }),
    onSuccess: () => {
      toast.success('Password changed');
      passwordForm.reset();
    },
    onError: (e: any) =>
      toast.error(e.response?.data?.message ?? 'Failed to change password'),
  });

  const deleteAccount = useMutation({
    mutationFn: () => api.delete('/users/me'),
    onSuccess: () => {
      logout();
      router.replace('/login');
    },
    onError: () => toast.error('Failed to delete account'),
  });

  const hasPassword = !profile || !profile.connectedProviders?.length;

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
          <div>
            <p className="font-medium">{user?.name}</p>
            <p className="text-sm text-slate-500">{user?.email}</p>
          </div>
        </div>
        <form
          onSubmit={profileForm.handleSubmit((d) => updateProfile.mutate(d))}
          className="space-y-4"
        >
          <Input
            label="Name"
            error={profileForm.formState.errors.name?.message}
            {...profileForm.register('name')}
          />
          <Button type="submit" size="sm" loading={updateProfile.isPending}>
            Save changes
          </Button>
        </form>
      </div>

      {user?.connectedProviders && user.connectedProviders.length > 0 && (
        <div className="rounded-xl border bg-white p-5 dark:bg-slate-900 space-y-3">
          <h2 className="font-medium">Connected Accounts</h2>
          {['google', 'github'].map((provider) => {
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
    </div>
  );
}
