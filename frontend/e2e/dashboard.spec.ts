import { test, expect } from '@playwright/test';
import {
  createTestUser,
  deleteTestUser,
  createTestJob,
  deleteTestJob,
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

test.describe('Dashboard', () => {
  test('shows zero stats for a fresh account', async ({ page }) => {
    await injectAuth(page, user);
    await page.goto('/');

    await expect(page.getByText('Total Applications')).toBeVisible();

    // All four stat cards should show 0 / 0%
    const cards = page.locator('text=/^0$|^0%$/');
    await expect(cards.first()).toBeVisible();
    await expect(page.getByText('No jobs tracked yet.')).toBeVisible();
    await expect(page.getByText('No data yet')).toBeVisible();
  });

  test('increments total applications after a job is added', async ({
    page,
  }) => {
    const job = await createTestJob(user.accessToken);

    await injectAuth(page, user);
    await page.goto('/');

    // The "Total Applications" card value
    const totalCard = page
      .locator('div')
      .filter({ hasText: /^Total Applications/ })
      .first();
    await expect(totalCard.getByText('1')).toBeVisible();

    await deleteTestJob(user.accessToken, job.id);
  });

  test('recent activity shows latest job', async ({ page }) => {
    const job = await createTestJob(user.accessToken, { company: 'Dash Corp' });

    await injectAuth(page, user);
    await page.goto('/');

    await expect(page.getByText('Dash Corp')).toBeVisible();

    await deleteTestJob(user.accessToken, job.id);
  });

  test('dashboard link in sidebar is active', async ({ page }) => {
    await injectAuth(page, user);
    await page.goto('/');

    // The sidebar "Dashboard" link should have the active class
    const dashboardLink = page.getByRole('link', { name: 'Dashboard' });
    await expect(dashboardLink).toHaveClass(/bg-indigo/);
  });

  test('sidebar shows logged-in user name and email', async ({ page }) => {
    await injectAuth(page, user);
    await page.goto('/');

    await expect(page.getByText(user.name)).toBeVisible();
    await expect(page.getByText(user.email)).toBeVisible();
  });
});
