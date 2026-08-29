import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h2 className="font-display text-lg font-semibold text-ink">Page not found</h2>
      <p className="text-sm text-muted">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/"
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:brightness-110"
      >
        Back to dashboard
      </Link>
    </div>
  );
}
