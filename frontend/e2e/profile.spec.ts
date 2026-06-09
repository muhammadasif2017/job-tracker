import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, injectAuth, type TestUser } from './fixtures';

let user: TestUser;

test.beforeAll(async () => {
  user = await createTestUser();
});

test.afterAll(async () => {
  if (user) await deleteTestUser(user.accessToken);
});

async function goToProfile(page: Parameters<typeof injectAuth>[0], u: TestUser) {
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

  test('shows the Change Password section for an email-registered user', async ({ page }) => {
    await goToProfile(page, user);

    // The /users/me response has connectedProviders: [] so hasPassword is true
    await expect(page.getByRole('heading', { name: 'Change Password' })).toBeVisible();
  });

  test('does not show Connected Accounts section for email-only user', async ({ page }) => {
    await goToProfile(page, user);

    await expect(page.getByRole('heading', { name: 'Connected Accounts' })).not.toBeVisible();
  });

  test('updates name and reflects change in sidebar and profile header', async ({ page }) => {
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

  test('delete account redirects to /login and clears session', async ({ page }) => {
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
