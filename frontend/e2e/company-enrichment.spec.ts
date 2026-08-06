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

  test('a second enrichment request while one is in progress is rejected', async () => {
    // The job was just created, so its auto-queued run should still be
    // PENDING/PROCESSING. In CI there's no real GROQ_API_KEY/TAVILY_API_KEY,
    // so the worker's search+LLM calls fail fast (Tavily returns [] with no
    // network call at all when unset; Groq rejects the placeholder key
    // quickly) — the whole run can resolve to FAILED in well under 150ms,
    // occasionally racing ahead of this request and leaving nothing to
    // reject. That's a CI-environment timing artifact, not a bug in the
    // guard being tested (in production, real extraction takes real
    // seconds) — retry with a fresh job on a miss instead of asserting on
    // wall-clock luck.
    let res: Response | undefined;
    for (let attempt = 0; attempt < 5; attempt++) {
      const target =
        attempt === 0
          ? job
          : await createTestJob(user.accessToken, { company: 'Enrich Co' });
      res = await fetch(`${API}/jobs/${target.id}/enrichment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.accessToken}` },
      });
      if (target.id !== job.id) {
        await deleteTestJob(user.accessToken, target.id).catch(() => {});
      }
      if (res.status === 409) break;
    }
    expect(res?.status).toBe(409);
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
    // The refreshed run keeps the prior data visible while in flight (see
    // enrichment.service.ts — re-runs no longer null out fields), so the
    // in-flight label here is "Refreshing…"/"Queued…", not "Researching…"
    // (that word is first-run-only, when there's no prior data to show
    // alongside a skeleton). Real search + LLM extraction can also finish
    // fast enough locally to land on a terminal state before this assertion
    // runs — same class of timing race called out in the "second enrichment
    // request" test above — so accept the Refresh button reappearing too.
    await expect(
      page
        .getByText(/Queued…|Refreshing…/)
        .or(page.getByRole('button', { name: 'Refresh' })),
    ).toBeVisible();
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
