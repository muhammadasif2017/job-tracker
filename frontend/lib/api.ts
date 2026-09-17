import axios from 'axios';
import { tokenStorage } from './auth';
import { useAuthStore } from '../store/auth.store';

/**
 * Default request timeout so a hung backend doesn't spin forever. Also used
 * for the refresh-token POST below, which bypasses the `api` instance (plain
 * `axios.post`) and so doesn't inherit it automatically. Per-call overrides:
 * resume upload (`features/jobs/resume.hooks.ts`, 120s — bounded by the 8 MB
 * size cap), Quick Add's `/jobs/parse` (`features/jobs/hooks.ts`, 60s —
 * synchronous page-fetch + LLM extraction with a fallback search+retry pass),
 * and saving an interview-round debrief
 * (`features/jobs/interview-rounds.hooks.ts`, 60s — synchronous LLM round-prep
 * generation, same Groq client/timeout shape as `/jobs/parse`). Don't raise
 * this default — override per-call instead.
 */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * The app's axios instance. Attaches the access token to every request and,
 * on a 401, refreshes it once through the httpOnly refresh cookie, queueing
 * concurrent 401s behind that single refresh. A definitive refresh rejection
 * (401/403) signs the user out.
 */
const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  // Required both ways: lets the browser store the httpOnly refresh cookie
  // from login/register/refresh responses, and resend it on later requests.
  withCredentials: true,
  timeout: DEFAULT_TIMEOUT_MS,
});

api.interceptors.request.use((config) => {
  const token = tokenStorage.getAccess();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/** True while a refresh request is in flight; later 401s wait for it. */
let isRefreshing = false;
/**
 * Requests that got a 401 during a refresh, resumed or rejected when it
 * settles.
 */
let failedQueue: Array<{
  resolve: (v: string) => void;
  reject: (e: unknown) => void;
}> = [];

/**
 * Resumes every queued request with the new token, or rejects them all with
 * `error`.
 */
function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((p) => (error ? p.reject(error) : p.resolve(token!)));
  failedQueue = [];
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      original._retry = true;
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      });
    }

    // Auth endpoint failures (login, register) should surface to the caller
    if (original.url?.match(/\/auth\/(login|register)$/)) {
      return Promise.reject(error);
    }

    original._retry = true;
    isRefreshing = true;

    try {
      // No body — the refresh token is an httpOnly cookie the browser
      // attaches automatically. If it's missing or expired, this 401s and
      // falls into the catch below.
      const { data } = await axios.post(
        `${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`,
        {},
        { withCredentials: true, timeout: DEFAULT_TIMEOUT_MS },
      );
      tokenStorage.setAccess(data.accessToken);
      processQueue(null, data.accessToken);
      original.headers.Authorization = `Bearer ${data.accessToken}`;
      return api(original);
    } catch (err) {
      processQueue(err, null);
      // Only a definitive rejection from the backend (refresh token missing,
      // expired, or revoked) means the session is actually over. Anything
      // else - network drop, backend restart, transient 5xx - is not proof
      // the refresh token is invalid, so don't evict a valid session over it.
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status === 401 || status === 403) {
        useAuthStore.getState().logout();
        // Module scope, outside React — there is no router to call. A full
        // load is also what we want: the session is definitively over, so its
        // cached data should not outlive it. CONSTRAINTS.md E5.
        window.location.href = '/login';
      }
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  },
);

/**
 * A displayable message from an API error, or `fallback`.
 *
 * NestJS's default ValidationPipe returns `message` as a string[] for DTO
 * validation failures (one entry per failed constraint) and a string for
 * everything else (NotFoundException, ForbiddenException, etc.) — React
 * renders a string[] as concatenated children with no separator, so this
 * normalizes both shapes into one readable string.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (!axios.isAxiosError(err)) return fallback;
  const message = err.response?.data?.message;
  if (Array.isArray(message)) {
    return message.length > 0 ? message.join('. ') : fallback;
  }
  return typeof message === 'string' ? message : fallback;
}

export default api;
