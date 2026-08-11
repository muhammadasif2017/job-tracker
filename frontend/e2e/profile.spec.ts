import { test, expect } from '@playwright/test';
import {
  createTestUser,
  deleteTestUser,
  injectAuth,
  type TestUser,
} from './fixtures';

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser();
});

test.afterAll(async () => {
  if (user) await deleteTestUser(user.accessToken);
});

async function goToProfile(
  page: Parameters<typeof injectAuth>[0],
  u: TestUser,
) {
  await injectAuth(page, u);
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
}

test.describe('Profile page', () => {
  test('displays the current user name and email', async ({ page }) => {
    await goToProfile(page, user);

    await expect(page.getByText(user.name).first()).toBeVisible();
    await expect(page.getByText(user.email).first()).toBeVisible();
  });

  test('shows the Change Password section for an email-registered user', async ({
    page,
  }) => {
    await goToProfile(page, user);

    // The /users/me response has connectedProviders: [] so hasPassword is true
    await expect(
      page.getByRole('heading', { name: 'Change Password' }),
    ).toBeVisible();
  });

  test('does not show Connected Accounts section for email-only user', async ({
    page,
  }) => {
    await goToProfile(page, user);

    await expect(
      page.getByRole('heading', { name: 'Connected Accounts' }),
    ).not.toBeVisible();
  });

  test('updates name and reflects change in sidebar and profile header', async ({
    page,
  }) => {
    await goToProfile(page, user);

    const nameInput = page.getByLabel('Name');
    await nameInput.fill('Updated Name');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByText('Profile updated')).toBeVisible();

    // Sidebar reflects the Zustand store update
    await expect(page.getByText('Updated Name').first()).toBeVisible();

    // Restore the original name so subsequent tests still find `user.name`
    await nameInput.fill(user.name);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Profile updated')).toBeVisible();
  });

  test('shows validation error when name is cleared', async ({ page }) => {
    await goToProfile(page, user);

    await page.getByLabel('Name').fill('');
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByText('Name is required')).toBeVisible();
  });

  test('changes password successfully', async ({ page }) => {
    // Use a dedicated user so we can change the password without affecting other tests
    const pwUser = await createTestUser('-pw');
    await goToProfile(page, pwUser);

    await page.getByLabel('Current password').fill(pwUser.password);
    await page.getByLabel('New password', { exact: true }).fill('NewPass456!');
    await page.getByLabel('Confirm new password').fill('NewPass456!');
    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByText('Password changed')).toBeVisible();

    await deleteTestUser(pwUser.accessToken);
  });

  test('shows error when current password is wrong', async ({ page }) => {
    await goToProfile(page, user);

    await page.getByLabel('Current password').fill('WrongPassword!');
    await page.getByLabel('New password', { exact: true }).fill('NewPass456!');
    await page.getByLabel('Confirm new password').fill('NewPass456!');
    await page.getByRole('button', { name: 'Update password' }).click();

    await expect(page.getByText('Current password is incorrect')).toBeVisible();
  });

  test('updates email notification preferences', async ({ page }) => {
    await goToProfile(page, user);

    // The notifications form's RHF `values` option resets from the profile
    // query the moment it resolves, which can race a rapid-fire uncheck +
    // selectOption fired right after page load, submitting the query's
    // still-default snapshot instead of these edits. Assert the fields
    // reflect the (query-settled) starting state, then the edits, before
    // submitting — matches how a real user's slower interaction naturally
    // avoids the race.
    await expect(page.getByLabel(/email me a reminder/i)).toBeChecked();
    await expect(page.getByLabel('Email digest')).toHaveValue('OFF');
    await page.getByLabel(/email me a reminder/i).uncheck();
    await page.getByLabel('Email digest').selectOption('WEEKLY');
    await expect(page.getByLabel(/email me a reminder/i)).not.toBeChecked();
    await expect(page.getByLabel('Email digest')).toHaveValue('WEEKLY');
    await page.getByRole('button', { name: 'Save preferences' }).click();

    await expect(
      page.getByText('Notification preferences updated'),
    ).toBeVisible();

    // Wait for the reload's fresh GET before asserting on the form state,
    // rather than relying on the default assertion poll window.
    const [profileResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'GET' && r.url().includes('/users/me'),
      ),
      page.reload(),
    ]);
    expect(profileResponse.ok()).toBe(true);
    await expect(page.getByLabel(/email me a reminder/i)).not.toBeChecked();
    await expect(page.getByLabel('Email digest')).toHaveValue('WEEKLY');

    // Restore defaults so subsequent tests see a clean state
    await page.getByLabel(/email me a reminder/i).check();
    await page.getByLabel('Email digest').selectOption('OFF');
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(
      page.getByText('Notification preferences updated'),
    ).toBeVisible();
  });

  test('updates timezone and persists across reload', async ({ page }) => {
    await goToProfile(page, user);

    await expect(page.getByLabel('Timezone')).toHaveValue('UTC');
    await page.getByLabel('Timezone').selectOption('Asia/Karachi');
    await page.getByRole('button', { name: 'Save preferences' }).click();

    await expect(
      page.getByText('Notification preferences updated'),
    ).toBeVisible();

    const [profileResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'GET' && r.url().includes('/users/me'),
      ),
      page.reload(),
    ]);
    expect(profileResponse.ok()).toBe(true);
    await expect(page.getByLabel('Timezone')).toHaveValue('Asia/Karachi');

    // Restore default so subsequent tests see a clean state
    await page.getByLabel('Timezone').selectOption('UTC');
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(
      page.getByText('Notification preferences updated'),
    ).toBeVisible();
  });

  test('generates a personal access token and displays the raw value exactly once', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await goToProfile(page, user);

    await page.getByRole('button', { name: 'Generate token' }).click();

    const modal = page.getByRole('dialog');
    await expect(
      modal.getByRole('heading', { name: 'Generate access token' }),
    ).toBeVisible();
    await modal.getByLabel('Name').fill('E2E extension token');
    await modal.getByRole('button', { name: 'Generate' }).click();

    await expect(
      modal.getByRole('heading', { name: 'Token created' }),
    ).toBeVisible();
    const tokenCode = modal.locator('code');
    await expect(tokenCode).toContainText(/^jt_pat_/);

    await modal.getByRole('button', { name: 'Copy' }).click();
    await expect(page.getByText('Copied to clipboard')).toBeVisible();

    await modal.getByRole('button', { name: 'Done' }).click();
    await expect(modal).not.toBeVisible();

    const row = page.locator('li', { hasText: 'E2E extension token' });
    await expect(row).toBeVisible();
    await expect(row.getByText('Never used')).toBeVisible();

    // Clean up so this token doesn't linger against the shared `user`
    await row.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByText('Token revoked')).toBeVisible();
    await expect(row).not.toBeVisible();
  });

  test('shows a validation error and does not create a token when the name is empty', async ({
    page,
  }) => {
    await goToProfile(page, user);

    await page.getByRole('button', { name: 'Generate token' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Generate' }).click();

    await expect(modal.getByText('Required')).toBeVisible();
    // Still on the name form, not the one-time reveal - nothing was created.
    await expect(
      modal.getByRole('heading', { name: 'Generate access token' }),
    ).toBeVisible();
  });

  test('revokes a personal access token and removes it from the list', async ({
    page,
  }) => {
    await goToProfile(page, user);

    await page.getByRole('button', { name: 'Generate token' }).click();
    const modal = page.getByRole('dialog');
    await modal.getByLabel('Name').fill('Token to revoke');
    await modal.getByRole('button', { name: 'Generate' }).click();
    await expect(modal.locator('code')).toContainText(/^jt_pat_/);
    await modal.getByRole('button', { name: 'Done' }).click();

    const row = page.locator('li', { hasText: 'Token to revoke' });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Revoke' }).click();

    await expect(page.getByText('Token revoked')).toBeVisible();
    await expect(row).not.toBeVisible();

    // Persists across reload - it's really gone server-side, not just hidden client-side.
    await page.reload();
    await expect(
      page.locator('li', { hasText: 'Token to revoke' }),
    ).not.toBeVisible();
  });

  test('delete account redirects to /login and clears session', async ({
    page,
  }) => {
    const toDelete = await createTestUser('-del');
    await goToProfile(page, toDelete);

    await page.getByRole('button', { name: 'Delete account' }).click();

    // Confirmation modal
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Yes, delete my account' }).click();

    await expect(page).toHaveURL('/login');

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'jt_authed')).toBeUndefined();
  });
});
