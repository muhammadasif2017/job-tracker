import { Skeleton } from '../ui/skeleton';

export function ChartCard({
  title,
  loading,
  error,
  errorMessage,
  children,
}: {
  title: string;
  loading: boolean;
  error: boolean;
  errorMessage: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-white p-5 dark:bg-slate-900">
      <h2 className="mb-4 text-sm font-semibold">{title}</h2>
      {loading ? (
        <Skeleton className="h-56 w-full" />
      ) : error ? (
        <p className="text-sm text-red-500">{errorMessage}</p>
      ) : (
        children
      )}
    </div>
  );
}
