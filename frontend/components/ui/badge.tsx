import { cn } from '../../lib/utils';
import {
  Priority,
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
  CITY_COLORS,
  CITY_LABELS,
  BUSINESS_MODE_COLORS,
  BUSINESS_MODE_LABELS,
  type ApplicationChannel,
  type DiscoverySource,
  type JobStatus,
  type JobType,
  type CompanyCity,
  type BusinessMode,
  type EnrichmentStatus,
} from '../../types';

/** Props for `StatusBadge`. */
interface BadgeProps {
  status: JobStatus;
  className?: string;
}

/** Props for `PriorityBadge`. */
interface PriorityBadgeProps {
  priority: Priority;
  className?: string;
}

/** Props for `JobTypeBadge`. */
interface JobTypeBadgeProps {
  jobType: JobType;
  className?: string;
}

/** Colored label for a job status. */
export function StatusBadge({ status, className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border border-line/70 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide',
        STATUS_COLORS[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Colored label for a company priority. */
export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border border-line/70 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide',
        PRIORITY_COLORS[priority],
        className,
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

/** Colored label for a job type. */
export function JobTypeBadge({ jobType, className }: JobTypeBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border border-line/70 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide',
        JOB_TYPE_COLORS[jobType],
        className,
      )}
    >
      {JOB_TYPE_LABELS[jobType]}
    </span>
  );
}

/** Props for `SourceBadge`: a discovery source or an application channel. */
type SourceBadgeProps =
  | { kind: 'discovery'; source: DiscoverySource; className?: string }
  | { kind: 'channel'; source: ApplicationChannel; className?: string };

/** Colored label for where a job was found or how it was applied to. */
export function SourceBadge({ kind, source, className }: SourceBadgeProps) {
  const colors =
    kind === 'discovery' ? DISCOVERY_SOURCE_COLORS : APPLICATION_CHANNEL_COLORS;
  const labels =
    kind === 'discovery' ? DISCOVERY_SOURCE_LABELS : APPLICATION_CHANNEL_LABELS;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border border-line/70 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide',
        colors[source as keyof typeof colors],
        className,
      )}
    >
      {labels[source as keyof typeof labels]}
    </span>
  );
}

/** Colored label for a company's city. */
export function CityBadge({
  city,
  className,
}: {
  city: CompanyCity;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border border-line/70 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide',
        CITY_COLORS[city],
        className,
      )}
    >
      {CITY_LABELS[city]}
    </span>
  );
}

/** Colored label for a company's business mode. */
export function BusinessModeBadge({
  businessMode,
  className,
}: {
  businessMode: BusinessMode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border border-line/70 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide',
        BUSINESS_MODE_COLORS[businessMode],
        className,
      )}
    >
      {BUSINESS_MODE_LABELS[businessMode]}
    </span>
  );
}

/** Display label for each enrichment status. */
const ENRICHMENT_STATUS_LABELS: Record<EnrichmentStatus, string> = {
  PENDING: 'Queued',
  PROCESSING: 'Researching…',
  COMPLETED: 'Researched',
  FAILED: 'Research failed',
};

/** Badge classes for each enrichment status, light and dark. */
const ENRICHMENT_STATUS_COLORS: Record<EnrichmentStatus, string> = {
  PENDING: 'bg-paper-raised text-muted',
  PROCESSING:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  COMPLETED:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

/** Colored label for an enrichment status; `null` reads "Not researched". */
export function EnrichmentStatusBadge({
  status,
  className,
}: {
  status: EnrichmentStatus | null;
  className?: string;
}) {
  if (!status) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-sm border border-line/70 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide',
          'bg-paper-raised text-muted-2',
          className,
        )}
      >
        Not researched
      </span>
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border border-line/70 px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide',
        ENRICHMENT_STATUS_COLORS[status],
        className,
      )}
    >
      {ENRICHMENT_STATUS_LABELS[status]}
    </span>
  );
}
