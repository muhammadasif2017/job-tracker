import { test, expect } from '@playwright/test';
import {
  createTestUser,
  deleteTestUser,
  createTestJob,
  deleteTestJob,
  injectAuth,
  type TestUser,
  type TestJob,
} from './fixtures';

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser();
});

test.afterAll(async () => {
  if (user) await deleteTestUser(user.accessToken);
});

// Helper: open an authenticated /jobs page
async function goToJobs(page: Parameters<typeof injectAuth>[0]) {
  await injectAuth(page, user);
  await page.goto('/jobs');
  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();
}

// ── List view ─────────────────────────────────────────────────────────────────

test.describe('Jobs list', () => {
  test('shows empty state for a fresh account', async ({ page }) => {
    await goToJobs(page);
    await expect(page.getByText('No jobs found')).toBeVisible();
  });

  test('shows job count in subtitle after adding jobs', async ({ page }) => {
    const job = await createTestJob(user.accessToken);

    await goToJobs(page);
    await expect(page.getByText('1 applications tracked')).toBeVisible();

    await deleteTestJob(user.accessToken, job.id);
  });
});

// ── Create ────────────────────────────────────────────────────────────────────

test.describe('Create job', () => {
  test('adds a job and shows it in the list', async ({ page }) => {
    await goToJobs(page);

    await page.getByRole('button', { name: 'Add Job' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByPlaceholder('Google').fill('New Corp');
    await dialog.getByPlaceholder('Senior Engineer').fill('QA Lead');
    await dialog.locator('select').selectOption('INTERVIEWING');
    await dialog.getByRole('button', { name: 'Add job' }).click();

    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('cell', { name: 'New Corp' })).toBeVisible();
    await expect(page.getByRole('cell').filter({ hasText: 'Interviewing' })).toBeVisible();

    // Clean up via API
    const res = await fetch(
      `http://localhost:3001/jobs?search=New+Corp`,
      { headers: { Authorization: `Bearer ${user.accessToken}` } },
    );
    const { data } = (await res.json()) as { data: Array<{ id: string }> };
    if (data[0]) await deleteTestJob(user.accessToken, data[0].id);
  });

  test('shows validation error when company is missing', async ({ page }) => {
    await goToJobs(page);

    await page.getByRole('button', { name: 'Add Job' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Add job' }).click();

    await expect(dialog.getByText('Company is required')).toBeVisible();
  });
});

// ── Edit ──────────────────────────────────────────────────────────────────────

test.describe('Edit job', () => {
  let job: TestJob;

  test.beforeEach(async () => {
    job = await createTestJob(user.accessToken, { company: 'Edit Corp' });
  });

  test.afterEach(async () => {
    if (job) await deleteTestJob(user.accessToken, job.id).catch(() => {});
  });

  test('updates job details', async ({ page }) => {
    await goToJobs(page);

    const row = page.locator('tr').filter({ hasText: 'Edit Corp' });
    // Edit button is the first icon button in the row actions
    await row.getByRole('button').first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Edit Job' })).toBeVisible();

    await dialog.getByPlaceholder('Google').fill('Updated Corp');
    await dialog.getByRole('button', { name: 'Save changes' }).click();

    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole('cell', { name: 'Updated Corp' })).toBeVisible();
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────

test.describe('Delete job', () => {
  test('removes job from the list immediately', async ({ page }) => {
    const job = await createTestJob(user.accessToken, { company: 'Delete Corp' });

    await goToJobs(page);
    await expect(page.getByRole('cell', { name: 'Delete Corp' })).toBeVisible();

    const row = page.locator('tr').filter({ hasText: 'Delete Corp' });
    await row.getByRole('button').last().click(); // trash icon

    await expect(page.getByRole('cell', { name: 'Delete Corp' })).not.toBeVisible();
    await expect(page.getByText('Job deleted')).toBeVisible();

    // Already deleted via UI; ignore API cleanup error
    await deleteTestJob(user.accessToken, job.id).catch(() => {});
  });
});

// ── Search ────────────────────────────────────────────────────────────────────

test.describe('Search', () => {
  let jobA: TestJob;
  let jobB: TestJob;

  test.beforeAll(async () => {
    jobA = await createTestJob(user.accessToken, { company: 'Alpha Inc', position: 'Frontend Dev' });
    jobB = await createTestJob(user.accessToken, { company: 'Beta Ltd', position: 'Backend Dev' });
  });

  test.afterAll(async () => {
    await deleteTestJob(user.accessToken, jobA.id).catch(() => {});
    await deleteTestJob(user.accessToken, jobB.id).catch(() => {});
  });

  test('filters jobs by company name', async ({ page }) => {
    await goToJobs(page);

    await page.getByPlaceholder('Search company or position…').fill('Alpha');
    // Wait for the 300ms debounce + network response
    await expect(page.getByRole('cell', { name: 'Alpha Inc' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Beta Ltd' })).not.toBeVisible({ timeout: 3000 });
  });

  test('filters jobs by position', async ({ page }) => {
    await goToJobs(page);

    await page.getByPlaceholder('Search company or position…').fill('Backend');
    await expect(page.getByRole('cell', { name: 'Beta Ltd' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Alpha Inc' })).not.toBeVisible({ timeout: 3000 });
  });

  test('shows empty state when search has no results', async ({ page }) => {
    await goToJobs(page);

    await page.getByPlaceholder('Search company or position…').fill('ZZZNoMatch');
    await expect(page.getByText('No jobs found')).toBeVisible();
  });
});

// ── Status filter ─────────────────────────────────────────────────────────────

test.describe('Status filter', () => {
  let applied: TestJob;
  let interviewing: TestJob;

  test.beforeAll(async () => {
    applied = await createTestJob(user.accessToken, { company: 'Applied Co', status: 'APPLIED' });
    interviewing = await createTestJob(user.accessToken, {
      company: 'Interview Co',
      status: 'INTERVIEWING',
    });
  });

  test.afterAll(async () => {
    await deleteTestJob(user.accessToken, applied.id).catch(() => {});
    await deleteTestJob(user.accessToken, interviewing.id).catch(() => {});
  });

  test('shows only jobs matching selected status', async ({ page }) => {
    await goToJobs(page);

    // The status filter select is the first select on the page (outside a dialog)
    await page.locator('select').first().selectOption('INTERVIEWING');

    await expect(page.getByRole('cell', { name: 'Interview Co' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Applied Co' })).not.toBeVisible();
  });

  test('shows all jobs when filter is cleared', async ({ page }) => {
    await goToJobs(page);

    await page.locator('select').first().selectOption('APPLIED');
    await page.locator('select').first().selectOption('');

    await expect(page.getByRole('cell', { name: 'Applied Co' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Interview Co' })).toBeVisible();
  });
});

// ── Detail page ───────────────────────────────────────────────────────────────

test.describe('Job detail page', () => {
  let job: TestJob;

  test.beforeAll(async () => {
    job = await createTestJob(user.accessToken, { company: 'Detail Corp', position: 'PM' });
  });

  test.afterAll(async () => {
    await deleteTestJob(user.accessToken, job.id).catch(() => {});
  });

  test('navigates to detail page by clicking company name', async ({ page }) => {
    await goToJobs(page);

    await page.getByRole('link', { name: 'Detail Corp' }).click();

    await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}`));
    await expect(page.getByRole('heading', { name: 'Detail Corp' })).toBeVisible();
    await expect(page.getByText('PM')).toBeVisible();
  });

  test('changes status via dropdown and adds timeline entry', async ({ page }) => {
    await injectAuth(page, user);
    await page.goto(`/jobs/${job.id}`);

    await expect(page.getByRole('heading', { name: 'Detail Corp' })).toBeVisible();

    // Status select on the detail page
    const statusSelect = page.locator('select').first();
    await statusSelect.selectOption('OFFER');

    // Timeline should reflect the change
    await expect(page.getByText('Status changed')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('list').getByText('Offer')).toBeVisible();
  });

  test('delete button removes job and returns to /jobs', async ({ page }) => {
    const toDelete = await createTestJob(user.accessToken, { company: 'ToDelete Corp' });

    await injectAuth(page, user);
    await page.goto(`/jobs/${toDelete.id}`);

    await page.getByRole('button', { name: 'Delete' }).click();

    await expect(page).toHaveURL('/jobs');
    await expect(page.getByText('Job deleted')).toBeVisible();
  });
});
