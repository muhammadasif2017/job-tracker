import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '../../lib/api';
import type {
  Job,
  JobEvent,
  JobStatus,
  JobPriority,
  JobType,
  ApplicationChannel,
  PaginatedJobs,
} from '../../types';

export interface JobsFilters {
  page: number;
  search: string;
  status: JobStatus | '';
  priority: JobPriority | '';
}

function invalidateJobListCaches(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['jobs'] });
  qc.invalidateQueries({ queryKey: ['stats'] });
  qc.invalidateQueries({ queryKey: ['analytics', 'funnel'] });
  qc.invalidateQueries({ queryKey: ['attention'] });
}

export function useJobsQuery(filters: JobsFilters) {
  const params = new URLSearchParams({
    page: String(filters.page),
    limit: '10',
    sortBy: 'appliedAt',
    sortOrder: 'desc',
    ...(filters.search && { search: filters.search }),
    ...(filters.status && { status: filters.status }),
    ...(filters.priority && { priority: filters.priority }),
  });

  return useQuery<PaginatedJobs>({
    queryKey: ['jobs', filters],
    queryFn: () => api.get(`/jobs?${params}`).then((r) => r.data),
  });
}

export function useDeleteJobMutation(onDeleted?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/jobs/${id}`),
    onSuccess: () => {
      invalidateJobListCaches(qc);
      toast.success('Job deleted');
      onDeleted?.();
    },
    onError: (err) => {
      toast.error(getErrorMessage(err, 'Failed to delete job'));
    },
  });
}

export function useJobQuery(id: string) {
  return useQuery<Job>({
    queryKey: ['job', id],
    queryFn: () => api.get(`/jobs/${id}`).then((r) => r.data),
    refetchInterval: (query) => {
      const status = query.state.data?.companyProfile?.status;
      return status === 'PENDING' || status === 'PROCESSING' ? 3000 : false;
    },
  });
}

// The backend's max page size. There's no pagination UI on the timeline, so
// ask for the largest page it will serve — a job with more events than this
// is far outside normal use, and the newest-first ordering means the newest
// ones are what survive.
const EVENTS_PAGE_SIZE = 200;

export function useJobEventsQuery(id: string) {
  return useQuery<JobEvent[]>({
    queryKey: ['job-events', id],
    // Backend returns { data, meta } (paginated) — no pagination UI here yet,
    // so unwrap to the flat array callers expect. It orders newest-first so a
    // truncated page keeps the recent events; the timeline renders
    // oldest-to-newest, so flip the page back here. Reversing the fresh axios
    // array inside queryFn (not the cached value in a selector) keeps this
    // from mutating cache state.
    queryFn: () =>
      api
        .get(`/jobs/${id}/events?limit=${EVENTS_PAGE_SIZE}`)
        .then((r) => (r.data.data as JobEvent[]).reverse()),
    enabled: !!id,
  });
}

export function usePatchJobStatusMutation(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: JobStatus) =>
      api.patch(`/jobs/${id}`, { status }).then((r) => r.data),
    onSuccess: (updated) => {
      // PATCH /jobs/:id returns the job with `resume` included only — it
      // carries no `interviewRounds`, `contacts` or `companyProfile`, unlike
      // the GET /jobs/:id shape this cache entry holds. Spread `prev` first
      // so those survive: the keys are absent from `updated`, so they can't
      // be overwritten with undefined and blank the detail page's rounds and
      // contacts sections.
      qc.setQueryData<Job>(['job', id], (prev) =>
        prev ? { ...prev, ...updated } : updated,
      );
      qc.invalidateQueries({ queryKey: ['job-events', id] });
      invalidateJobListCaches(qc);
    },
    // A 409 here means another request (e.g. an interview-round
    // auto-promotion) changed the status concurrently — refetch so the
    // select snaps to the true current status instead of the stale cached
    // one the user tried to change it from.
    onError: (err: unknown) => {
      qc.invalidateQueries({ queryKey: ['job', id] });
      toast.error(getErrorMessage(err, 'Failed to update status'));
    },
  });
}

// The four columns the board renders. Sent as `statusIn` so REJECTED and
// GHOSTED jobs don't consume slots in the page limit and then render in no
// column at all — with enough closed applications that alone could empty the
// board.
export const KANBAN_STATUSES: JobStatus[] = [
  'WISHLIST',
  'APPLIED',
  'INTERVIEWING',
  'OFFER',
];

// Max page size the list endpoint will serve. The board is a single page, so
// a user with more open applications than this sees a subset — `meta.total`
// says how many matched, and the board surfaces that rather than quietly
// dropping cards.
export const KANBAN_PAGE_SIZE = 100;

// Must describe the request it caches — the board and the optimistic-drag
// mutation share this constant, so they can never drift apart.
const KANBAN_QUERY_KEY = [
  'jobs',
  { limit: KANBAN_PAGE_SIZE, statusIn: KANBAN_STATUSES },
] as const;

export function useKanbanJobsQuery() {
  const params = new URLSearchParams({
    limit: String(KANBAN_PAGE_SIZE),
    statusIn: KANBAN_STATUSES.join(','),
  });
  return useQuery<PaginatedJobs>({
    queryKey: KANBAN_QUERY_KEY,
    queryFn: () => api.get(`/jobs?${params}`).then((r) => r.data),
  });
}

export function useKanbanPatchStatusMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) =>
      api.patch(`/jobs/${id}`, { status }).then((r) => r.data),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['jobs'] });
      const prev = qc.getQueryData<PaginatedJobs>(KANBAN_QUERY_KEY);
      qc.setQueryData<PaginatedJobs>(KANBAN_QUERY_KEY, (old) =>
        old
          ? {
              ...old,
              data: old.data.map((j) => (j.id === id ? { ...j, status } : j)),
            }
          : old,
      );
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(KANBAN_QUERY_KEY, ctx.prev);
      toast.error(getErrorMessage(err, 'Failed to update status'));
    },
    onSettled: () => {
      invalidateJobListCaches(qc);
    },
  });
}

export interface ParsedJob {
  company?: string | null;
  position?: string | null;
  location?: string | null;
  url?: string;
  jobType?: JobType;
  applicationChannel?: ApplicationChannel;
}

function looksLikeUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function useParseJobMutation(onParsed?: (data: ParsedJob) => void) {
  return useMutation({
    mutationFn: (value: string) => {
      const payload = looksLikeUrl(value)
        ? { url: value.trim() }
        : { text: value };
      return api
        .post<ParsedJob>('/jobs/parse', payload, { timeout: 60_000 })
        .then((r) => r.data);
    },
    onSuccess: (data) => {
      // /jobs/parse answers 200 with an all-but-empty body when neither the
      // page fetch nor the search fallback gave the LLM anything to extract.
      // Quick Add then opens a blank form, which reads as a bug unless we say
      // what happened.
      if (!data.company && !data.position) {
        toast.warning(
          "Couldn't read that posting — enter the details manually.",
        );
      }
      onParsed?.(data);
    },
    onError: (err: unknown) =>
      toast.error(getErrorMessage(err, 'Could not parse that posting')),
  });
}
