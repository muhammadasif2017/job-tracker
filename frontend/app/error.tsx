'use client';

import { useEffect } from 'react';
import { Button } from '../components/ui/button';

export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h2 className="font-display text-lg font-semibold text-ink">Something went wrong</h2>
      <p className="text-sm text-muted">
        An unexpected error occurred. Try again or head back to the
        dashboard.
      </p>
      <Button onClick={() => unstable_retry()}>Try again</Button>
    </div>
  );
}
