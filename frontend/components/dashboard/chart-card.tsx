import { Skeleton, LoadingStatus } from '../ui/skeleton';

/**
 * Size of the funnel chart's skeleton, matching the rendered funnel. Lives
 * here, not in the lazy chart module, so the page can use it without pulling
 * Recharts into its own bundle.
 */
export const FUNNEL_SKELETON_CLASS = 'h-[420px] w-full';

/**
 * Placeholder for a dashboard chart that is still loading, sized like the
 * chart it stands in for so nothing shifts when the chart appears.
 */
export function ChartSkeleton({
  className = 'h-56 w-full',
}: {
  className?: string;
}) {
  return (
    <LoadingStatus label="Loading chart">
      <Skeleton className={className} />
    </LoadingStatus>
  );
}

/**
 * Titled dashboard card that shows a message on error and its children
 * otherwise. The children show their own loading state: the dashboard's
 * charts render before their data arrives, so their lazy chunk starts
 * loading alongside the API calls.
 */
export function ChartCard({
  title,
  error,
  errorMessage,
  children,
}: {
  title: string;
  error: boolean;
  errorMessage: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-line bg-paper p-5">
      <h2 className="mb-4 text-sm font-semibold text-ink">{title}</h2>
      {error ? <p className="text-sm text-danger">{errorMessage}</p> : children}
    </div>
  );
}
