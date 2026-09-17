/** Every job status, in pipeline order. */
export const JOB_STATUSES = [
  'WISHLIST',
  'APPLIED',
  'INTERVIEWING',
  'OFFER',
  'REJECTED',
  'GHOSTED',
] as const;

/** Where a job application stands. */
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Every company priority, lowest first. */
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;

/** How much the user wants a target company. */
export type Priority = (typeof PRIORITIES)[number];

/** Every job work arrangement. */
export const JOB_TYPES = ['ONSITE', 'HYBRID', 'REMOTE'] as const;

/** Where the work happens: on site, hybrid or remote. */
export type JobType = (typeof JOB_TYPES)[number];

/** Every place a job can have been found. */
export const DISCOVERY_SOURCES = [
  'LINKEDIN',
  'LINKEDIN_JOBS',
  'GOOGLE_SEARCH',
  'INDEED',
  'ROZEE',
  'REFERRAL',
  'CAREER_EMAIL',
  'JOBLEADS',
  'TARAKI',
  'OTHER',
] as const;

/** Where the user found the job. */
export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

/** Every way an application can have been sent. */
export const APPLICATION_CHANNELS = [
  'COMPANY_WEBSITE',
  'ATS',
  'LINKEDIN',
  'INDEED',
  'ROZEE',
  'REFERRAL',
  'CAREER_EMAIL',
  'TARAKI',
  'OTHER',
] as const;

/** How the user sent the application. */
export type ApplicationChannel = (typeof APPLICATION_CHANNELS)[number];

/** What a timeline event records. */
export type JobEventType =
  'CREATED' | 'STATUS_CHANGE' | 'INTERVIEW_ROUND_ADDED';

/** One entry in a job's activity timeline. */
export interface JobEvent {
  id: string;
  jobId: string;
  type: JobEventType;
  fromStatus?: JobStatus;
  toStatus: JobStatus;
  note?: string;
  createdAt: string;
}

/** State of an AI enrichment run. */
export type EnrichmentStatus =
  'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

