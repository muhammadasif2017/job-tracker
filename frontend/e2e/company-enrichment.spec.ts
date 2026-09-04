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
    // Racing a single extra request against the auto-queued run from job
    // creation isn't reliable in either direction: locally, a real search +
    // LLM round trip takes real seconds, so the auto-queued run is still
    // PENDING/PROCESSING for a while; in CI (or once the auto-queued run
    // hits the empty-context fail-fast guard in
    // company-enrichment.processor.ts), it can resolve in well under a
    // millisecond, leaving nothing to conflict with by the time our request
    // lands. Either way, betting on one extra request's timing against a
    // run we don't control is a coin flip.
    //
    // Instead: wait for the auto-queued run to reach a terminal state first
    // (same signal as "reaches a terminal state" above), then race two of
    // *our own* requests against each other. triggerEnrichment's guard
    // (companies.service.ts) is a single `updateMany` CAS on the Company
    // row, and Postgres serializes two concurrent UPDATEs against the same
    // row at the DB level — whichever commits first flips status to PENDING
    // and gets 202, the second re-evaluates the WHERE clause against that
    // now-updated row and gets 409. That's deterministic regardless of how
    // fast either run actually processes.
    for (let attempt = 0; attempt < 90; attempt++) {
      const res = await fetch(`${API}/jobs/${job.id}`, {
        headers: { Authorization: `Bearer ${user.accessToken}` },
      });
      const body = (await res.json()) as {
        companyProfile?: { status?: string } | null;
      };
      const status = body.companyProfile?.status;
      if (status !== 'PENDING' && status !== 'PROCESSING') break;
      await new Promise((r) => setTimeout(r, 500));
    }

    // Company-scoped, not job-scoped (docs/specs/company-fk-phase3b.md).
    const [res1, res2] = await Promise.all([
      fetch(`${API}/companies/${job.companyId}/enrichment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.accessToken}` },
      }),
      fetch(`${API}/companies/${job.companyId}/enrichment`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${user.accessToken}` },
      }),
    ]);

    expect([res1.status, res2.status].sort()).toEqual([202, 409]);
  });

  test('Refresh re-queues enrichment and returns to a queued state', async ({
    page,
  }) => {
    // Deterministic like the FAILED-enrichment test below — real enrichment
    // (especially the empty-context fail-fast path) can now resolve faster
    // than the browser can observe the in-flight state, so this mocks the
    // network boundary instead of racing a live run.
    let profileStatus: 'COMPLETED' | 'PENDING' = 'COMPLETED';

    await page.route(`${API}/jobs/${job.id}`, async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.companyProfile =
        profileStatus === 'COMPLETED'
          ? {
              status: 'COMPLETED',
              industry: 'Fintech',
              enrichedAt: '2026-01-01T00:00:00Z',
            }
          : {
              status: 'PENDING',
              industry: 'Fintech',
              enrichedAt: '2026-01-01T00:00:00Z',
            };
      await route.fulfill({ response, json: body });
    });

    // Company-scoped, not job-scoped (docs/specs/company-fk-phase3b.md) —
    // the Refresh button hits POST /companies/:companyId/enrichment.
    await page.route(
      `${API}/companies/${job.companyId}/enrichment`,
      async (route) => {
        profileStatus = 'PENDING';
        await route.fulfill({
          status: 202,
          json: { message: 'Enrichment queued' },
        });
      },
    );

    await goToJob(page, job);

    const refreshButton = page.getByRole('button', { name: 'Refresh' });
    await expect(refreshButton).toBeVisible();

    await refreshButton.click();
    await expect(page.getByText('Enrichment queued')).toBeVisible();
    // The refreshed run keeps the prior data visible while in flight (see
    // enrichment.service.ts — re-runs no longer null out fields), so the
    // in-flight label here is "Refreshing…"/"Queued…", not "Researching…"
    // (that word is first-run-only, when there's no prior data to show
    // alongside a skeleton).
    await expect(page.getByText(/Queued…|Refreshing…/)).toBeVisible();
    await expect(page.getByText('Fintech')).toBeVisible();
  });

  test('FAILED enrichment shows a friendly failure message (never raw backend text) and Refresh re-queues it', async ({
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

    // Company-scoped, not job-scoped (docs/specs/company-fk-phase3b.md) —
    // the Refresh button hits POST /companies/:companyId/enrichment.
    await page.route(
      `${API}/companies/${job.companyId}/enrichment`,
      async (route) => {
        status = 'PENDING';
        await route.fulfill({
          status: 202,
          json: { message: 'Enrichment queued' },
        });
      },
    );

    await goToJob(page, job);

    // Raw backend error text must never reach the UI — an unrecognized
    // failure shape (see company-profile-card.tsx's classifyFailure) always
    // renders the generic friendly message instead.
    await expect(page.getByText(/couldn't complete/)).toBeVisible();
    await expect(page.getByText('No search results found')).not.toBeVisible();
    const refreshButton = page.getByRole('button', { name: 'Refresh' });
    await expect(refreshButton).toBeVisible();

    await refreshButton.click();
    await expect(page.getByText('Enrichment queued')).toBeVisible();
    await expect(page.getByText('Queued…')).toBeVisible();
  });
});

// ADR-035. API-level, no page needed — this is about what the server does on
// job creation, not what the card renders.
//
// Deliberately a separate describe: the block above reuses one company name
// across every test, so by its second test the company is already enriched
// and its assertions can't tell "correctly skipped" from "gate broken". Each
// test here takes a name nothing else has touched.
test.describe('Company enrichment auto-trigger gate', () => {
  const createdJobIds: string[] = [];

  const isInFlight = (s: string | null | undefined) =>
    s === 'PENDING' || s === 'PROCESSING';

  async function addJob(company: string): Promise<TestJob> {
    const job = await createTestJob(user.accessToken, { company });
    createdJobIds.push(job.id);
    return job;
  }

  async function statusOf(jobId: string): Promise<string | null | undefined> {
    const res = await fetch(`${API}/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    const body = (await res.json()) as {
      companyProfile?: { status?: string | null } | null;
    };
    return body.companyProfile?.status;
  }

  // The auto-queued run does real search + LLM work, so "settled" has to be
  // polled for rather than assumed.
  async function waitForTerminalStatus(
    jobId: string,
  ): Promise<string | null | undefined> {
    let status = await statusOf(jobId);
    for (let attempt = 0; attempt < 90 && isInFlight(status); attempt++) {
      await new Promise((r) => setTimeout(r, 500));
      status = await statusOf(jobId);
    }
    return status;
  }

  test.afterAll(async () => {
    await Promise.all(
      createdJobIds.map((id) => deleteTestJob(user.accessToken, id)),
    );
  });

  // Guards the catastrophic-but-silent failure: enqueueIfStale gates on
  // `status: null`, and if that ever stopped compiling to `IS NULL` the CAS
  // would match nothing, no run would ever be queued, and status would sit
  // at null forever. Every other test in this file would still pass — a
  // null-status profile renders the same Refresh button that COMPLETED and
  // FAILED do (company-profile-card.tsx), which is the signal they key off.
  test('a job at a brand-new company actually queues a run', async () => {
    const job = await addJob(`Gate New Co ${Date.now()}`);

    expect(job.companyId).toBeTruthy();
    // Not `toBe('PENDING')` — the worker is real and may already have moved
    // the row to PROCESSING or past it. Any non-null status proves the CAS
    // matched and the enqueue happened.
    expect(await statusOf(job.id)).not.toBeNull();
    expect(await statusOf(job.id)).toBeDefined();
  });

  // The leak this ADR exists to close: before the gate, every job added at an
  // already-enriched company re-ran the whole pipeline (1-2 Tavily
  // searches, doubled by the retry policy) to rediscover facts already on the
  // row.
  test('a second job at the same company does not re-queue enrichment', async () => {
    const company = `Gate Repeat Co ${Date.now()}`;
    const first = await addJob(company);

    const settled = await waitForTerminalStatus(first.id);
    expect(isInFlight(settled)).toBe(false);

    const second = await addJob(company);
    expect(second.companyId).toBe(first.companyId);

    // The whole point: the second add must leave the terminal status alone.
    // A regression here flips it back to PENDING and spends search credits.
    expect(await statusOf(second.id)).toBe(settled);
    expect(isInFlight(await statusOf(second.id))).toBe(false);
  });
});
