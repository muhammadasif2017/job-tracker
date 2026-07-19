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

async function goToJob(page: Parameters<typeof injectAuth>[0], job: TestJob) {
  await injectAuth(page, user);
  await page.goto(`/jobs/${job.id}`);
  await expect(page.getByRole('heading', { name: job.company })).toBeVisible();
}

test.describe('Resume upload', () => {
  let job: TestJob;

  test.beforeEach(async () => {
    job = await createTestJob(user.accessToken, { company: 'Resume Co' });
  });

  test.afterEach(async () => {
    await deleteTestJob(user.accessToken, job.id).catch(() => {});
  });

  test('uploads a PDF and shows it attached', async ({ page }) => {
    await goToJob(page, job);

    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'resume.pdf',
        mimeType: 'application/pdf',
        buffer: pdfBuffer(1024),
      });

    await expect(page.getByText('Resume uploaded')).toBeVisible();
    await expect(page.getByText('resume.pdf')).toBeVisible();
  });

  test('rejects a non-PDF file client-side', async ({ page }) => {
    await goToJob(page, job);

    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'resume.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('not a pdf'),
      });

    await expect(page.getByText('Only PDF files are allowed')).toBeVisible();
    await expect(page.getByText('resume.txt')).not.toBeVisible();
  });

  test('rejects a PDF over 8 MB client-side', async ({ page }) => {
    await goToJob(page, job);

    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'big.pdf',
        mimeType: 'application/pdf',
        buffer: pdfBuffer(8 * 1024 * 1024 + 1),
      });

    await expect(page.getByText('File must be under 8 MB')).toBeVisible();
    await expect(page.getByText('big.pdf')).not.toBeVisible();
  });

  test('removes an attached resume after confirmation', async ({ page }) => {
    await goToJob(page, job);

    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: 'resume.pdf',
        mimeType: 'application/pdf',
        buffer: pdfBuffer(1024),
      });
    await expect(page.getByText('Resume uploaded')).toBeVisible();

    await page.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();

    await expect(page.getByText('Resume removed')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Attach Resume (PDF, max 8 MB)' }),
    ).toBeVisible();
  });
});
