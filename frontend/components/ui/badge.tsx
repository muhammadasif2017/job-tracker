import { cn } from '../../lib/utils';
import {
  JobPriority,
  JOB_TYPE_COLORS,
  JOB_TYPE_LABELS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  DISCOVERY_SOURCE_COLORS,
  DISCOVERY_SOURCE_LABELS,
  APPLICATION_CHANNEL_COLORS,
  APPLICATION_CHANNEL_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  type ApplicationChannel,
  type DiscoverySource,
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

type SourceBadgeProps =
  | { kind: 'discovery'; source: DiscoverySource; className?: string }
  | { kind: 'channel'; source: ApplicationChannel; className?: string };

export function SourceBadge({ kind, source, className }: SourceBadgeProps) {
  const colors =
    kind === 'discovery' ? DISCOVERY_SOURCE_COLORS : APPLICATION_CHANNEL_COLORS;
  const labels =
    kind === 'discovery' ? DISCOVERY_SOURCE_LABELS : APPLICATION_CHANNEL_LABELS;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        colors[source as keyof typeof colors],
        className,
      )}
    >
      {labels[source as keyof typeof labels]}
    </span>
  );
}
