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

// Minimal buffer with a real PDF magic-number header — enough for the
// backend's FileTypeValidator (magic-number sniffing) to accept it.
function pdfBuffer(size: number): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(size, 'a')]);
}

// ── Modal overflow ────────────────────────────────────────────────────────────

test.describe('Add Job modal on a short viewport', () => {
  test('modal stays within the viewport height and Save is reachable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 400, height: 600 });
    await injectAuth(page, user);
    await page.goto('/jobs');

    await page.getByRole('button', { name: 'Add Job' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeLessThanOrEqual(600);

    // Save sits below the fold of the tall form — reachable by scrolling the
    // modal's own overflow-y-auto body, not the page. Playwright's click
    // auto-scrolls the target into view, so a successful click proves that.
    await dialog.getByPlaceholder('Google').fill('Short Viewport Co');
    await dialog.getByPlaceholder('Senior Engineer').fill('Tester');
    await dialog.getByRole('button', { name: 'Add job' }).click();

    await expect(
      dialog.getByRole('heading', { name: 'Job Added' }),
    ).toBeVisible();

    const res = await fetch(
      `http://localhost:3001/jobs?search=Short+Viewport+Co`,
      { headers: { Authorization: `Bearer ${user.accessToken}` } },
    );
    const { data } = (await res.json()) as { data: Array<{ id: string }> };
    if (data[0]) await deleteTestJob(user.accessToken, data[0].id);
  });
});

// ── Mobile sidebar ────────────────────────────────────────────────────────────

test.describe('Mobile navigation', () => {
  test('sidebar is off-canvas until the hamburger menu is opened', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await injectAuth(page, user);
    await page.goto('/');

    const jobsLink = page.getByRole('link', { name: 'Jobs' });
    await expect(jobsLink).not.toBeInViewport();

    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(jobsLink).toBeInViewport();

    await jobsLink.click();
    await expect(page).toHaveURL('/jobs');
  });
});

// ── Resume upload row ─────────────────────────────────────────────────────────

test.describe('Resume upload on a narrow viewport', () => {
  let job: TestJob;

  test.beforeEach(async () => {
    job = await createTestJob(user.accessToken, { company: 'Narrow Co' });
  });

  test.afterEach(async () => {
    await deleteTestJob(user.accessToken, job.id).catch(() => {});
  });

  test('attached resume actions wrap instead of overflowing horizontally', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await injectAuth(page, user);
    await page.goto(`/jobs/${job.id}`);
    await expect(
      page.getByRole('heading', { name: 'Narrow Co' }),
    ).toBeVisible();

    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'resume.pdf',
        mimeType: 'application/pdf',
        buffer: pdfBuffer(1024),
      });
    await expect(page.getByText('Resume uploaded')).toBeVisible();

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
});
