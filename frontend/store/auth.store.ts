'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';
import { tokenStorage } from '../lib/auth';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,

      setAuth: (user, accessToken, refreshToken) => {
        tokenStorage.set(accessToken, refreshToken);
        document.cookie = 'jt_authed=1; path=/; max-age=604800; SameSite=Lax';
        set({ user, accessToken, isAuthenticated: true });
      },

      setUser: (user) => set({ user }),

      logout: () => {
        tokenStorage.clear();
        document.cookie = 'jt_authed=; path=/; max-age=0';
        set({ user: null, accessToken: null, isAuthenticated: false });
      },
    }),
    {
      name: 'jt-auth',
      partialize: (s) => ({ user: s.user, accessToken: s.accessToken, isAuthenticated: s.isAuthenticated }),
    },
  ),
);
