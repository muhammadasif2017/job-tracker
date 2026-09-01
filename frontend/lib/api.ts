import axios from 'axios';
import { tokenStorage } from './auth';
import { useAuthStore } from '../store/auth.store';

// Default request timeout so a hung backend doesn't spin forever. Also used
// for the refresh-token POST below, which bypasses the `api` instance (plain
// `axios.post`) and so doesn't inherit it automatically. Per-call overrides:
// resume upload (`components/jobs/resume-upload.tsx`, 120s — bounded by the
// 8 MB size cap), Quick Add's `/jobs/parse` (`components/jobs/quick-add.tsx`,
// 60s — synchronous page-fetch + LLM extraction with a fallback search+retry
// pass), and saving an interview-round debrief (`features/jobs/interview-rounds.hooks.ts`,
// 60s — synchronous LLM round-prep generation, same Groq client/timeout
// shape as `/jobs/parse`). Don't raise this default — override per-call instead.
const DEFAULT_TIMEOUT_MS = 15_000;

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

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (v: string) => void;
  reject: (e: unknown) => void;
}> = [];

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
        window.location.href = '/login';
      }
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  },
);

// NestJS's default ValidationPipe returns `message` as a string[] for DTO
// validation failures (one entry per failed constraint) and a string for
// everything else (NotFoundException, ForbiddenException, etc.) — React
// renders a string[] as concatenated children with no separator, so this
// normalizes both shapes into one readable string.
export function getErrorMessage(err: unknown, fallback: string): string {
  if (!axios.isAxiosError(err)) return fallback;
  const message = err.response?.data?.message;
  if (Array.isArray(message)) {
    return message.length > 0 ? message.join('. ') : fallback;
  }
  return typeof message === 'string' ? message : fallback;
}

export default api;
