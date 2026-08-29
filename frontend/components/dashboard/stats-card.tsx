import { cn } from '../../lib/utils';
import { Skeleton, LoadingStatus } from '../ui/skeleton';

interface StatsCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  className?: string;
  loading?: boolean;
}

export function StatsCard({
  label,
  value,
  sub,
  icon,
  className,
  loading,
}: StatsCardProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md border border-line bg-paper p-5',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-[11px] font-medium uppercase tracking-wide text-muted">
          {label}
        </p>
        <div className="text-muted-2">{icon}</div>
      </div>
      {loading ? (
        <LoadingStatus label="Loading stat">
          <Skeleton className="mt-3 h-8 w-20" />
        </LoadingStatus>
      ) : (
        <p className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink">
          {value}
        </p>
      )}
      {sub && <p className="mt-1 text-xs text-muted">{sub}</p>}
      <span className="absolute inset-x-0 bottom-0 h-0.5 bg-accent-2/60" aria-hidden="true" />
    </div>
  );
}
