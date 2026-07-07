import { cn } from '../../lib/utils';
import {
  JobPriority,
  JOB_TYPE_COLORS,
  JOB_TYPE_LABELS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  type JobStatus,
  type JobType,
} from '../../types';

interface BadgeProps {
  status: JobStatus;
  className?: string;
}

interface PriorityBadgeProps {
  priority: JobPriority;
  className?: string;
}

interface JobTypeBadgeProps {
  jobType: JobType;
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

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        PRIORITY_COLORS[priority],
        className,
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export function JobTypeBadge({ jobType, className }: JobTypeBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        JOB_TYPE_COLORS[jobType],
        className,
      )}
    >
      {JOB_TYPE_LABELS[jobType]}
    </span>
  );
}
