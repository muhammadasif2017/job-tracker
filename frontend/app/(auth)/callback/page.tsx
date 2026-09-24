'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Spinner } from '../../../components/ui/spinner';
import { useAuthStore } from '../../../store/auth.store';
import api from '../../../lib/api';

/**
 * Shown when the backend's OAuth code store (Redis) is unreachable: either
 * the provider callback redirected here with `?error=unavailable`, or the
 * code exchange answered 503. It says to sign in again rather than retry,
 * because the one-time code may already be spent.
 */
const SIGN_IN_UNAVAILABLE =
  'Sign-in is temporarily unavailable. Please sign in again.';

/** True for a 503 from the code exchange: an outage, not a bad code. */
function isServiceUnavailable(err: unknown): boolean {
  return (err as { response?: { status?: number } })?.response?.status === 503;
}

/**
 * Trades the OAuth redirect's one-time code for tokens, loads the user, and
 * signs them in; any failure returns to `/login`.
 */
function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    const code = params.get('code');
    const error = params.get('error');

    if (error === 'unavailable') {
      toast.error(SIGN_IN_UNAVAILABLE);
      router.replace('/login');
      return;
    }
    if (error || !code) {
      toast.error('Authentication failed. Please try again.');
      router.replace('/login');
      return;
    }

    api
      .post('/auth/exchange-code', {
        code,
        // An OAuth account is created during the provider redirect, before any
        // browser code runs, so this is the first chance to tell the backend
        // the user's zone. It is only stored for an account this sign-in just
        // created; returning users keep the timezone they already have.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      .then(({ data }) => {
        const { accessToken } = data;
        return api
          .get('/auth/me', {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          .then(({ data: user }) => {
            setAuth(user, accessToken);
            router.replace('/');
          });
      })
      .catch((err: unknown) => {
        toast.error(
          isServiceUnavailable(err)
            ? SIGN_IN_UNAVAILABLE
            : 'Could not complete sign-in. Please try again.',
        );
        router.replace('/login');
      });
  }, [params, router, setAuth]);

  return null;
}

/** OAuth landing route (`/callback`): a spinner while the sign-in completes. */
export default function CallbackPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="h-8 w-8" />
        <p className="text-sm text-muted">Signing you in…</p>
        <Suspense>
          <CallbackHandler />
        </Suspense>
      </div>
    </div>
  );
}
