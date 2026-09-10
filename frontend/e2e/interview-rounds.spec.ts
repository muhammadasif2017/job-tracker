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

// A value for `<input type="datetime-local">`: local calendar fields, no
// offset. The app converts it to a real instant before sending (ADR-035).
function futureDateTime(daysAhead: number, hour = 14): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  d.setHours(hour, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    await page.getByLabel('Date & time').fill(futureDateTime(7));
    await page
      .getByLabel('Notes (optional)')
      .fill('Ask about on-call rotation');
    await page.getByLabel('Length (minutes)').fill('45');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Interview round added')).toBeVisible();
    await expect(page.getByText('Phone Screen', { exact: true })).toBeVisible();
    await expect(page.getByText('Ask about on-call rotation')).toBeVisible();
    // The row shows the time of day and the length, not a bare date.
    await expect(page.getByText(/2:00 PM . 45 min/)).toBeVisible();
  });

  test('records the scheduled time in the Timeline entry', async ({ page }) => {
    await goToJob(page, job);

    await page.getByRole('button', { name: 'Add Round' }).click();
    await page.getByLabel('Stage').fill('Phone Screen');
    await page.getByLabel('Date & time').fill(futureDateTime(7));
    await page.getByLabel('Length (minutes)').fill('45');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Interview round added')).toBeVisible();

    // The note is written once, at create time, so it carries the slot the
    // user picked rather than the moment the event row was inserted.
    await expect(page.getByText(/Phone Screen - .*2:00 PM/)).toBeVisible();
  });

  test('sets Next Interview from the earliest future PENDING round', async ({
    page,
  }) => {
    await goToJob(page, job);
    await expect(page.getByText('Next Interview')).not.toBeVisible();

    await page.getByRole('button', { name: 'Add Round' }).click();
    await page.getByLabel('Stage').fill('Phone Screen');
    await page.getByLabel('Date & time').fill(futureDateTime(7));
    await page.getByLabel('Length (minutes)').fill('45');
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
    await page.getByLabel('Date & time').fill(futureDateTime(7));
    await page.getByLabel('Length (minutes)').fill('45');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Next Interview')).toBeVisible();

    const roundRow = page.locator('li', { hasText: 'Phone Screen' });
    await roundRow.getByRole('combobox').selectOption('Failed');

    await expect(page.getByText('Outcome updated')).toBeVisible();
    await expect(page.getByText('Next Interview')).not.toBeVisible();
  });

  test('corrects a wrong date in place, without delete and re-add', async ({
    page,
  }) => {
    await goToJob(page, job);

    await page.getByRole('button', { name: 'Add Round' }).click();
    await page.getByLabel('Stage').fill('Phone Screen');
    await page.getByLabel('Date & time').fill(futureDateTime(7));
    await page.getByLabel('Length (minutes)').fill('45');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Interview round added')).toBeVisible();

    const roundRow = page.locator('li', { hasText: 'Phone Screen' });
    await roundRow.getByRole('button', { name: 'Edit Phone Screen' }).click();
    await expect(page.getByLabel('Date & time')).toHaveValue(futureDateTime(7));

    await page.getByLabel('Date & time').fill(futureDateTime(14));
    await page.getByLabel('Stage').fill('Onsite');
    await page.getByLabel('Length (minutes)').fill('90');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Interview round updated')).toBeVisible();
    await expect(page.getByText('Onsite', { exact: true })).toBeVisible();
    await expect(page.getByText(/1 hr 30 min/)).toBeVisible();
    await expect(
      page.getByText('Phone Screen', { exact: true }),
    ).not.toBeVisible();
    await expect(page.locator('li', { hasText: 'Onsite' })).toHaveCount(1);
  });

  test('removes a round after confirmation', async ({ page }) => {
    await goToJob(page, job);

    await page.getByRole('button', { name: 'Add Round' }).click();
    await page.getByLabel('Stage').fill('Phone Screen');
    await page.getByLabel('Date & time').fill(futureDateTime(7));
    await page.getByLabel('Length (minutes)').fill('45');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Phone Screen', { exact: true })).toBeVisible();

    const roundRow = page.locator('li', { hasText: 'Phone Screen' });
    await roundRow.getByRole('button', { name: 'Remove round' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();

    await expect(page.getByText('Interview round removed')).toBeVisible();
    await expect(
      page.getByText('No interview rounds logged yet.'),
    ).toBeVisible();
  });
});
