'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Spinner } from '../../../components/ui/spinner';
import { useAuthStore } from '../../../store/auth.store';
import api from '../../../lib/api';

export default function CallbackPage() {
  const router = useRouter();
  const params = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    const accessToken = params.get('accessToken');
    const refreshToken = params.get('refreshToken');
    const error = params.get('error');

    if (error || !accessToken || !refreshToken) {
      toast.error('Authentication failed. Please try again.');
      router.replace('/login');
      return;
    }

    api
      .get('/auth/me', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(({ data: user }) => {
        setAuth(user, accessToken, refreshToken);
        router.replace('/');
      })
      .catch(() => {
        toast.error('Could not load your profile. Please try again.');
        router.replace('/login');
      });
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-8 w-8" />
        <p className="text-sm text-slate-500">Signing you in…</p>
      </div>
    </div>
  );
}
