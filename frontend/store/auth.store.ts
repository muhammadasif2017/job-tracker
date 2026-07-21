'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';
import { tokenStorage } from '../lib/auth';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  setAuth: (user: User, accessToken: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

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
        tokenStorage.clear();
        document.cookie = 'jt_authed=; path=/; max-age=0';
        document.cookie = 'jt_role=; path=/; max-age=0';
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
