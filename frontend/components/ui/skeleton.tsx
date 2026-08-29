import { cn } from '../../lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-md bg-line',
        className,
      )}
    />
  );
}

// Wraps a block of decorative Skeletons so screen readers get one "loading"
// announcement instead of silence (the Skeletons themselves are aria-hidden).
export function LoadingStatus({
  label = 'Loading',
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
