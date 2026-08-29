import { test, expect, type Page } from '@playwright/test';
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

async function goToBoard(page: Page) {
  await injectAuth(page, user);
  await page.goto('/jobs');
  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();
  await page.getByRole('button', { name: 'Board' }).click();
}

// @hello-pangea/dnd ships full keyboard drag support (Space to lift, arrow
// keys to move, Space to drop) specifically because raw mouse simulation is
// unreliable in headless CI: its sensor's requestAnimationFrame-batched
// collision detection can silently miss synthetic pointer moves, so the lift
// and/or the final drop never register even though every event looks
// correct (confirmed here — a hardened mouse sequence still consistently
// timed out waiting for the resulting PATCH). Keyboard driving is
// deterministic and is the pattern the library's own docs recommend for
// tests. `columnsToTheRight` is how many columns over from the card's
// current column (KANBAN_COLS order in kanban-board.tsx) — WISHLIST →
// APPLIED is 1.
async function dragJobToColumn(
  page: Page,
  jobId: string,
  columnsToTheRight: number,
) {
  const handle = page.locator(
    `[data-rfd-drag-handle-draggable-id="${jobId}"]`,
  );
  await handle.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  for (let i = 0; i < columnsToTheRight; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);
  }
  await page.keyboard.press('Space');
}

// ── Columns ───────────────────────────────────────────────────────────────────

test.describe('Kanban columns', () => {
  test('shows only the four active-pipeline columns and places jobs correctly', async ({
    page,
  }) => {
    const jobs = await Promise.all([
      createTestJob(user.accessToken, { company: 'Wish Co', status: 'WISHLIST' }),
      createTestJob(user.accessToken, { company: 'App Co', status: 'APPLIED' }),
      createTestJob(user.accessToken, {
        company: 'Int Co',
        status: 'INTERVIEWING',
      }),
      createTestJob(user.accessToken, { company: 'Off Co', status: 'OFFER' }),
      createTestJob(user.accessToken, {
        company: 'Rej Co',
        status: 'REJECTED',
      }),
      createTestJob(user.accessToken, {
        company: 'Ghost Co',
        status: 'GHOSTED',
      }),
    ]);

    await goToBoard(page);

    await expect(
      page.locator('[data-rfd-droppable-id="WISHLIST"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-rfd-droppable-id="APPLIED"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-rfd-droppable-id="INTERVIEWING"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-rfd-droppable-id="OFFER"]'),
    ).toBeVisible();
    await expect(page.locator('[data-rfd-droppable-id="REJECTED"]')).toHaveCount(
      0,
    );
    await expect(page.locator('[data-rfd-droppable-id="GHOSTED"]')).toHaveCount(
      0,
    );

    await expect(page.getByText('Wish Co')).toBeVisible();
    await expect(page.getByText('Rej Co')).not.toBeVisible();
    await expect(page.getByText('Ghost Co')).not.toBeVisible();

    await expect(
      page.locator('[data-rfd-droppable-id="WISHLIST"]').getByText('Wish Co'),
    ).toBeVisible();
    await expect(
      page.locator('[data-rfd-droppable-id="OFFER"]').getByText('Off Co'),
    ).toBeVisible();

    for (const j of jobs) {
      await deleteTestJob(user.accessToken, j.id).catch(() => {});
    }
  });
});

// ── Card actions ──────────────────────────────────────────────────────────────

test.describe('Kanban card actions', () => {
  let job: TestJob;

  test.beforeEach(async () => {
    job = await createTestJob(user.accessToken, {
      company: 'Card Edit Co',
      status: 'APPLIED',
    });
  });

  test.afterEach(async () => {
    await deleteTestJob(user.accessToken, job.id).catch(() => {});
  });

  test('edit icon opens the edit modal prefilled for that job', async ({
    page,
  }) => {
    await goToBoard(page);

    const card = page.locator(`[data-rfd-draggable-id="${job.id}"]`);
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: `Edit ${job.company}` }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Edit Job' }),
    ).toBeVisible();
    await expect(dialog.getByPlaceholder('Google')).toHaveValue(job.company);
  });

  test('shows the job posting link icon only when a URL is set', async ({
    page,
  }) => {
    await fetch(`http://localhost:3001/jobs/${job.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.accessToken}`,
      },
      body: JSON.stringify({ url: 'https://example.com/job' }),
    });

    await goToBoard(page);

    const card = page.locator(`[data-rfd-draggable-id="${job.id}"]`);
    await expect(
      card.getByRole('link', { name: `View job posting for ${job.company}` }),
    ).toBeVisible();
  });

  test('hides the job posting link icon when no URL is set', async ({
    page,
  }) => {
    await goToBoard(page);

    const card = page.locator(`[data-rfd-draggable-id="${job.id}"]`);
    await expect(
      card.getByRole('link', { name: `View job posting for ${job.company}` }),
    ).not.toBeVisible();
  });
});

// ── Drag and drop ─────────────────────────────────────────────────────────────

test.describe('Kanban drag and drop', () => {
  let job: TestJob;

  test.beforeEach(async () => {
    job = await createTestJob(user.accessToken, {
      company: 'Drag Co',
      status: 'WISHLIST',
    });
  });

  test.afterEach(async () => {
    await deleteTestJob(user.accessToken, job.id).catch(() => {});
  });

  test('dragging a card to another column updates its status', async ({
    page,
  }) => {
    await goToBoard(page);

    // The board updates optimistically on drag, so the UI reflects the new
    // column before the PATCH has actually reached the backend — wait for
    // that response before verifying server state directly, or the fetch
    // below can race the mutation and read stale status.
    const [patchResponse] = await Promise.all([
      page.waitForResponse(
        (r) =>
          r.request().method() === 'PATCH' &&
          r.url().includes(`/jobs/${job.id}`),
      ),
      dragJobToColumn(page, job.id, 1),
    ]);
    expect(patchResponse.ok()).toBe(true);

    await expect(
      page.locator('[data-rfd-droppable-id="APPLIED"]').getByText('Drag Co'),
    ).toBeVisible();
    await expect(page.getByText('Failed to update status')).not.toBeVisible();

    const res = await fetch(`http://localhost:3001/jobs/${job.id}`, {
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    const updated = (await res.json()) as { status: string };
    expect(updated.status).toBe('APPLIED');
  });
});
