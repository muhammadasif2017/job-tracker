'use client';

import { useEffect } from 'react';
import { logBoundaryError } from '../lib/log-error';

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    logBoundaryError(error, 'global');
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          display: 'flex',
          minHeight: '100vh',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.75rem',
          padding: '1rem',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>
          Something went wrong
        </h2>
        <p style={{ fontSize: '0.875rem', color: '#8b97a3' }}>
          The application hit an unexpected error. Try reloading.
        </p>
        <button
          onClick={() => unstable_retry()}
          style={{
            borderRadius: '0.375rem',
            background: '#ff9f45',
            color: 'white',
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            fontWeight: 500,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
