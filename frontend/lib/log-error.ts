// Shared by the three error boundaries (`app/error.tsx`,
// `app/(dashboard)/error.tsx`, `app/global-error.tsx`). Console-only — there
// is no remote error sink — so the point is to make what lands in a browser
// console enough to act on from a screenshot: which boundary caught it, what
// the user was looking at, and the `digest` that ties a production error back
// to the server-side stack Next.js logged and stripped from the client bundle.
export function logBoundaryError(
  error: Error & { digest?: string },
  boundary: string,
) {
  console.error(
    `[${boundary}]`,
    {
      message: error.message,
      digest: error.digest,
      // Guarded because `global-error.tsx` also covers root-layout failures, and
      // the effect body is the only place in these files that touches `window`.
      path:
        typeof window === 'undefined' ? undefined : window.location.pathname,
      at: new Date().toISOString(),
      // The error object last, so devtools still renders the expandable stack.
    },
    error,
  );
}
