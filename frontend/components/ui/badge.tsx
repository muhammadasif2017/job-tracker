import { cn } from '../../lib/utils';
import { STATUS_COLORS, STATUS_LABELS, type JobStatus } from '../../types';

interface BadgeProps {
  status: JobStatus;
  className?: string;
}

export function StatusBadge({ status, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        STATUS_COLORS[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
