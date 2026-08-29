import { Skeleton, LoadingStatus } from '../ui/skeleton';

export function ChartCard({
  title,
  loading,
  error,
  errorMessage,
  skeletonClassName = 'h-56 w-full',
  children,
}: {
  title: string;
  loading: boolean;
  error: boolean;
  errorMessage: string;
  skeletonClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-line bg-paper p-5">
      <h2 className="mb-4 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
        {title}
      </h2>
      {loading ? (
        <LoadingStatus label="Loading chart">
          <Skeleton className={skeletonClassName} />
        </LoadingStatus>
      ) : error ? (
        <p className="text-sm text-danger">{errorMessage}</p>
      ) : (
        children
      )}
    </div>
  );
}
