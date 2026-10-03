import { test, expect, type Page } from '@playwright/test';
import {
  API,
  createTestUser,
  deleteTestUser,
  injectAuth,
  type TestUser,
} from './fixtures';

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser();
});

test.afterAll(async () => {
  if (user) await deleteTestUser(user.accessToken);
});

/**
 * Signs in as an admin. This suite has no database access, so nothing here can
 * grant the ADMIN role, and the API checks it against the database. So the
 * admin endpoints are faked at the network boundary (they are covered against
 * a real database in the backend e2e suite); what this proves is the pages:
 * the role gate in proxy.ts, the tabs and what each tab renders.
 */
async function signInAsAdmin(page: Page) {
  await injectAuth(page, user);
  // proxy.ts reads this cookie; the sidebar reads the role from the store.
  await page
    .context()
    .addCookies([
      { name: 'jt_role', value: 'ADMIN', domain: 'localhost', path: '/' },
    ]);
  await page.addInitScript(() => {
    const raw = localStorage.getItem('jt-auth');
    if (!raw) return;
    const auth = JSON.parse(raw);
    auth.state.user.role = 'ADMIN';
    localStorage.setItem('jt-auth', JSON.stringify(auth));
  });

  await page.route(`${API}/admin/users?*`, (route) =>
    route.fulfill({
      json: {
        data: [
          {
            id: 'u1',
            email: 'ada@example.com',
            name: 'Ada Lovelace',
            role: 'ADMIN',
            createdAt: '2026-09-01T10:00:00.000Z',
            jobCount: 3,
          },
          {
            id: 'u2',
            email: 'alan@example.com',
            name: 'Alan Turing',
            role: 'USER',
            createdAt: '2026-09-02T10:00:00.000Z',
            jobCount: 1,
          },
        ],
        meta: { total: 2, page: 1, limit: 20, totalPages: 1 },
      },
    }),
  );
  await page.route(`${API}/admin/queues`, (route) =>
    route.fulfill({
      json: {
        queues: [
          {
            name: 'company-enrichment',
            available: true,
            counts: {
              waiting: 2,
              active: 1,
              delayed: 0,
              failed: 4,
              completed: 9,
            },
          },
        ],
        companyStatuses: [
          { status: 'COMPLETED', label: 'Completed', count: 5 },
        ],
        strandedPending: 0,
        circuits: [{ name: 'llm', state: 'open', retryAfterMs: 30_000 }],
      },
    }),
  );
}

test.describe('Admin pages', () => {
  test('keeps a non-admin out of /admin', async ({ page }) => {
    await injectAuth(page, user);
    await page.goto('/admin/users');

    await expect(page).not.toHaveURL(/\/admin/);
  });

  test('lists users under one Admin heading', async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/users');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Admin' }),
    ).toBeVisible();
    await expect(page.getByText('2 registered users')).toBeVisible();
    await expect(page.getByText('alan@example.com')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Delete ada@example.com' }),
    ).toBeVisible();
  });

  test('switches to the queues tab and shows queue health', async ({
    page,
  }) => {
    await signInAsAdmin(page);
    await page.goto('/admin/users');

    await page.getByRole('link', { name: 'Queues' }).click();

    await expect(page).toHaveURL(/\/admin\/queues$/);
    await expect(page.getByText('company-enrichment')).toBeVisible();
    await expect(page.getByText('Open', { exact: true })).toBeVisible();
  });
});
