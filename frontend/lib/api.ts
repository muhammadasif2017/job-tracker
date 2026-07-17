import axios from 'axios';
import { tokenStorage } from './auth';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  // Required both ways: lets the browser store the httpOnly refresh cookie
  // from login/register/refresh responses, and resend it on later requests.
  withCredentials: true,
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
        { withCredentials: true },
      );
      tokenStorage.setAccess(data.accessToken);
      processQueue(null, data.accessToken);
      original.headers.Authorization = `Bearer ${data.accessToken}`;
      return api(original);
    } catch (err) {
      processQueue(err, null);
      tokenStorage.clear();
      document.cookie = 'jt_authed=; path=/; max-age=0';
      window.location.href = '/login';
      return Promise.reject(err);
    } finally {
      isRefreshing = false;
    }
  },
);

export default api;
