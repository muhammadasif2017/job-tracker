'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';
import { tokenStorage } from '../lib/auth';

/** The signed-in user and the actions that change them. */
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  setAuth: (user: User, accessToken: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

/**
 * Wipe every trace of the session from storage without touching the store.
 *
 * Sign-out paths must call this instead of `logout()`: `logout()` runs a
 * zustand `set()`, and every component subscribed to the store re-renders
 * with `user: null` while the page is still mounted, blanking the profile
 * before the browser has navigated away. Clearing storage only is invisible
 * to React, so the old view stays intact until the new document commits.
 */
export function clearAuthStorage(): void {
  tokenStorage.clear();
  // zustand's `persist` key - left behind, the next document rehydrates an
  // authenticated store with no token to back it.
  localStorage.removeItem('jt-auth');
  document.cookie = 'jt_authed=; path=/; max-age=0';
  document.cookie = 'jt_role=; path=/; max-age=0';
}

/**
 * The signed-in user, persisted to localStorage under `jt-auth`. `setAuth`
 * also stores the access token and sets the `jt_authed` and `jt_role` cookies
 * that `proxy.ts` reads to guard routes. The refresh token is never here: it
 * lives in an httpOnly cookie.
 */
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,

      setAuth: (user, accessToken) => {
        tokenStorage.setAccess(accessToken);
        const secure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `jt_authed=1; path=/; max-age=604800; SameSite=Lax${secure}`;
        document.cookie = `jt_role=${user.role ?? 'USER'}; path=/; max-age=604800; SameSite=Lax${secure}`;
        set({ user, isAuthenticated: true });
      },

      setUser: (user) => set({ user }),

      logout: () => {
        clearAuthStorage();
        set({ user: null, isAuthenticated: false });
      },
    }),
    {
      name: 'jt-auth',
      partialize: (s) => ({
        user: s.user,
        isAuthenticated: s.isAuthenticated,
      }),
    },
  ),
);
