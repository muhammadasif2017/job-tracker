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
  JobType,
  ApplicationChannel,
  PaginatedJobs,
} from '../../types';

/** Filter and paging state for the jobs page. */
export interface JobsFilters {
  page: number;
  search: string;
  status: JobStatus | '';
  // Both are date-only strings from <input type="date">, or '' for no bound.
  // The backend widens a date-only `dateTo` to the end of that day (see
  // buildJobWhere) so the named day is included.
  dateFrom: string;
  dateTo: string;
}

/**
 * The subset of the page's filters that isn't pagination — shared by the
 * list, the board and the CSV export so all three answer the same question.
 */
export type JobsFilterValues = Omit<JobsFilters, 'page'>;

/**
 * One place that turns filter state into query params. The board and the
 * list would otherwise drift on which filters they honour — the board used
 * to send none of them, so filtering the list and switching to the board
 * silently showed everything again.
 */
export function jobFilterParams(filters: JobsFilterValues): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  return params;
}

/**
 * Invalidates every cache that lists or counts jobs.
 *
 * Exported for the dashboard's ghost-suggestion actions, which change the
 * same lists and counts.
 */
export function invalidateJobListCaches(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['jobs'] });
  qc.invalidateQueries({ queryKey: ['stats'] });
  qc.invalidateQueries({ queryKey: ['analytics', 'funnel'] });
  qc.invalidateQueries({ queryKey: ['attention'] });
  // Any status change can add or remove a "looks ghosted" suggestion — and
  // the list/kanban badges read the same query.
  qc.invalidateQueries({ queryKey: ['ghost-suggestions'] });
}

/** One page of the jobs list, newest application first. */
export function useJobsQuery(filters: JobsFilters) {
  const params = jobFilterParams(filters);
  params.set('page', String(filters.page));
  params.set('limit', '10');
  params.set('sortBy', 'appliedAt');
  params.set('sortOrder', 'desc');
  if (filters.status) params.set('status', filters.status);

  return useQuery<PaginatedJobs>({
    queryKey: ['jobs', filters],
    queryFn: () => api.get(`/jobs?${params}`).then((r) => r.data),
  });
}

/** Deletes a job and refreshes every job list and count. */
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

/**
 * One job with its related records. Polls every 3 seconds while its company
 * enrichment is pending or processing, so the profile card fills in without a
 * reload.
 */
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

/**
 * The backend's max page size. There's no pagination UI on the timeline, so
 * ask for the largest page it will serve — a job with more events than this
 * is far outside normal use, and the newest-first ordering means the newest
 * ones are what survive.
 */
const EVENTS_PAGE_SIZE = 200;

/** A job's timeline events, oldest first. */
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

/** Changes one job's status from its detail page. */
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

/**
 * The four columns the board renders. Sent as `statusIn` so REJECTED and
 * GHOSTED jobs don't consume slots in the page limit and then render in no
 * column at all — with enough closed applications that alone could empty the
 * board.
 */
export const KANBAN_STATUSES: JobStatus[] = [
  'WISHLIST',
  'APPLIED',
  'INTERVIEWING',
  'OFFER',
];

/**
 * Max page size the list endpoint will serve. The board is a single page, so
 * a user with more open applications than this sees a subset — `meta.total`
 * says how many matched, and the board surfaces that rather than quietly
 * dropping cards.
 */
export const KANBAN_PAGE_SIZE = 100;

/**
 * The board renders only the four open-pipeline columns, so a status filter
 * that isn't one of them (Rejected, Ghosted) selects nothing the board can
 * draw. Returning an empty list — rather than ignoring the filter — keeps
 * the board honest; KanbanBoard renders an explanation for that case.
 */
export function kanbanStatuses(status: JobStatus | ''): JobStatus[] {
  if (!status) return KANBAN_STATUSES;
  return KANBAN_STATUSES.includes(status) ? [status] : [];
}

/**
 * Must describe the request it caches — the board and the optimistic-drag
 * mutation share this builder, so they can never drift apart. The filters
 * are part of the key: two different filter sets are two different pages of
 * data and must not share a cache entry.
 */
export function kanbanQueryKey(filters: JobsFilterValues) {
  return [
    'jobs',
    {
      limit: KANBAN_PAGE_SIZE,
      statusIn: kanbanStatuses(filters.status),
      search: filters.search,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
    },
  ] as const;
}

/** Jobs for the kanban board, limited to the columns it can draw. */
export function useKanbanJobsQuery(filters: JobsFilterValues) {
  const statuses = kanbanStatuses(filters.status);
  const params = jobFilterParams(filters);
  params.set('limit', String(KANBAN_PAGE_SIZE));
  params.set('statusIn', statuses.join(','));
  return useQuery<PaginatedJobs>({
    queryKey: kanbanQueryKey(filters),
    queryFn: () => api.get(`/jobs?${params}`).then((r) => r.data),
    // No board column can hold the selected status, so there is nothing to
    // fetch — asking anyway would send `statusIn=` and get back everything.
    enabled: statuses.length > 0,
  });
}

/**
 * Moves a card to another column. Updates the board's cache before the
 * request so the drag feels instant, and restores it if the request fails.
 */
export function useKanbanPatchStatusMutation(filters: JobsFilterValues) {
  const qc = useQueryClient();
  const queryKey = kanbanQueryKey(filters);
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) =>
      api.patch(`/jobs/${id}`, { status }).then((r) => r.data),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['jobs'] });
      const prev = qc.getQueryData<PaginatedJobs>(queryKey);
      qc.setQueryData<PaginatedJobs>(queryKey, (old) =>
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
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
      toast.error(getErrorMessage(err, 'Failed to update status'));
    },
    onSettled: () => {
      invalidateJobListCaches(qc);
    },
  });
}

/**
 * Job fields extracted from a posting by `/jobs/parse`. Any field may be
 * missing.
 */
export interface ParsedJob {
  company?: string | null;
  position?: string | null;
  location?: string | null;
  url?: string;
  jobType?: JobType;
  applicationChannel?: ApplicationChannel;
  // The LLM call failed (not "nothing found") — a retry may succeed.
  parserUnavailable?: true;
}

/**
 * Whether the Quick Add input is an http(s) URL rather than pasted posting
 * text.
 */
function looksLikeUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Parses a posting URL or pasted text into job fields for Quick Add, with a
 * 60-second timeout because the backend fetches and runs an LLM synchronously.
 * Warns when nothing could be extracted.
 */
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
      if (data.parserUnavailable) {
        toast.error("Couldn't reach the job parser. Try again.");
        onParsed?.(data);
        return;
      }
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
