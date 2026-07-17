const ACCESS_TOKEN_KEY = 'jt_access';

// Refresh token lives only in an httpOnly cookie set by the backend — never
// stored here, never readable by JS (see lib/api.ts for the refresh flow).
export const tokenStorage = {
  getAccess: () => localStorage.getItem(ACCESS_TOKEN_KEY),
  setAccess: (access: string) => {
    localStorage.setItem(ACCESS_TOKEN_KEY, access);
  },
  clear: () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
  },
};
