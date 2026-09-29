import { cn } from '../../lib/utils';
import {
  Priority,
  JOB_TYPE_LABELS,
  PRIORITY_COLORS,
  PRIORITY_LABELS,
  DISCOVERY_SOURCE_LABELS,
  APPLICATION_CHANNEL_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  CITY_LABELS,
  BUSINESS_MODE_LABELS,
  ROLE_LABELS,
  type ApplicationChannel,
  type DiscoverySource,
  type JobStatus,
  type JobType,
  type CompanyCity,
  type BusinessMode,
  type EnrichmentStatus,
  type Role,
} from '../../types';

/** Props for `Chip`. */
interface ChipProps {
  /** Background class for a leading dot; no dot when omitted. */
  dot?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * The one chip every badge draws: neutral fill, ink label, and an optional
 * colored dot for enums whose value carries meaning (status, priority,
 * research state). Keeping color to the dot is what lets a row of badges read
 * as one system instead of a wall of tints.
 */
function Chip({ dot, className, children }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border border-line/70 bg-paper-raised px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide text-ink',
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden="true"
          data-testid="badge-dot"
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', dot)}
        />
      )}
      {children}
    </span>
  );
}

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

/** Label for a job status, with a dot in the status token color. */
export function StatusBadge({ status, className }: BadgeProps) {
  return (
    <Chip dot={STATUS_COLORS[status]} className={className}>
      {STATUS_LABELS[status]}
    </Chip>
  );
}

/** Label for a company priority, with a dot for how pressing it is. */
export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  return (
    <Chip dot={PRIORITY_COLORS[priority]} className={className}>
      {PRIORITY_LABELS[priority]}
    </Chip>
  );
}

/** Label for a job type. */
export function JobTypeBadge({ jobType, className }: JobTypeBadgeProps) {
  return <Chip className={className}>{JOB_TYPE_LABELS[jobType]}</Chip>;
}

/** Props for `SourceBadge`: a discovery source or an application channel. */
type SourceBadgeProps =
  | { kind: 'discovery'; source: DiscoverySource; className?: string }
  | { kind: 'channel'; source: ApplicationChannel; className?: string };

/** Label for where a job was found or how it was applied to. */
export function SourceBadge({ kind, source, className }: SourceBadgeProps) {
  const labels =
    kind === 'discovery' ? DISCOVERY_SOURCE_LABELS : APPLICATION_CHANNEL_LABELS;
  return (
    <Chip className={className}>{labels[source as keyof typeof labels]}</Chip>
  );
}

/** Label for a company's city. */
export function CityBadge({
  city,
  className,
}: {
  city: CompanyCity;
  className?: string;
}) {
  return <Chip className={className}>{CITY_LABELS[city]}</Chip>;
}

/** Label for a company's business mode. */
export function BusinessModeBadge({
  businessMode,
  className,
}: {
  businessMode: BusinessMode;
  className?: string;
}) {
  return (
    <Chip className={className}>{BUSINESS_MODE_LABELS[businessMode]}</Chip>
  );
}

/**
 * Label for an account role. No dot and no tint: ADR-054 keeps color for
 * values that are states (status, priority, research), and a role is not one.
 * The admin users page used to tint ADMIN with its own hand-rolled chip.
 */
export function RoleBadge({
  role,
  className,
}: {
  role: Role;
  className?: string;
}) {
  return <Chip className={className}>{ROLE_LABELS[role]}</Chip>;
}

/** Display label for each enrichment status. */
const ENRICHMENT_STATUS_LABELS: Record<EnrichmentStatus, string> = {
  PENDING: 'Queued',
  PROCESSING: 'Researching…',
  COMPLETED: 'Researched',
  FAILED: 'Research failed',
};

/** Dot color class for each enrichment status. */
const ENRICHMENT_STATUS_COLORS: Record<EnrichmentStatus, string> = {
  PENDING: 'bg-muted-2',
  PROCESSING: 'bg-warning',
  COMPLETED: 'bg-success',
  FAILED: 'bg-danger',
};

/** Label for an enrichment status; `null` reads "Not researched". */
export function EnrichmentStatusBadge({
  status,
  className,
}: {
  status: EnrichmentStatus | null;
  className?: string;
}) {
  if (!status) {
    return <Chip className={cn('text-muted', className)}>Not researched</Chip>;
  }
  return (
    <Chip dot={ENRICHMENT_STATUS_COLORS[status]} className={className}>
      {ENRICHMENT_STATUS_LABELS[status]}
    </Chip>
  );
}
