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

  // This boundary replaces the root layout, so it never receives globals.css:
  // no Tailwind classes, and var(--token) would resolve to nothing. The values
  // below are therefore the literal *light-mode* values of --surface, --ink,
  // --muted, --accent and --accent-fg. It commits to the light palette rather
  // than following the theme (inline styles can't carry a media query, and the
  // pre-hydration script that sets .dark lives in the layout this replaces),
  // so every color is painted explicitly instead of inheriting a UA default
  // that may not match. Contrast: ink 17.26:1, muted 4.96:1, button 4.62:1.
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
          margin: 0,
          padding: '1rem',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#f7f8fa',
          color: '#10151b',
        }}
      >
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>
          Something went wrong
        </h2>
        <p style={{ fontSize: '0.875rem', color: '#626d7a' }}>
          The application hit an unexpected error. Try reloading.
        </p>
        <button
          onClick={() => unstable_retry()}
          style={{
            borderRadius: '0.375rem',
            border: 'none',
            background: '#b45e07',
            color: '#ffffff',
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
