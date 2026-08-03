import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

function request(path: string, cookies: Record<string, string> = {}) {
  const cookieHeader = Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
  return new NextRequest(new URL(path, 'https://app.example'), {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
}

describe('proxy', () => {
  describe('unauthenticated', () => {
    it('redirects protected paths to /login', () => {
      const res = proxy(request('/jobs'));
      expect(res.headers.get('location')).toBe('https://app.example/login');
    });

    it('lets public paths through', () => {
      const res = proxy(request('/login'));
      expect(res.headers.get('location')).toBeNull();
    });

    it('lets /callback through', () => {
      const res = proxy(request('/callback'));
      expect(res.headers.get('location')).toBeNull();
    });
  });

  describe('authenticated, non-admin routes', () => {
    it('lets an authed request through to a protected path', () => {
      const res = proxy(request('/jobs', { jt_authed: '1' }));
      expect(res.headers.get('location')).toBeNull();
    });

    it('redirects an authed user away from /login', () => {
      const res = proxy(request('/login', { jt_authed: '1' }));
      expect(res.headers.get('location')).toBe('https://app.example/');
    });

    it('does not redirect an authed user away from /callback', () => {
      const res = proxy(request('/callback', { jt_authed: '1' }));
      expect(res.headers.get('location')).toBeNull();
    });
  });

  describe('admin route guard', () => {
    it('redirects a non-admin (no jt_role cookie) away from /admin/users to /', () => {
      const res = proxy(request('/admin/users', { jt_authed: '1' }));
      expect(res.headers.get('location')).toBe('https://app.example/');
    });

    it('redirects a USER-role cookie away from /admin/users', () => {
      const res = proxy(
        request('/admin/users', { jt_authed: '1', jt_role: 'USER' }),
      );
      expect(res.headers.get('location')).toBe('https://app.example/');
    });

    it('lets an ADMIN-role cookie through to /admin/users', () => {
      const res = proxy(
        request('/admin/users', { jt_authed: '1', jt_role: 'ADMIN' }),
      );
      expect(res.headers.get('location')).toBeNull();
    });

    it('guards nested /admin paths, not just the exact prefix', () => {
      const res = proxy(
        request('/admin/users/123', { jt_authed: '1', jt_role: 'USER' }),
      );
      expect(res.headers.get('location')).toBe('https://app.example/');
    });

    it('redirects an unauthenticated request to /login before the admin check ever runs', () => {
      const res = proxy(request('/admin/users'));
      expect(res.headers.get('location')).toBe('https://app.example/login');
    });
  });
});
