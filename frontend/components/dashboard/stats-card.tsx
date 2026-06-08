import { cn } from '../../lib/utils';
import { Skeleton } from '../ui/skeleton';

interface StatsCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ReactNode;
  className?: string;
  loading?: boolean;
}

export function StatsCard({ label, value, sub, icon, className, loading }: StatsCardProps) {
  return (
    <div className={cn('rounded-xl border bg-white p-5 dark:bg-slate-900', className)}>
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
          {icon}
        </div>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-20" />
      ) : (
        <p className="mt-3 text-3xl font-bold tracking-tight">{value}</p>
      )}
      {sub && <p className="mt-1 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
