import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import api, { getErrorMessage } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';
import type { DigestFrequency } from '../../types';

export function useProfileQuery() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get('/users/me').then((r) => r.data),
  });
}

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

export interface NotificationsUpdate {
  interviewRemindersEnabled: boolean;
  digestFrequency: DigestFrequency;
  timezone: string;
}

export function useUpdateNotificationsMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: NotificationsUpdate) =>
      api.patch('/users/me/notifications', data).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      toast.success('Notification preferences updated');
    },
    onError: () => toast.error('Failed to update notification preferences'),
  });
}

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

export function useDeleteAccountMutation() {
  const { logout } = useAuthStore();
  const router = useRouter();
  return useMutation({
    mutationFn: () => api.delete('/users/me'),
    onSuccess: () => {
      logout();
      router.replace('/login');
    },
    onError: () => toast.error('Failed to delete account'),
  });
}
