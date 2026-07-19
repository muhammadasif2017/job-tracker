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

// @hello-pangea/dnd renders `data-rfd-*` attributes on draggables/droppables.
// Its sensors need real, stepped mouse movement (not a single jump) plus a
// short pause after mousedown to register the drag — a plain click-and-move
// does not trigger it.
async function dragJobToColumn(
  page: Page,
  jobId: string,
  targetStatus: string,
) {
  const source = page.locator(
    `[data-rfd-drag-handle-draggable-id="${jobId}"]`,
  );
  const target = page.locator(`[data-rfd-droppable-id="${targetStatus}"]`);

  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('drag source/target not found');

  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2,
    sourceBox.y + sourceBox.height / 2,
  );
  await page.mouse.down();
  await page.waitForTimeout(200);
  await page.mouse.move(
    sourceBox.x + sourceBox.width / 2 + 10,
    sourceBox.y + sourceBox.height / 2,
    { steps: 5 },
  );
  await page.mouse.move(
    targetBox.x + targetBox.width / 2,
    targetBox.y + targetBox.height / 2,
    { steps: 10 },
  );
  await page.waitForTimeout(200);
  await page.mouse.up();
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

    await dragJobToColumn(page, job.id, 'APPLIED');

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
