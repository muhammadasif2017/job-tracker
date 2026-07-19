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

function futureDate(daysAhead: number): string {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];
}

async function goToJob(page: Parameters<typeof injectAuth>[0], job: TestJob) {
  await injectAuth(page, user);
  await page.goto(`/jobs/${job.id}`);
  await expect(page.getByRole('heading', { name: job.company })).toBeVisible();
}

test.describe('Interview rounds', () => {
  let job: TestJob;

  test.beforeEach(async () => {
    job = await createTestJob(user.accessToken, { company: 'Interview Co' });
  });

  test.afterEach(async () => {
    await deleteTestJob(user.accessToken, job.id).catch(() => {});
  });

  test('adds a round and shows it in the list', async ({ page }) => {
    await goToJob(page, job);

    await page.getByRole('button', { name: 'Add Round' }).click();
    await page.getByLabel('Stage').fill('Phone Screen');
    await page.getByLabel('Date').fill(futureDate(7));
    await page
      .getByLabel('Notes (optional)')
      .fill('Ask about on-call rotation');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Interview round added')).toBeVisible();
    await expect(page.getByText('Phone Screen')).toBeVisible();
    await expect(page.getByText('Ask about on-call rotation')).toBeVisible();
  });

  test('sets Next Interview from the earliest future PENDING round', async ({
    page,
  }) => {
    await goToJob(page, job);
    await expect(page.getByText('Next Interview')).not.toBeVisible();

    await page.getByRole('button', { name: 'Add Round' }).click();
    await page.getByLabel('Stage').fill('Phone Screen');
    await page.getByLabel('Date').fill(futureDate(7));
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Interview round added')).toBeVisible();

    await expect(page.getByText('Next Interview')).toBeVisible();
  });

  test('clears Next Interview when the round outcome changes away from PENDING', async ({
    page,
  }) => {
    await goToJob(page, job);

    await page.getByRole('button', { name: 'Add Round' }).click();
    await page.getByLabel('Stage').fill('Phone Screen');
    await page.getByLabel('Date').fill(futureDate(7));
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Next Interview')).toBeVisible();

    const roundRow = page.locator('li', { hasText: 'Phone Screen' });
    await roundRow.getByRole('combobox').selectOption('Failed');

    await expect(page.getByText('Outcome updated')).toBeVisible();
    await expect(page.getByText('Next Interview')).not.toBeVisible();
  });

  test('removes a round after confirmation', async ({ page }) => {
    await goToJob(page, job);

    await page.getByRole('button', { name: 'Add Round' }).click();
    await page.getByLabel('Stage').fill('Phone Screen');
    await page.getByLabel('Date').fill(futureDate(7));
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Phone Screen')).toBeVisible();

    const roundRow = page.locator('li', { hasText: 'Phone Screen' });
    await roundRow.getByRole('button').click();
    await page.getByRole('button', { name: 'Yes' }).click();

    await expect(page.getByText('Interview round removed')).toBeVisible();
    await expect(
      page.getByText('No interview rounds logged yet.'),
    ).toBeVisible();
  });
});
