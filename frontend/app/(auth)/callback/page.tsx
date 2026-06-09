'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Spinner } from '../../../components/ui/spinner';
import { useAuthStore } from '../../../store/auth.store';
import api from '../../../lib/api';

function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    const code = params.get('code');
    const error = params.get('error');

    if (error || !code) {
      toast.error('Authentication failed. Please try again.');
      router.replace('/login');
      return;
    }

    api
      .post('/auth/exchange-code', { code })
      .then(({ data }) => {
        const { accessToken, refreshToken } = data;
        return api
          .get('/auth/me', {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          .then(({ data: user }) => {
            setAuth(user, accessToken, refreshToken);
            router.replace('/');
          });
      })
      .catch(() => {
        toast.error('Could not complete sign-in. Please try again.');
        router.replace('/login');
      });
  }, []);

  return null;
}

export default function CallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-8 w-8" />
        <p className="text-sm text-slate-500">Signing you in…</p>
        <Suspense>
          <CallbackHandler />
        </Suspense>
      </div>
    </div>
  );
}
