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
    await expect(page.getByText('This Month')).toBeVisible();

    // All stat cards should show 0 / 0%
    const cards = page.locator('text=/^0$|^0%$/');
    await expect(cards.first()).toBeVisible();
    await expect(page.getByText('No jobs tracked yet.')).toBeVisible();
    // "No data yet" appears three times: status chart, funnel chart, trend chart
    const noDataYet = page.getByText('No data yet');
    await expect(noDataYet).toHaveCount(3);
    await expect(noDataYet.nth(0)).toBeVisible();
    await expect(noDataYet.nth(1)).toBeVisible();
    await expect(noDataYet.nth(2)).toBeVisible();
  });

  test('increments total applications after a job is added', async ({
    page,
  }) => {
    const job = await createTestJob(user.accessToken);

    await injectAuth(page, user);
    await page.goto('/');

    // The "Total Applications" card value — scoped to the card's own
    // container (`.rounded-xl`), not a generic `div`, since "This Month"
    // also reads 1 here (job's appliedAt defaults to today).
    const totalCard = page
      .locator('.rounded-xl')
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

  test('funnel section populates after a job is added', async ({ page }) => {
    const job = await createTestJob(user.accessToken);

    await injectAuth(page, user);
    await page.goto('/');

    await expect(page.getByText('Application Funnel')).toBeVisible();
    await expect(page.getByText('No data yet')).toHaveCount(0);
    // "Dropoff" only renders in the populated branch of FunnelChart — proves
    // real funnel content rendered, not just that the empty state disappeared.
    await expect(page.getByText('Dropoff')).toBeVisible();

    await deleteTestJob(user.accessToken, job.id);
  });

  test('trend section populates after a job is added', async ({ page }) => {
    const job = await createTestJob(user.accessToken);

    await injectAuth(page, user);
    await page.goto('/');

    await expect(page.getByText('Applications Over Time')).toBeVisible();
    await expect(page.getByText('New applications')).toBeVisible();

    await deleteTestJob(user.accessToken, job.id);
  });

  test('range selector switches between 30d/90d/All without erroring', async ({
    page,
  }) => {
    const job = await createTestJob(user.accessToken);

    await injectAuth(page, user);
    await page.goto('/');

    const thirtyDay = page.getByRole('button', { name: '30d' });
    const ninetyDay = page.getByRole('button', { name: '90d' });
    const all = page.getByRole('button', { name: 'All' });

    // Defaults to 90d
    await expect(ninetyDay).toHaveClass(/bg-indigo/);

    await thirtyDay.click();
    await expect(thirtyDay).toHaveClass(/bg-indigo/);
    await expect(page.getByText('Total Applications')).toBeVisible();

    await all.click();
    await expect(all).toHaveClass(/bg-indigo/);
    await expect(page.getByText('Total Applications')).toBeVisible();

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
