import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '../../lib/api';
import { clearAuthStorage, useAuthStore } from '../../store/auth.store';
import type { DigestFrequency } from '../../types';

/** The signed-in user's profile and notification settings. */
export function useProfileQuery() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get('/users/me').then((r) => r.data),
  });
}

/**
 * Updates the user's name, and copies the result into the auth store so the
 * sidebar reflects it immediately.
 */
export function useUpdateProfileMutation() {
  const { setUser } = useAuthStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string }) =>
      api.patch('/users/me', data).then((r) => r.data),
    onSuccess: (updated) => {
      setUser(updated);
      qc.invalidateQueries({ queryKey: ['profile'] });
      toast.success('Profile updated');
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to update')),
  });
}

/** Body for updating reminder, digest and timezone settings. */
export interface NotificationsUpdate {
  interviewRemindersEnabled: boolean;
  digestFrequency: DigestFrequency;
  timezone: string;
}

/** Updates reminder, digest and timezone settings. */
export function useUpdateNotificationsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: NotificationsUpdate) =>
      api.patch('/users/me/notifications', data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      toast.success('Notification preferences updated');
    },
    onError: (err: unknown) =>
      toast.error(
        getErrorMessage(err, 'Failed to update notification preferences'),
      ),
  });
}

/**
 * Changes the password. `confirm` is accepted for the form's convenience but
 * never sent.
 */
export function useChangePasswordMutation(onChanged?: () => void) {
  return useMutation({
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
      onChanged?.();
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Failed to change password')),
  });
}

/** Deletes the account, clears the session and reloads onto `/login`. */
export function useDeleteAccountMutation() {
  return useMutation({
    mutationFn: () => api.delete('/users/me'),
    onSuccess: () => {
      // Storage only, never the store - see clearAuthStorage.
      clearAuthStorage();
      // Full document load on purpose — the account is gone, so every cached
      // query and store slice describing it goes with it. Same reasoning as
      // the sign-out path in components/layout/sidebar.tsx; CONSTRAINTS.md E5.
      window.location.href = '/login';
    },
    onError: () => toast.error('Failed to delete account'),
  });
}
