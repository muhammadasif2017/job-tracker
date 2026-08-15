import { test, expect } from '@playwright/test';
import {
  createTestUser,
  deleteTestUser,
  createTestCompany,
  deleteTestCompany,
  createTestJob,
  deleteTestJob,
  injectAuth,
  type TestUser,
  type TestCompany,
  type TestJob,
} from './fixtures';

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser();
});

test.afterAll(async () => {
  if (user) await deleteTestUser(user.accessToken);
});

async function goToCompanies(page: Parameters<typeof injectAuth>[0]) {
  await injectAuth(page, user);
  await page.goto('/companies');
  await expect(
    page.getByRole('heading', { name: 'Target Companies' }),
  ).toBeVisible();
}

// ── List view ─────────────────────────────────────────────────────────────────

test.describe('Companies list', () => {
  test('shows empty state for a fresh account', async ({ page }) => {
    await goToCompanies(page);
    await expect(page.getByText('No target companies yet')).toBeVisible();
  });

  test('shows company count in subtitle after adding a company', async ({
    page,
  }) => {
    const company = await createTestCompany(user.accessToken, {
      name: 'Count Co',
    });

    await goToCompanies(page);
    await expect(page.getByText('1 companies saved')).toBeVisible();

    await deleteTestCompany(user.accessToken, company.id);
  });
});

// ── Create ────────────────────────────────────────────────────────────────────