/** Enrichment data for a job's linked company. */
export interface CompanyProfile {
  id: string;
  jobId: string;
  /**
   * Nullable for the same reason `Company.status` is — null means enrichment
   * was never triggered, which is not the same as a queued PENDING run. The
   * job-detail response used to coerce it to PENDING and hide the Refresh
   * button behind a permanent "Queued…" spinner.
   */
  status: EnrichmentStatus | null;
  industry?: string | null;
  companySize?: string | null;
  techStack: string[];
  cultureSummary?: string | null;
  productDescription?: string | null;
  businessMode?: BusinessMode | null;
  errorMessage?: string | null;
  enrichedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Metadata for the resume attached to a job. */
export interface Resume {
  id: string;
  jobId: string;
  originalName: string;
  size: number;
  createdAt: string;
}

/** Stored result of an interview round. */
export type InterviewOutcome = 'PENDING' | 'PASSED' | 'FAILED' | 'CANCELLED';

/**
 * Display status of an interview round.
 *
 * Computed by the backend, not stored — splits PENDING into three states
 * based on scheduledAt vs now (see backend interview-round-status.util.ts).
 * A resolved outcome (PASSED/FAILED/CANCELLED) passes through unchanged.
 */
export type InterviewRoundDerivedStatus =
  | 'SCHEDULED'
  | 'AWAITING_RESPONSE'
  | 'POSSIBLY_GHOSTED'
  | 'PASSED'
  | 'FAILED'
  | 'CANCELLED';

/** One interview round on a job. */
export interface InterviewRound {
  id: string;
  jobId: string;
  stage: string;
  scheduledAt: string;
  /**
   * How long the interview runs. null only for rounds created before ADR-043;
   * every round created since carries a length the user typed.
   */
  durationMinutes?: number | null;
  outcome: InterviewOutcome;
  derivedStatus: InterviewRoundDerivedStatus;
  notes?: string | null;
  /**
   * LLM-generated talking points/questions for this round, produced from the
   * debrief notes on the previously-completed round for the same job.
   */
  prepSuggestions?: string | null;
  prepGeneratedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A contact attached to exactly one of a job or a company. */
export interface Contact {
  id: string;
  /**
   * Exactly one is set — a job-scoped contact has companyId: null and vice
   * versa. See docs/specs/target-companies.md Assumption 7.
   */
  jobId?: string | null;
  companyId?: string | null;
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A target company whose name matched a newly created job's company. */
export interface MatchedCompany {
  id: string;
  name: string;
}

/** A job application, with related records where the endpoint loads them. */
export interface Job {
  id: string;
  company: string;
  position: string;
  location?: string;
  url?: string;
  status: JobStatus;
  jobType: JobType;
  discoverySource?: DiscoverySource | null;
  applicationChannel?: ApplicationChannel | null;
  notes?: string;
  appliedAt: string;
  nextInterviewAt?: string;
  /**
   * LLM-generated one-line plain-English summary of this job's event
   * timeline, regenerated asynchronously after each status change.
   */
  timelineSummary?: string | null;
  timelineSummaryAt?: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  companyId?: string | null;
  companyProfile?: CompanyProfile;
  resume?: Resume | null;
  interviewRounds?: InterviewRound[];
  contacts?: Contact[];
  /** Only present on the POST /jobs (create) response — see MatchedCompany. */
  matchedCompany?: MatchedCompany | null;
}

/** Account role; ADMIN unlocks the admin pages. */
export type Role = 'USER' | 'ADMIN';

/** Every digest email frequency. */
export const DIGEST_FREQUENCIES = ['OFF', 'DAILY', 'WEEKLY'] as const;

/** How often the user gets the attention digest email. */
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

/** Display label for each digest frequency. */
export const DIGEST_FREQUENCY_LABELS: Record<DigestFrequency, string> = {
  OFF: 'Off',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
};

/**
 * The signed-in user. Profile and notification fields are present only where
 * the endpoint returns them.
 */
export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role?: Role;
  hasPassword?: boolean;
  connectedProviders?: string[];
  interviewRemindersEnabled?: boolean;
  digestFrequency?: DigestFrequency;
  timezone?: string;
}

/** One row in the admin user list. */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  jobCount: number;
}

/** One page of the admin user list. */
export interface PaginatedAdminUsers {
  data: AdminUser[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * Outdated and unused: sign-in responses now return only `accessToken`, with
 * the refresh token in an httpOnly cookie.
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Why a job needs attention. */
export type AttentionType =
  'UPCOMING_INTERVIEW' | 'STALE_INTERVIEWING' | 'STALE_APPLIED';

/** One "Needs attention" entry: the reason, since when, and the job. */
export interface AttentionItem {
  type: AttentionType;
  since: string;
  job: Job;
}

/**
 * One "Looks ghosted" suggestion.
 *
 * A job with no activity for 14 days that may be ghosted (suggest-only).
 * `since` is the last activity: latest event, last dismissal, or applied date.
 */
export interface GhostSuggestion {
  since: string;
  job: Job;
}

/** Headline dashboard stats. */
export interface JobStats {
  total: number;
  byStatus: Record<JobStatus, number>;
  thisMonth: number;
  responseRate: number;
  ghostRate: number;
}

/** Statuses a job moves forward through, in funnel order. */
export const FUNNEL_STAGES = [
  'WISHLIST',
  'APPLIED',
  'INTERVIEWING',
  'OFFER',
] as const;

/** Funnel, drop-off, time-in-stage and response-insight stats. */
export interface FunnelStats {
  funnel: { status: (typeof FUNNEL_STAGES)[number]; reached: number }[];
  dropoff: { status: 'REJECTED' | 'GHOSTED'; count: number }[];
  avgTimeInStageDays: Partial<Record<JobStatus, number>>;
  /**
   * Response rates count any job that ever replied, even if it later went
   * ghosted. By channel = where the application was sent; by discovery
   * source = where the job was found.
   */
  responseRateBySource: {
    source: ApplicationChannel | 'UNSPECIFIED';
    total: number;
    responseRate: number;
  }[];
  responseRateByDiscoverySource: {
    source: DiscoverySource | 'UNSPECIFIED';
    total: number;
    responseRate: number;
  }[];
  /**
   * Days from applying to the first reply. medianDays is null with no dated
   * replies; jobs added straight into a replied status have no reply date.
   */
  replyTiming: {
    repliedCount: number;
    medianDays: number | null;
    repliedAfter14DaysPercent: number;
  };
}

/** Time window for dashboard stats. */
export type DashboardRange = '30d' | '90d' | 'all';

/** Options for the dashboard range selector. */
export const DASHBOARD_RANGES: { value: DashboardRange; label: string }[] = [
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'all', label: 'All' },
];

/** One period in the applications trend chart. */
export interface TrendBucket {
  label: string;
  periodStart: string;
  count: number;
  cumulative: number;
}

/** The applications trend chart data. */
export interface TrendStats {
  granularity: 'day' | 'week' | 'month';
  buckets: TrendBucket[];
}

/** One page of jobs. */
export interface PaginatedJobs {
  data: Job[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/** Query parameters for the jobs list endpoint. */
export interface JobQuery {
  status?: JobStatus;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  dateFrom?: string;
  dateTo?: string;
}

/** Display label for each priority. */
export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

/** Badge classes for each priority, light and dark. */
export const PRIORITY_COLORS: Record<Priority, string> = {
  LOW: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  MEDIUM:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  HIGH: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

/** Display label for each discovery source. */
export const DISCOVERY_SOURCE_LABELS: Record<DiscoverySource, string> = {
  LINKEDIN: 'LinkedIn Post',
  LINKEDIN_JOBS: 'LinkedIn Jobs',
  GOOGLE_SEARCH: 'Google Search',
  INDEED: 'Indeed',
  ROZEE: 'Rozee.pk',
  REFERRAL: 'Referral',
  CAREER_EMAIL: 'Career Email',
  JOBLEADS: 'JobLeads',
  TARAKI: 'Taraki',
  OTHER: 'Other',
};

/** Badge classes for each discovery source, light and dark. */
export const DISCOVERY_SOURCE_COLORS: Record<DiscoverySource, string> = {
  LINKEDIN: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  LINKEDIN_JOBS:
    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  GOOGLE_SEARCH:
    'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  INDEED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  ROZEE: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  REFERRAL: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  CAREER_EMAIL:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  JOBLEADS:
    'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  TARAKI:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  OTHER: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

/** Display label for each application channel. */
export const APPLICATION_CHANNEL_LABELS: Record<ApplicationChannel, string> = {
  COMPANY_WEBSITE: 'Company Website',
  ATS: 'ATS (Greenhouse, etc.)',
  LINKEDIN: 'LinkedIn',
  INDEED: 'Indeed',
  ROZEE: 'Rozee.pk',
  REFERRAL: 'Referral',
  CAREER_EMAIL: 'Career Email',
  TARAKI: 'Taraki',
  OTHER: 'Other',
};

/** Badge classes for each application channel, light and dark. */
export const APPLICATION_CHANNEL_COLORS: Record<ApplicationChannel, string> = {
  COMPANY_WEBSITE:
    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  ATS: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  LINKEDIN: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  INDEED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  ROZEE: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  REFERRAL: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300',
  CAREER_EMAIL:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  TARAKI:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  OTHER: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

/** Display label for each job type. */
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  ONSITE: 'Onsite',
  HYBRID: 'Hybrid',
  REMOTE: 'Remote',
};

/** Badge classes for each job type, light and dark. */
export const JOB_TYPE_COLORS: Record<JobType, string> = {
  ONSITE: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  HYBRID:
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  REMOTE:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

/** Display label for each job status. */
export const STATUS_LABELS: Record<JobStatus, string> = {
  WISHLIST: 'Wishlist',
  APPLIED: 'Applied',
  INTERVIEWING: 'Interviewing',
  OFFER: 'Offer',
  REJECTED: 'Rejected',
  GHOSTED: 'Ghosted',
};

/** Badge classes for each job status, light and dark. */
export const STATUS_COLORS: Record<JobStatus, string> = {
  WISHLIST: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  APPLIED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  INTERVIEWING:
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  OFFER:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  REJECTED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  GHOSTED:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

/**
 * Display label for the derived round statuses that get a badge.
 *
 * Only SCHEDULED/AWAITING_RESPONSE/POSSIBLY_GHOSTED need a badge in the
 * interview rounds list — PASSED/FAILED/CANCELLED are already shown via the
 * outcome <select>.
 */
export const DERIVED_STATUS_LABELS: Partial<
  Record<InterviewRoundDerivedStatus, string>
> = {
  SCHEDULED: 'Scheduled',
  AWAITING_RESPONSE: 'Awaiting response',
  POSSIBLY_GHOSTED: 'Possibly ghosted',
};

/** Badge classes for the derived round statuses that get a badge. */
export const DERIVED_STATUS_COLORS: Partial<
  Record<InterviewRoundDerivedStatus, string>
> = {
  SCHEDULED:
    'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  AWAITING_RESPONSE:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  POSSIBLY_GHOSTED:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

// Two shapes for the same six status colors, because the consumers need
// different things. Both resolve to the --status-* tokens in globals.css, so
// they follow the theme; the old raw-hex map did not — it held the dark-mode
// values and rendered them unchanged in light mode, where several fell below
// the 3:1 bar for a non-text UI element.

/**
 * CSS color variable for each job status.
 *
 * For CSS contexts: inline style, where var() resolves normally.
 */
export const STATUS_DOT_VARS: Record<JobStatus, string> = {
  WISHLIST: 'var(--status-wishlist)',
  APPLIED: 'var(--status-applied)',
  INTERVIEWING: 'var(--status-interviewing)',
  OFFER: 'var(--status-offer)',
  REJECTED: 'var(--status-rejected)',
  GHOSTED: 'var(--status-ghosted)',
};

/**
 * SVG fill class for each job status.
 *
 * For recharts <Cell>: var() does NOT resolve inside an SVG `fill=`
 * presentation attribute, so pass a class instead — a CSS `fill` declaration
 * does resolve it, and an author rule outranks the attribute.
 */
export const STATUS_FILL_CLASSES: Record<JobStatus, string> = {
  WISHLIST: 'fill-status-wishlist',
  APPLIED: 'fill-status-applied',
  INTERVIEWING: 'fill-status-interviewing',
  OFFER: 'fill-status-offer',
  REJECTED: 'fill-status-rejected',
  GHOSTED: 'fill-status-ghosted',
};

// --- Target Companies ---
// See docs/specs/target-companies.md — standalone company list, independent
// of any Job, with its own parallel AI-enrichment pipeline.

/** Every city a target company can be in. */
export const COMPANY_CITIES = [
  'LAHORE',
  'ISLAMABAD',
  'KARACHI',
  'OTHER',
] as const;

/** City a target company is in. */
export type CompanyCity = (typeof COMPANY_CITIES)[number];

/** Display label for each city. */
export const CITY_LABELS: Record<CompanyCity, string> = {
  LAHORE: 'Lahore',
  ISLAMABAD: 'Islamabad',
  KARACHI: 'Karachi',
  OTHER: 'Other',
};

/** Badge classes for each city, light and dark. */
export const CITY_COLORS: Record<CompanyCity, string> = {
  LAHORE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  ISLAMABAD:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  KARACHI:
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  OTHER: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

/** Every company business mode. */
export const BUSINESS_MODES = ['PRODUCT', 'SERVICES', 'HYBRID'] as const;

/** Whether a company sells a product, services, or both. */
export type BusinessMode = (typeof BUSINESS_MODES)[number];

/** Display label for each business mode. */
export const BUSINESS_MODE_LABELS: Record<BusinessMode, string> = {
  PRODUCT: 'Product',
  SERVICES: 'Services',
  HYBRID: 'Hybrid',
};

/** Badge classes for each business mode, light and dark. */
export const BUSINESS_MODE_COLORS: Record<BusinessMode, string> = {
  PRODUCT:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  SERVICES: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  HYBRID:
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

/**
 * A job as listed on a company page.
 *
 * Phase 6 (docs/specs/company-fk-phase6.md) — lean projection returned by
 * GET /companies/:id, not the full Job shape.
 */
export interface CompanyJobSummary {
  id: string;
  position: string;
  status: JobStatus;
  appliedAt: string;
}

/**
 * Per-company application counts and reply rate.
 *
 * docs/specs/company-reply-history.md — WISHLIST jobs excluded; `replied` and
 * `ghosted` can overlap (a job that replied, then went silent).
 */
export interface CompanyApplicationStats {
  applied: number;
  replied: number;
  ghosted: number;
  replyRate: number;
  lastAppliedAt: string | null;
}

/**
 * The user's past applications to a company, matched by name.
 *
 * GET /companies/application-history — backs the job-create confirm.
 */
export interface CompanyApplicationHistory {
  company: { id: string; name: string } | null;
  stats: CompanyApplicationStats | null;
  recentJobs: {
    id: string;
    position: string;
    status: JobStatus;
    appliedAt: string;
  }[];
}

/** A target company with its enrichment fields. */
export interface Company {
  id: string;
  name: string;
  city: CompanyCity;
  location?: string | null;
  priority: Priority;
  personalNotes?: string | null;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  businessMode?: BusinessMode | null;
  productDescription?: string | null;
  /** null = enrichment never triggered (distinct from PENDING/PROCESSING) */
  status: EnrichmentStatus | null;
  industry?: string | null;
  companySize?: string | null;
  techStack: string[];
  cultureSummary?: string | null;
  errorMessage?: string | null;
  enrichedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  contacts?: Contact[];
  jobs?: CompanyJobSummary[];
  /** Only the read endpoints (list and detail) compute it. */
  applicationStats?: CompanyApplicationStats;
}

/** One page of companies. */
export interface PaginatedCompanies {
  data: Company[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

/**
 * A pair of companies that look like duplicates.
 *
 * Phase 5c (docs/specs/company-fk-phase5c.md)
 */
export interface DuplicateSuggestion {
  companyA: Company;
  companyB: Company;
  reason: 'website' | 'name';
}

/** Query parameters for the companies list endpoint. */
export interface CompanyQuery {
  page?: number;
  limit?: number;
  city?: CompanyCity | '';
  priority?: Priority | '';
  search?: string;
}

/** One rejected CSV row and why. */
export interface CsvImportError {
  row: number;
  message: string;
}

/** Result of a company CSV import. */
export interface CsvImportResult {
  imported: number;
  errors: CsvImportError[];
}

/** Job counts for one BullMQ queue, by state. */
export interface QueueCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

/** One queue on the admin queues page. */
export interface QueueSnapshot {
  name: string;
  /** False when BullMQ was unreachable; `counts` is null in that case. */
  available: boolean;
  counts: QueueCounts | null;
}

/** Number of companies in one enrichment status, across all users. */
export interface CompanyStatusBucket {
  /** Raw Company.status. `null` means enrichment was never triggered. */
  status: EnrichmentStatus | null;
  label: string;
  count: number;
}

/** The admin queues page data. */
export interface QueueObservability {
  queues: QueueSnapshot[];
  companyStatuses: CompanyStatusBucket[];
  /**
   * Companies stuck at PENDING with no matching enrichment job in Redis.
   * Null when the enrichment queue is unavailable — the subtraction would
   * otherwise flag every legitimately queued row.
   */
  strandedPending: number | null;
}
