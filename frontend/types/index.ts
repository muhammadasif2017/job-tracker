export const JOB_STATUSES = [
  'WISHLIST',
  'APPLIED',
  'INTERVIEWING',
  'OFFER',
  'REJECTED',
  'GHOSTED',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;

export type JobPriority = (typeof JOB_PRIORITIES)[number];

export const JOB_TYPES = ['ONSITE', 'HYBRID', 'REMOTE'] as const;

export type JobType = (typeof JOB_TYPES)[number];

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

export type DiscoverySource = (typeof DISCOVERY_SOURCES)[number];

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

export type ApplicationChannel = (typeof APPLICATION_CHANNELS)[number];

export type JobEventType =
  | 'CREATED'
  | 'STATUS_CHANGE'
  | 'INTERVIEW_ROUND_ADDED';

export interface JobEvent {
  id: string;
  jobId: string;
  type: JobEventType;
  fromStatus?: JobStatus;
  toStatus: JobStatus;
  note?: string;
  createdAt: string;
}

export type EnrichmentStatus =
  'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface CompanyProfile {
  id: string;
  jobId: string;
  status: EnrichmentStatus;
  industry?: string | null;
  companySize?: string | null;
  techStack: string[];
  cultureSummary?: string | null;
  workPolicy?: string | null;
  workLifeBalance?: string | null;
  headquarters?: string | null;
  headquartersLowConfidence?: boolean;
  address?: string | null;
  addressLowConfidence?: boolean;
  founded?: string | null;
  errorMessage?: string | null;
  enrichedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Resume {
  id: string;
  jobId: string;
  originalName: string;
  size: number;
  createdAt: string;
}

export type InterviewOutcome = 'PENDING' | 'PASSED' | 'FAILED' | 'CANCELLED';

// Computed by the backend, not stored — splits PENDING into three states
// based on scheduledAt vs now (see backend interview-round-status.util.ts).
// A resolved outcome (PASSED/FAILED/CANCELLED) passes through unchanged.
export type InterviewRoundDerivedStatus =
  | 'SCHEDULED'
  | 'AWAITING_RESPONSE'
  | 'POSSIBLY_GHOSTED'
  | 'PASSED'
  | 'FAILED'
  | 'CANCELLED';

export interface InterviewRound {
  id: string;
  jobId: string;
  stage: string;
  scheduledAt: string;
  outcome: InterviewOutcome;
  derivedStatus: InterviewRoundDerivedStatus;
  notes?: string | null;
  // LLM-generated talking points/questions for this round, produced from the
  // debrief notes on the previously-completed round for the same job.
  prepSuggestions?: string | null;
  prepGeneratedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  // Exactly one is set — a job-scoped contact has companyId: null and vice
  // versa. See docs/specs/target-companies.md Assumption 7.
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

export interface MatchedCompany {
  id: string;
  name: string;
}

export interface Job {
  id: string;
  company: string;
  position: string;
  location?: string;
  url?: string;
  status: JobStatus;
  priority: JobPriority;
  jobType: JobType;
  discoverySource?: DiscoverySource | null;
  applicationChannel?: ApplicationChannel | null;
  notes?: string;
  appliedAt: string;
  nextInterviewAt?: string;
  // LLM-generated one-line plain-English summary of this job's event
  // timeline, regenerated asynchronously after each status change.
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
  // Only present on the POST /jobs (create) response — see MatchedCompany.
  matchedCompany?: MatchedCompany | null;
}

export type Role = 'USER' | 'ADMIN';

export const DIGEST_FREQUENCIES = ['OFF', 'DAILY', 'WEEKLY'] as const;

export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

export const DIGEST_FREQUENCY_LABELS: Record<DigestFrequency, string> = {
  OFF: 'Off',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
};

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

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  jobCount: number;
}

export interface PaginatedAdminUsers {
  data: AdminUser[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export type AttentionType =
  'UPCOMING_INTERVIEW' | 'STALE_INTERVIEWING' | 'STALE_APPLIED';

export interface AttentionItem {
  type: AttentionType;
  since: string;
  job: Job;
}

export interface JobStats {
  total: number;
  byStatus: Record<JobStatus, number>;
  thisMonth: number;
  responseRate: number;
  ghostRate: number;
}

export const FUNNEL_STAGES = [
  'WISHLIST',
  'APPLIED',
  'INTERVIEWING',
  'OFFER',
] as const;

export interface FunnelStats {
  funnel: { status: (typeof FUNNEL_STAGES)[number]; reached: number }[];
  dropoff: { status: 'REJECTED' | 'GHOSTED'; count: number }[];
  avgTimeInStageDays: Partial<Record<JobStatus, number>>;
  responseRateBySource: {
    source: ApplicationChannel | 'UNSPECIFIED';
    total: number;
    responseRate: number;
  }[];
}

export type DashboardRange = '30d' | '90d' | 'all';

export const DASHBOARD_RANGES: { value: DashboardRange; label: string }[] = [
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
  { value: 'all', label: 'All' },
];

export interface TrendBucket {
  label: string;
  periodStart: string;
  count: number;
  cumulative: number;
}

export interface TrendStats {
  granularity: 'day' | 'week' | 'month';
  buckets: TrendBucket[];
}

export interface PaginatedJobs {
  data: Job[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface JobQuery {
  status?: JobStatus;
  priority?: JobPriority;
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  dateFrom?: string;
  dateTo?: string;
}

export const PRIORITY_LABELS: Record<JobPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

export const PRIORITY_COLORS: Record<JobPriority, string> = {
  LOW: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  MEDIUM:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  HIGH: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

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

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  ONSITE: 'Onsite',
  HYBRID: 'Hybrid',
  REMOTE: 'Remote',
};

export const JOB_TYPE_COLORS: Record<JobType, string> = {
  ONSITE: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  HYBRID:
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  REMOTE:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

export const STATUS_LABELS: Record<JobStatus, string> = {
  WISHLIST: 'Wishlist',
  APPLIED: 'Applied',
  INTERVIEWING: 'Interviewing',
  OFFER: 'Offer',
  REJECTED: 'Rejected',
  GHOSTED: 'Ghosted',
};

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

// Only SCHEDULED/AWAITING_RESPONSE/POSSIBLY_GHOSTED need a badge in the
// interview rounds list — PASSED/FAILED/CANCELLED are already shown via the
// outcome <select>.
export const DERIVED_STATUS_LABELS: Partial<
  Record<InterviewRoundDerivedStatus, string>
> = {
  SCHEDULED: 'Scheduled',
  AWAITING_RESPONSE: 'Awaiting response',
  POSSIBLY_GHOSTED: 'Possibly ghosted',
};

export const DERIVED_STATUS_COLORS: Partial<
  Record<InterviewRoundDerivedStatus, string>
> = {
  SCHEDULED: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  AWAITING_RESPONSE:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  POSSIBLY_GHOSTED:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

export const STATUS_DOT_COLORS: Record<JobStatus, string> = {
  WISHLIST: '#94a3b8',
  APPLIED: '#38d4c6',
  INTERVIEWING: '#ff9f45',
  OFFER: '#22c55e',
  REJECTED: '#ef4444',
  GHOSTED: '#71717a',
};

// --- Target Companies ---
// See docs/specs/target-companies.md — standalone company list, independent
// of any Job, with its own parallel AI-enrichment pipeline.

export const COMPANY_CITIES = [
  'LAHORE',
  'ISLAMABAD',
  'KARACHI',
  'OTHER',
] as const;

export type CompanyCity = (typeof COMPANY_CITIES)[number];

export const CITY_LABELS: Record<CompanyCity, string> = {
  LAHORE: 'Lahore',
  ISLAMABAD: 'Islamabad',
  KARACHI: 'Karachi',
  OTHER: 'Other',
};

export const CITY_COLORS: Record<CompanyCity, string> = {
  LAHORE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  ISLAMABAD:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  KARACHI:
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  OTHER: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export const BUSINESS_MODES = ['PRODUCT', 'SERVICES', 'HYBRID'] as const;

export type BusinessMode = (typeof BUSINESS_MODES)[number];

export const BUSINESS_MODE_LABELS: Record<BusinessMode, string> = {
  PRODUCT: 'Product',
  SERVICES: 'Services',
  HYBRID: 'Hybrid',
};

export const BUSINESS_MODE_COLORS: Record<BusinessMode, string> = {
  PRODUCT:
    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  SERVICES: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
  HYBRID:
    'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

// Phase 6 (docs/specs/company-fk-phase6.md) — lean projection returned by
// GET /companies/:id, not the full Job shape.
export interface CompanyJobSummary {
  id: string;
  position: string;
  status: JobStatus;
  priority: JobPriority;
  appliedAt: string;
}

export interface Company {
  id: string;
  name: string;
  city: CompanyCity;
  location?: string | null;
  priority: JobPriority;
  personalNotes?: string | null;
  websiteUrl?: string | null;
  linkedinUrl?: string | null;
  businessMode?: BusinessMode | null;
  productDescription?: string | null;
  // null = enrichment never triggered (distinct from PENDING/PROCESSING)
  status: EnrichmentStatus | null;
  industry?: string | null;
  companySize?: string | null;
  techStack: string[];
  cultureSummary?: string | null;
  workPolicy?: string | null;
  workLifeBalance?: string | null;
  headquarters?: string | null;
  headquartersLowConfidence?: boolean;
  address?: string | null;
  addressLowConfidence?: boolean;
  founded?: string | null;
  errorMessage?: string | null;
  enrichedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  contacts?: Contact[];
  jobs?: CompanyJobSummary[];
}

export interface PaginatedCompanies {
  data: Company[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Phase 5c (docs/specs/company-fk-phase5c.md)
export interface DuplicateSuggestion {
  companyA: Company;
  companyB: Company;
  reason: 'website' | 'name';
}

export interface CompanyQuery {
  page?: number;
  limit?: number;
  city?: CompanyCity | '';
  priority?: JobPriority | '';
  search?: string;
}

export interface CsvImportError {
  row: number;
  message: string;
}

export interface CsvImportResult {
  imported: number;
  errors: CsvImportError[];
}
