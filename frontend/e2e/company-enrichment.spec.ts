import { test, expect } from '@playwright/test';
import {
  API,
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

async function goToJob(page: Parameters<typeof injectAuth>[0], job: TestJob) {
  await injectAuth(page, user);
  await page.goto(`/jobs/${job.id}`);
  // First hit of this route can be slow under Turbopack dev's lazy compile.
  await expect(
    page.getByRole('heading', { name: job.company }),
  ).toBeVisible({ timeout: 15_000 });
}

test.describe('Company enrichment card', () => {
  let job: TestJob;

  test.beforeEach(async () => {
    // Job creation auto-queues enrichment server-side (jobs.service.ts) — no
    // manual trigger needed to get a profile into PENDING.
    job = await createTestJob(user.accessToken, { company: 'Enrich Co' });
  });

  test.afterEach(async () => {
    await deleteTestJob(user.accessToken, job.id).catch(() => {});
  });

  test('shows the enrichment card immediately after job creation', async ({
    page,
  }) => {
    await goToJob(page, job);

    await expect(page.getByText('Company Profile')).toBeVisible();
    // Real enrichment can complete in a couple of seconds, so the run may
    // already be in-flight or already terminal by the time we check — either
    // is fine here, the point is the card never renders blank or broken.
    await expect(
      page
        .getByText(/Queued…|Researching…/)
        .or(page.getByRole('button', { name: 'Refresh' })),
    ).toBeVisible();
  });

  test('reaches a terminal state (completed or failed) instead of hanging', async ({
    page,
  }) => {
    await goToJob(page, job);

    // Worker does a real search + LLM extraction; give it real time to finish.
    // Both COMPLETED and FAILED render a "Refresh" button — PENDING/PROCESSING
    // do not — so its appearance is the terminal-state signal either way.
    await expect(
      page.getByRole('button', { name: 'Refresh' }),
    ).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Queued…|Researching…/)).not.toBeVisible();
  });

  test('a second enrichment request while one is in progress is rejected', async ({
    page,
  }) => {
    // The job was just created, so its auto-queued run is still PENDING/PROCESSING.
    const res = await fetch(`${API}/jobs/${job.id}/enrichment`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    expect(res.status).toBe(409);
  });

  test('Refresh re-queues enrichment and returns to a queued state', async ({
    page,
  }) => {
    await goToJob(page, job);

    // Wait for the auto-queued run to finish so Refresh is available and the
    // manual trigger below is unambiguous (not just the original run).
    const refreshButton = page.getByRole('button', { name: 'Refresh' });
    await expect(refreshButton).toBeVisible({ timeout: 45_000 });

    await refreshButton.click();
    await expect(page.getByText('Enrichment queued')).toBeVisible();
    await expect(page.getByText(/Queued…|Researching…/)).toBeVisible();
  });

  test('FAILED enrichment shows the error message and Refresh re-queues it', async ({
    page,
  }) => {
    // Real enrichment rarely fails, so the FAILED branch is mocked at the
    // network boundary to make this deterministic instead of racing a live
    // search + LLM run toward failure.
    let status: 'FAILED' | 'PENDING' = 'FAILED';

    await page.route(`${API}/jobs/${job.id}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.companyProfile =
        status === 'FAILED'
          ? { status: 'FAILED', errorMessage: 'No search results found' }
          : { status: 'PENDING' };
      await route.fulfill({ response, json: body });
    });

    await page.route(`${API}/jobs/${job.id}/enrichment`, async (route) => {
      status = 'PENDING';
      await route.fulfill({ status: 202, json: { message: 'Enrichment queued' } });
    });

    await goToJob(page, job);

    await expect(page.getByText('No search results found')).toBeVisible();
    const refreshButton = page.getByRole('button', { name: 'Refresh' });
    await expect(refreshButton).toBeVisible();

    await refreshButton.click();
    await expect(page.getByText('Enrichment queued')).toBeVisible();
    await expect(page.getByText('Queued…')).toBeVisible();
  });
});
