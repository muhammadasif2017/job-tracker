// Loads the real unpacked extension into an actual Chromium instance -
// unlike test/*.test.js (which load background.js/popup.js into a vm
// sandbox or jsdom with hand-rolled chrome.* stubs), this drives the real
// extension through Playwright against real Chrome APIs.
//
// Extensions only load via --load-extension in *headed* Chromium (Playwright
// can't currently load extensions in real headless mode), so this suite
// needs a display - on Linux CI that means running under Xvfb.
//
// Scope: chrome.permissions.request() for an optional host permission
// shows a native Chrome permission bubble that isn't part of the page DOM
// and can't be reliably driven through Playwright locators, so the
// permission-gated connect flow (and everything past it - import, create)
// is intentionally NOT covered here. That flow already has real coverage
// in test/popup-dom.test.js and test/background.test.js, both of which
// mock chrome.permissions.request directly and don't hit real browser UI.
// This suite covers only what happens before that prompt would appear.
import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.join(dirname, '..');

async function launchWithExtension(): Promise<BrowserContext> {
  return chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });
}

async function getExtensionId(context: BrowserContext): Promise<string> {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker');
  return worker.url().split('/')[2];
}

test('shows the disconnected view with the default backend URL on first open', async () => {
  const context = await launchWithExtension();
  try {
    const extensionId = await getExtensionId(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(page.locator('#connect-view')).toBeVisible();
    await expect(page.locator('#import-view')).toBeHidden();
    await expect(page.locator('#backend-url')).toHaveValue('http://localhost:3001');
  } finally {
    await context.close();
  }
});

test('rejects a plain-http non-localhost backend URL before any permission prompt can appear', async () => {
  const context = await launchWithExtension();
  try {
    const extensionId = await getExtensionId(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    await page.locator('#backend-url').fill('http://api.example.com');
    await page.locator('#pat-token').fill('jt_pat_x.y');
    await page.locator('#connect-submit').click();

    await expect(page.locator('#error')).toBeVisible();
    await expect(page.locator('#error')).toContainText(/must use https/i);
    // Still on the connect view - the rejection happened client-side,
    // before chrome.permissions.request (and therefore before any prompt).
    await expect(page.locator('#connect-view')).toBeVisible();
  } finally {
    await context.close();
  }
});

test('accepts an https backend URL locally (localhost exception) up to the permission request', async () => {
  const context = await launchWithExtension();
  try {
    const extensionId = await getExtensionId(context);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup.html`);

    await page.locator('#backend-url').fill('http://localhost:3001');
    await page.locator('#pat-token').fill('jt_pat_x.y');
    await page.locator('#connect-submit').click();

    // No client-side scheme error for the localhost exception - the button
    // proceeds to request the host permission, which is as far as this
    // suite can reliably drive without a real permission-prompt handler.
    await expect(page.locator('#error')).toBeHidden();
  } finally {
    await context.close();
  }
});
