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
  industry?: string;
  companySize?: string;
  techStack: string[];
  cultureSummary?: string;
  workPolicy?: string;
  workLifeBalance?: string;
  headquarters?: string;
  address?: string;
  founded?: string;
  errorMessage?: string;
  enrichedAt?: string;
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

export interface InterviewRound {
  id: string;
  jobId: string;
  stage: string;
  scheduledAt: string;
  outcome: InterviewOutcome;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contact {
  id: string;
  jobId: string;
  name: string;
  role?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
  notes?: string | null;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
  userId: string;
  companyProfile?: CompanyProfile;
  resume?: Resume | null;
  interviewRounds?: InterviewRound[];
  contacts?: Contact[];
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

export const STATUS_DOT_COLORS: Record<JobStatus, string> = {
  WISHLIST: '#94a3b8',
  APPLIED: '#3b82f6',
  INTERVIEWING: '#8b5cf6',
  OFFER: '#10b981',
  REJECTED: '#ef4444',
  GHOSTED: '#f59e0b',
};
