export type JobStatus =
  | 'WISHLIST'
  | 'APPLIED'
  | 'INTERVIEWING'
  | 'OFFER'
  | 'REJECTED'
  | 'GHOSTED';

export type JobEventType = 'CREATED' | 'STATUS_CHANGE';

export interface JobEvent {
  id: string;
  jobId: string;
  type: JobEventType;
  fromStatus?: JobStatus;
  toStatus: JobStatus;
  note?: string;
  createdAt: string;
}

export interface Job {
  id: string;
  company: string;
  position: string;
  location?: string;
  url?: string;
  status: JobStatus;
  notes?: string;
  appliedAt: string;
  nextInterviewAt?: string;
  createdAt: string;
  updatedAt: string;
  userId: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  connectedProviders?: string[];
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface JobStats {
  total: number;
  byStatus: Record<JobStatus, number>;
  thisMonth: number;
  responseRate: number;
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
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  dateFrom?: string;
  dateTo?: string;
}

export const JOB_STATUSES: JobStatus[] = [
  'WISHLIST',
  'APPLIED',
  'INTERVIEWING',
  'OFFER',
  'REJECTED',
  'GHOSTED',
];

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
  INTERVIEWING: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  OFFER: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  REJECTED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  GHOSTED: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

export const STATUS_DOT_COLORS: Record<JobStatus, string> = {
  WISHLIST: '#94a3b8',
  APPLIED: '#3b82f6',
  INTERVIEWING: '#8b5cf6',
  OFFER: '#10b981',
  REJECTED: '#ef4444',
  GHOSTED: '#f59e0b',
};
