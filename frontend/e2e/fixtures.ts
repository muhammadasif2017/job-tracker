import type { Page } from '@playwright/test';

export const API = process.env.PLAYWRIGHT_API_URL ?? 'http://localhost:3001';

export interface TestUser {
  id: string;
  email: string;
  name: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}

export interface TestJob {
  id: string;
  company: string;
  position: string;
}

// ── User helpers ─────────────────────────────────────────────────────────────

export async function createTestUser(suffix = ''): Promise<TestUser> {
  const email = `e2e-${Date.now()}${suffix}@test.dev`;
  const password = 'E2ePass123!';
  const name = `E2E User${suffix}`;

  const regRes = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  if (!regRes.ok) throw new Error(`Register failed: ${await regRes.text()}`);
  const { accessToken, refreshToken } = (await regRes.json()) as {
    accessToken: string;
    refreshToken: string;
  };

  const meRes = await fetch(`${API}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const { id } = (await meRes.json()) as { id: string };

  return { id, email, name, password, accessToken, refreshToken };
}

export async function deleteTestUser(accessToken: string): Promise<void> {
  await fetch(`${API}/users/me`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {});
}

// ── Job helpers ───────────────────────────────────────────────────────────────

export async function createTestJob(
  accessToken: string,
  overrides: Partial<{
    company: string;
    position: string;
    status: string;
    location: string;
  }> = {},
): Promise<TestJob> {
  const res = await fetch(`${API}/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      company: 'Acme Corp',
      position: 'Software Engineer',
      status: 'APPLIED',
      ...overrides,
    }),
  });
  return res.json() as Promise<TestJob>;
}

export async function deleteTestJob(
  accessToken: string,
  jobId: string,
): Promise<void> {
  await fetch(`${API}/jobs/${jobId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  }).catch(() => {});
}

// ── Auth injection ────────────────────────────────────────────────────────────

/**
 * Inject auth state into the browser context before the first page.goto().
 * Must be called before any navigation.
 */
export async function injectAuth(page: Page, user: TestUser): Promise<void> {
  // Cookie read by proxy.ts for route protection
  await page.context().addCookies([
    {
      name: 'jt_authed',
      value: '1',
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
      httpOnly: false,
      secure: false,
    },
  ]);

  // localStorage keys used by the Axios interceptor and Zustand persist
  await page.addInitScript(
    ({ access, refresh, id, email, name }) => {
      localStorage.setItem('jt_access', access);
      localStorage.setItem('jt_refresh', refresh);
      localStorage.setItem(
        'jt-auth',
        JSON.stringify({
          state: {
            user: { id, email, name },
            accessToken: access,
            isAuthenticated: true,
          },
          version: 0,
        }),
      );
    },
    {
      access: user.accessToken,
      refresh: user.refreshToken,
      id: user.id,
      email: user.email,
      name: user.name,
    },
  );
}
