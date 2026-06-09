import { test, expect } from '@playwright/test';
import { createTestUser, deleteTestUser, injectAuth } from './fixtures';

// ── Registration ──────────────────────────────────────────────────────────────

test.describe('Registration', () => {
  test('valid form creates account and lands on dashboard', async ({
    page,
  }) => {
    const email = `e2e-${Date.now()}@test.dev`;

    await page.goto('/register');
    await page.getByLabel('Name').fill('Test User');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('E2ePass123!');
    await page.getByLabel('Confirm password').fill('E2ePass123!');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { name: 'Dashboard' }),
    ).toBeVisible();
    await expect(page.getByText('Test User')).toBeVisible(); // sidebar

    const token = await page.evaluate(() => localStorage.getItem('jt_access'));
    if (token) await deleteTestUser(token);
  });

  test('shows error for duplicate email', async ({ page }) => {
    const user = await createTestUser();

    await page.goto('/register');
    await page.getByLabel('Name').fill('Dup User');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password', { exact: true }).fill('E2ePass123!');
    await page.getByLabel('Confirm password').fill('E2ePass123!');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('Email already in use')).toBeVisible();
    await expect(page).toHaveURL('/register');

    await deleteTestUser(user.accessToken);
  });

  test('shows error when password is too short', async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Name').fill('Test User');
    await page.getByLabel('Email').fill('x@test.dev');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByLabel('Confirm password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(
      page.getByText('Password must be at least 8 characters'),
    ).toBeVisible();
    await expect(page).toHaveURL('/register');
  });

  test("shows error when passwords don't match", async ({ page }) => {
    await page.goto('/register');
    await page.getByLabel('Name').fill('Test User');
    await page.getByLabel('Email').fill('x@test.dev');
    await page.getByLabel('Password', { exact: true }).fill('E2ePass123!');
    await page.getByLabel('Confirm password').fill('Different456!');
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText("Passwords don't match")).toBeVisible();
    await expect(page).toHaveURL('/register');
  });
});

// ── Login ─────────────────────────────────────────────────────────────────────

test.describe('Login', () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;

  test.beforeAll(async () => {
    user = await createTestUser();
  });

  test.afterAll(async () => {
    if (user) await deleteTestUser(user.accessToken);
  });

  test('valid credentials land on dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { name: 'Dashboard' }),
    ).toBeVisible();
  });

  test('wrong password shows error and stays on /login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Password').fill('WrongPass999!');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid credentials')).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  test('unknown email shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@test.dev');
    await page.getByLabel('Password').fill('E2ePass123!');
    await page.getByRole('button', { name: 'Sign in' }).click();

    await expect(page.getByText('Invalid credentials')).toBeVisible();
    await expect(page).toHaveURL('/login');
  });
});

// ── Logout ────────────────────────────────────────────────────────────────────

test.describe('Logout', () => {
  test('clears session and redirects to /login', async ({ page }) => {
    const user = await createTestUser();
    await injectAuth(page, user);

    await page.goto('/');
    await page.getByText('Sign out').click();

    await expect(page).toHaveURL('/login');

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'jt_authed')).toBeUndefined();

    // Token is gone from localStorage
    const token = await page.evaluate(() => localStorage.getItem('jt_access'));
    expect(token).toBeNull();

    await deleteTestUser(user.accessToken);
  });
});

// ── Route protection ──────────────────────────────────────────────────────────

test.describe('Protected routes', () => {
  test('unauthenticated / redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });

  test('unauthenticated /jobs redirects to /login', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page).toHaveURL('/login');
  });

  test('unauthenticated /profile redirects to /login', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).toHaveURL('/login');
  });

  test('authenticated user visiting /login is redirected to /', async ({
    page,
  }) => {
    const user = await createTestUser();
    await injectAuth(page, user);

    await page.goto('/login');
    await expect(page).toHaveURL('/');

    await deleteTestUser(user.accessToken);
  });

  test('authenticated user visiting /register is redirected to /', async ({
    page,
  }) => {
    const user = await createTestUser();
    await injectAuth(page, user);

    await page.goto('/register');
    await expect(page).toHaveURL('/');

    await deleteTestUser(user.accessToken);
  });
});