test.describe('Create company', () => {
  test('adds a company and shows it in the list', async ({ page }) => {
    await goToCompanies(page);

    await page.getByRole('button', { name: 'Add Company' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByLabel(/name/i).fill('New Target Co');
    await dialog.getByRole('button', { name: 'Add company' }).click();

    await expect(dialog).not.toBeVisible();
    await expect(page.getByText('Company added')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'New Target Co' }),
    ).toBeVisible();

    const res = await fetch(
      `http://localhost:3001/companies?search=New+Target+Co`,
      { headers: { Authorization: `Bearer ${user.accessToken}` } },
    );
    const { data } = (await res.json()) as { data: Array<{ id: string }> };
    if (data[0]) await deleteTestCompany(user.accessToken, data[0].id);
  });

  test('shows validation error when name is missing', async ({ page }) => {
    await goToCompanies(page);

    await page.getByRole('button', { name: 'Add Company' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Add company' }).click();

    await expect(dialog.getByText('Name is required')).toBeVisible();
  });

  test('shows a conflict error when adding a case-insensitive duplicate name', async ({
    page,
  }) => {
    const existing = await createTestCompany(user.accessToken, {
      name: 'Dup Co',
    });

    await goToCompanies(page);
    await page.getByRole('button', { name: 'Add Company' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/name/i).fill('dup co');
    await dialog.getByRole('button', { name: 'Add company' }).click();

    await expect(
      page.getByText('A company named "dup co" already exists'),
    ).toBeVisible();
    await expect(dialog).toBeVisible();

    await deleteTestCompany(user.accessToken, existing.id);
  });
});

// ── Edit ──────────────────────────────────────────────────────────────────────

test.describe('Edit company', () => {
  let company: TestCompany;

  test.beforeEach(async () => {
    company = await createTestCompany(user.accessToken, {
      name: 'Edit Target Co',
    });
  });

  test.afterEach(async () => {
    if (company)
      await deleteTestCompany(user.accessToken, company.id).catch(() => {});
  });

  test('updates company details', async ({ page }) => {
    await goToCompanies(page);

    const row = page.locator('tr').filter({ hasText: 'Edit Target Co' });
    await row.getByRole('button', { name: /^edit/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Edit Target Company' }),
    ).toBeVisible();

    await dialog.getByLabel(/name/i).fill('Updated Target Co');
    await dialog.getByRole('button', { name: 'Save changes' }).click();

    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Updated Target Co' }),
    ).toBeVisible();
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────

test.describe('Delete company', () => {
  test('removes company from the list immediately', async ({ page }) => {
    const company = await createTestCompany(user.accessToken, {
      name: 'Delete Target Co',
    });

    await goToCompanies(page);
    await expect(
      page.getByRole('link', { name: 'Delete Target Co' }),
    ).toBeVisible();

    const row = page.locator('tr').filter({ hasText: 'Delete Target Co' });
    await row.getByRole('button', { name: /^delete/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Delete company?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Delete' }).click();

    await expect(
      page.getByRole('link', { name: 'Delete Target Co' }),
    ).not.toBeVisible();
    await expect(page.getByText('Company deleted')).toBeVisible();

    await deleteTestCompany(user.accessToken, company.id).catch(() => {});
  });
});

// ── Merge companies ──────────────────────────────────────────────────────────

test.describe('Merge companies', () => {
  test('merges a duplicate into the canonical company via the row action', async ({
    page,
  }) => {
    const canonical = await createTestCompany(user.accessToken, {
      name: 'Merge E2E Canonical',
    });
    const duplicate = await createTestCompany(user.accessToken, {
      name: 'Merge E2E Duplicate',
    });

    await goToCompanies(page);

    const row = page.locator('tr').filter({ hasText: 'Merge E2E Canonical' });
    await row.getByRole('button', { name: /merge merge e2e canonical/i }).click();

    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByText('Merge into Merge E2E Canonical'),
    ).toBeVisible();

    await dialog
      .getByLabel('Search for a duplicate company')
      .fill('Merge E2E Duplicate');
    await dialog.getByText('Merge E2E Duplicate', { exact: true }).click();

    await expect(
      dialog.getByRole('button', { name: 'Merge companies' }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Merge companies' }).click();

    await expect(page.getByText('Companies merged')).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Merge E2E Duplicate' }),
    ).not.toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Merge E2E Canonical' }),
    ).toBeVisible();

    await deleteTestCompany(user.accessToken, canonical.id).catch(() => {});
  });
});

// ── Search & filters ──────────────────────────────────────────────────────────

test.describe('Search and filters', () => {
  let alpha: TestCompany;
  let beta: TestCompany;

  test.beforeAll(async () => {
    alpha = await createTestCompany(user.accessToken, {
      name: 'Alpha Target',
      city: 'LAHORE',
    });
    beta = await createTestCompany(user.accessToken, {
      name: 'Beta Target',
      city: 'KARACHI',
    });
  });

  test.afterAll(async () => {
    await deleteTestCompany(user.accessToken, alpha.id).catch(() => {});
    await deleteTestCompany(user.accessToken, beta.id).catch(() => {});
  });

  test('filters companies by name search', async ({ page }) => {
    await goToCompanies(page);

    await page.getByPlaceholder('Search company name…').fill('Alpha');
    await expect(
      page.getByRole('link', { name: 'Alpha Target' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Beta Target' }),
    ).not.toBeVisible({ timeout: 3000 });
  });

  test('filters companies by city', async ({ page }) => {
    await goToCompanies(page);

    await page.getByLabel('Filter by city').selectOption('KARACHI');
    await expect(
      page.getByRole('link', { name: 'Beta Target' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Alpha Target' }),
    ).not.toBeVisible();
  });
});

// ── Detail page ───────────────────────────────────────────────────────────────

test.describe('Company detail page', () => {
  let company: TestCompany;

  test.beforeAll(async () => {
    company = await createTestCompany(user.accessToken, {
      name: 'Detail Target Co',
    });
  });

  test.afterAll(async () => {
    await deleteTestCompany(user.accessToken, company.id).catch(() => {});
  });

  test('navigates to detail page by clicking the company name', async ({
    page,
  }) => {
    await goToCompanies(page);

    await page.getByRole('link', { name: 'Detail Target Co' }).click();

    await expect(page).toHaveURL(new RegExp(`/companies/${company.id}`));
    await expect(
      page.getByRole('heading', { name: 'Detail Target Co' }),
    ).toBeVisible();
  });

  test('delete button removes company and returns to /companies', async ({
    page,
  }) => {
    const toDelete = await createTestCompany(user.accessToken, {
      name: 'ToDelete Target Co',
    });

    await injectAuth(page, user);
    await page.goto(`/companies/${toDelete.id}`);
    await expect(
      page.getByRole('heading', { name: 'ToDelete Target Co' }),
    ).toBeVisible();

    await page.getByRole('button', { name: /^delete/i }).click();

    await expect(page).toHaveURL('/companies');
    await expect(page.getByText('Company deleted')).toBeVisible();
  });
});

// ── CSV import ────────────────────────────────────────────────────────────────

test.describe('CSV import', () => {
  test('imports valid rows and shows the imported count', async ({
    page,
  }) => {
    await goToCompanies(page);

    await page.getByRole('button', { name: 'Import CSV' }).click();
    const dialog = page.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Import Companies from CSV' }),
    ).toBeVisible();

    await dialog.getByLabel('CSV file').setInputFiles({
      name: 'companies.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'name,city,businessMode\nCsv Import Co,LAHORE,SERVICES',
      ),
    });
    await dialog.getByRole('button', { name: 'Import' }).click();

    await expect(page.getByText('Imported 1 companies')).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Csv Import Co' }),
    ).toBeVisible();

    const res = await fetch(
      `http://localhost:3001/companies?search=Csv+Import+Co`,
      { headers: { Authorization: `Bearer ${user.accessToken}` } },
    );
    const { data } = (await res.json()) as { data: Array<{ id: string }> };
    if (data[0]) await deleteTestCompany(user.accessToken, data[0].id);
  });

  test('reports per-row errors without failing the whole import', async ({
    page,
  }) => {
    await goToCompanies(page);

    await page.getByRole('button', { name: 'Import CSV' }).click();
    const dialog = page.getByRole('dialog');

    await dialog.getByLabel('CSV file').setInputFiles({
      name: 'companies.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'name,city,businessMode\nGood Row Co,LAHORE,SERVICES\nBad Row Co,NotACity,SERVICES',
      ),
    });
    await dialog.getByRole('button', { name: 'Import' }).click();

    await expect(
      page.getByText('Imported 1 companies, 1 row(s) skipped'),
    ).toBeVisible();
    await expect(dialog.getByText(/Invalid city/)).toBeVisible();

    await dialog.getByRole('button', { name: 'Done' }).click();

    const res = await fetch(
      `http://localhost:3001/companies?search=Good+Row+Co`,
      { headers: { Authorization: `Bearer ${user.accessToken}` } },
    );
    const { data } = (await res.json()) as { data: Array<{ id: string }> };
    if (data[0]) await deleteTestCompany(user.accessToken, data[0].id);
  });
});

// ── Company contacts ──────────────────────────────────────────────────────────

test.describe('Company contacts', () => {
  let company: TestCompany;

  test.beforeEach(async () => {
    company = await createTestCompany(user.accessToken, {
      name: 'Contacts Target Co',
    });
  });

  test.afterEach(async () => {
    if (company)
      await deleteTestCompany(user.accessToken, company.id).catch(() => {});
  });

  async function goToCompanyDetail(page: Parameters<typeof injectAuth>[0]) {
    await injectAuth(page, user);
    await page.goto(`/companies/${company.id}`);
    await expect(
      page.getByRole('heading', { name: 'Contacts Target Co' }),
    ).toBeVisible();
  }

  test('adds a contact and shows it in the list', async ({ page }) => {
    await goToCompanyDetail(page);

    await page.getByRole('button', { name: 'Add Contact' }).click();
    await page.getByLabel('Name').fill('Jane Recruiter');
    await page.getByLabel(/role/i).fill('Talent Acquisition');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Contact added')).toBeVisible();
    await expect(page.getByText('Jane Recruiter')).toBeVisible();
    await expect(page.getByText('Talent Acquisition')).toBeVisible();
  });

  test('edits an existing contact', async ({ page }) => {
    await goToCompanyDetail(page);

    await page.getByRole('button', { name: 'Add Contact' }).click();
    await page.getByLabel('Name').fill('Jane Recruiter');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Contact added')).toBeVisible();

    await page
      .getByRole('button', { name: 'Edit Jane Recruiter' })
      .click();
    await page.getByLabel('Name').fill('Jane Updated');
    await page.getByRole('button', { name: 'Save' }).click();

    await expect(page.getByText('Contact updated')).toBeVisible();
    await expect(page.getByText('Jane Updated')).toBeVisible();
    await expect(page.getByText('Jane Recruiter')).not.toBeVisible();
  });

  test('removes a contact after confirmation', async ({ page }) => {
    await goToCompanyDetail(page);

    await page.getByRole('button', { name: 'Add Contact' }).click();
    await page.getByLabel('Name').fill('Jane Recruiter');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Contact added')).toBeVisible();

    await page
      .getByRole('button', { name: 'Remove Jane Recruiter' })
      .click();
    await page
      .getByRole('button', { name: 'Confirm remove Jane Recruiter' })
      .click();

    await expect(page.getByText('Contact removed')).toBeVisible();
    await expect(page.getByText('Jane Recruiter')).not.toBeVisible();
  });
});

// ── Job ↔ company match banner ────────────────────────────────────────────────

test.describe('Job creation matches an existing target company', () => {
  let company: TestCompany;

  test.beforeEach(async () => {
    company = await createTestCompany(user.accessToken, {
      name: 'Match Corp',
    });
  });

  test.afterEach(async () => {
    if (company)
      await deleteTestCompany(user.accessToken, company.id).catch(() => {});
  });

  test('shows a banner linking to the target company when the job company name matches', async ({
    page,
  }) => {
    await injectAuth(page, user);
    await page.goto('/jobs');
    await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();

    await page.getByRole('button', { name: 'Add Job' }).click();
    const dialog = page.getByRole('dialog');
    // Case-insensitive exact match against the saved company name.
    await dialog.getByPlaceholder('Google').fill('match corp');
    await dialog.getByPlaceholder('Senior Engineer').fill('SWE');
    await dialog.getByRole('button', { name: 'Add job' }).click();

    await expect(
      dialog.getByRole('heading', { name: 'Job Added' }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('link', { name: 'Match Corp' }),
    ).toBeVisible();
    await expect(
      dialog.getByText('as a target company'),
    ).toBeVisible();

    // Clean up the created job via API.
    const res = await fetch(`http://localhost:3001/jobs?search=match+corp`, {
      headers: { Authorization: `Bearer ${user.accessToken}` },
    });
    const { data } = (await res.json()) as { data: Array<TestJob> };
    if (data[0]) await deleteTestJob(user.accessToken, data[0].id);
  });

  test('does not show the banner when no company name matches', async ({
    page,
  }) => {
    await injectAuth(page, user);
    await page.goto('/jobs');

    await page.getByRole('button', { name: 'Add Job' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('Google').fill('Totally Unmatched Inc');
    await dialog.getByPlaceholder('Senior Engineer').fill('SWE');
    await dialog.getByRole('button', { name: 'Add job' }).click();

    await expect(
      dialog.getByRole('heading', { name: 'Job Added' }),
    ).toBeVisible();
    await expect(dialog.getByText('as a target company')).not.toBeVisible();

    const res = await fetch(
      `http://localhost:3001/jobs?search=Totally+Unmatched+Inc`,
      { headers: { Authorization: `Bearer ${user.accessToken}` } },
    );
    const { data } = (await res.json()) as { data: Array<TestJob> };
    if (data[0]) await deleteTestJob(user.accessToken, data[0].id);
  });
});
