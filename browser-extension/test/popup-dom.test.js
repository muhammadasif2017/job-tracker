// @vitest-environment jsdom
//
// Exercises popup.js against a real DOM (parsed from the actual
// popup.html), driving it via real events - not through the vm sandbox
// used elsewhere in this directory. background.js is not involved here;
// chrome.runtime.sendMessage is mocked directly to simulate whatever the
// background service worker would have replied, so this suite is testing
// popup.js's own DOM wiring in isolation (it already has its own coverage
// in background.test.js).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.join(dirname, '..');

function loadPopupIntoDom({ sendMessage, permissionsRequest, tabsQuery, scriptingExecuteScript } = {}) {
  const html = fs.readFileSync(path.join(extensionRoot, 'popup.html'), 'utf8');
  const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
  const bodyHtml = bodyMatch[1].replace(/<script[^>]*><\/script>\s*/g, '');
  document.body.innerHTML = bodyHtml;

  globalThis.chrome = {
    runtime: {
      sendMessage:
        sendMessage ??
        vi.fn((_msg, resolve) =>
          resolve({ ok: true, connected: false, backendUrl: 'http://localhost:3001' }),
        ),
    },
    permissions: { request: permissionsRequest ?? vi.fn().mockResolvedValue(true) },
    tabs: { query: tabsQuery ?? vi.fn().mockResolvedValue([]) },
    scripting: {
      executeScript: scriptingExecuteScript ?? vi.fn().mockResolvedValue([{ result: '' }]),
    },
  };

  // Wrapped in an IIFE and re-run fresh per test - vm.runInThisContext ties
  // top-level const/function declarations to a persistent realm-scoped
  // environment (like a REPL), so running the *same* top-level `const`
  // twice across tests throws a redeclaration SyntaxError. Wrapping in a
  // function scope sidesteps that; each call gets its own fresh bindings
  // that close over the DOM just inserted above.
  const configSrc = fs.readFileSync(path.join(extensionRoot, 'config.js'), 'utf8');
  const popupSrc = fs.readFileSync(path.join(extensionRoot, 'popup.js'), 'utf8');
  vm.runInThisContext(`(function () {\n${configSrc}\n${popupSrc}\n})();`, {
    filename: 'popup-harness.js',
  });
}

function submit(form) {
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

function click(el) {
  el.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
}

// popup.js's handlers are async and not awaited by dispatchEvent - give
// their promise chains a tick to run before asserting on the DOM.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('popup.js DOM wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the disconnected view with the default backend URL on load when nothing is connected', async () => {
    loadPopupIntoDom();
    await flush();

    expect(document.getElementById('connect-view').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('import-view').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('backend-url').value).toBe('http://localhost:3001');
  });

  it('renders the connected view with the stored backend URL on load when already connected', async () => {
    loadPopupIntoDom({
      sendMessage: vi.fn((_msg, resolve) =>
        resolve({ ok: true, connected: true, backendUrl: 'https://api.example.com' }),
      ),
    });
    await flush();

    expect(document.getElementById('connect-view').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('import-view').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('connected-url').textContent).toBe('https://api.example.com');
  });

  it('recovers instead of crashing when the background script is unreachable on load', async () => {
    // Simulates the MV3 service worker being evicted right as the popup
    // opens: chrome invokes the callback with response=undefined and sets
    // runtime.lastError, rather than never calling back at all.
    const sendMessage = vi.fn((_msg, resolve) => {
      globalThis.chrome.runtime.lastError = {
        message: 'Could not establish connection. Receiving end does not exist.',
      };
      resolve(undefined);
      delete globalThis.chrome.runtime.lastError;
    });
    loadPopupIntoDom({ sendMessage });
    await flush();

    expect(document.getElementById('connect-view').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('import-view').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('error').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('error').textContent).toMatch(/could not establish connection/i);
  });

  it('rejects a plain-http non-localhost backend URL before ever requesting permission or sending a message', async () => {
    const permissionsRequest = vi.fn().mockResolvedValue(true);
    const sendMessage = vi.fn((_msg, resolve) => resolve({ ok: true, connected: false }));
    loadPopupIntoDom({ permissionsRequest, sendMessage });
    await flush();

    document.getElementById('backend-url').value = 'http://api.example.com';
    document.getElementById('pat-token').value = 'jt_pat_x.y';
    submit(document.getElementById('connect-form'));
    await flush();

    expect(document.getElementById('error').textContent).toMatch(/must use https/i);
    expect(document.getElementById('error').classList.contains('hidden')).toBe(false);
    expect(permissionsRequest).not.toHaveBeenCalled();
    // The initial status-check call on load is fine; connect must not fire.
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('shows an error and does not connect when the requested host permission is denied', async () => {
    const permissionsRequest = vi.fn().mockResolvedValue(false);
    loadPopupIntoDom({ permissionsRequest });
    await flush();

    document.getElementById('backend-url').value = 'https://api.example.com';
    document.getElementById('pat-token').value = 'jt_pat_x.y';
    submit(document.getElementById('connect-form'));
    await flush();

    expect(permissionsRequest).toHaveBeenCalledWith({
      origins: ['https://api.example.com/*'],
    });
    expect(document.getElementById('error').textContent).toMatch(/permission/i);
    expect(document.getElementById('connect-view').classList.contains('hidden')).toBe(false);
  });

  it('connects successfully: clears the token field and switches to the import view', async () => {
    const sendMessage = vi.fn((msg, resolve) => {
      if (msg.type === 'status') return resolve({ ok: true, connected: false });
      if (msg.type === 'connect') return resolve({ ok: true });
      resolve({ ok: false, error: 'unexpected message in test' });
    });
    loadPopupIntoDom({ sendMessage });
    await flush();

    document.getElementById('backend-url').value = 'https://api.example.com';
    document.getElementById('pat-token').value = 'jt_pat_secret';
    submit(document.getElementById('connect-form'));
    await flush();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'connect',
        backendUrl: 'https://api.example.com',
        patToken: 'jt_pat_secret',
      }),
      expect.any(Function),
    );
    expect(document.getElementById('pat-token').value).toBe('');
    expect(document.getElementById('import-view').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('connected-url').textContent).toBe('https://api.example.com');
  });

  it('shows the background-reported error and stays disconnected when connect fails (e.g. invalid PAT)', async () => {
    const sendMessage = vi.fn((msg, resolve) => {
      if (msg.type === 'status') return resolve({ ok: true, connected: false });
      if (msg.type === 'connect') return resolve({ ok: false, error: 'Invalid access token' });
      resolve({ ok: false });
    });
    loadPopupIntoDom({ sendMessage });
    await flush();

    document.getElementById('backend-url').value = 'https://api.example.com';
    document.getElementById('pat-token').value = 'bad-token';
    submit(document.getElementById('connect-form'));
    await flush();

    expect(document.getElementById('error').textContent).toBe('Invalid access token');
    expect(document.getElementById('connect-view').classList.contains('hidden')).toBe(false);
  });

  it('disconnect: sends the disconnect message and returns to the disconnected view', async () => {
    const sendMessage = vi.fn((msg, resolve) => {
      if (msg.type === 'status') return resolve({ ok: true, connected: true, backendUrl: 'https://api.example.com' });
      if (msg.type === 'disconnect') return resolve({ ok: true });
      resolve({ ok: false });
    });
    loadPopupIntoDom({ sendMessage });
    await flush();
    expect(document.getElementById('import-view').classList.contains('hidden')).toBe(false);

    click(document.getElementById('disconnect-link'));
    await flush();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'disconnect' }, expect.any(Function));
    expect(document.getElementById('connect-view').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('import-view').classList.contains('hidden')).toBe(true);
  });

  it('import: reads the active tab URL and page text, parses the job, and populates the preview form', async () => {
    const tabsQuery = vi.fn().mockResolvedValue([{ id: 7, url: 'https://jobs.example.com/123' }]);
    const scriptingExecuteScript = vi.fn().mockResolvedValue([{ result: 'Senior Engineer at Acme...' }]);
    const sendMessage = vi.fn((msg, resolve) => {
      if (msg.type === 'status') return resolve({ ok: true, connected: true, backendUrl: 'https://api.example.com' });
      if (msg.type === 'parseJob') {
        return resolve({
          ok: true,
          data: {
            company: 'Acme',
            position: 'Engineer',
            location: 'Remote',
            jobType: 'REMOTE',
            applicationChannel: 'LINKEDIN',
            url: 'https://jobs.example.com/123',
          },
        });
      }
      resolve({ ok: false });
    });
    loadPopupIntoDom({ sendMessage, tabsQuery, scriptingExecuteScript });
    await flush();

    click(document.getElementById('import-button'));
    await flush();

    expect(scriptingExecuteScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 7 } }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      {
        type: 'parseJob',
        url: 'https://jobs.example.com/123',
        text: 'Senior Engineer at Acme...',
      },
      expect.any(Function),
    );
    expect(document.getElementById('field-company').value).toBe('Acme');
    expect(document.getElementById('field-position').value).toBe('Engineer');
    expect(document.getElementById('field-location').value).toBe('Remote');
    expect(document.getElementById('field-job-type').value).toBe('REMOTE');
    expect(document.getElementById('field-application-channel').value).toBe('LINKEDIN');
    expect(document.getElementById('preview-form').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('import-ready').classList.contains('hidden')).toBe(true);
  });

  it('import: shows an error and does not open the preview form when parseJob fails', async () => {
    const tabsQuery = vi.fn().mockResolvedValue([{ url: 'https://jobs.example.com/123' }]);
    const sendMessage = vi.fn((msg, resolve) => {
      if (msg.type === 'status') return resolve({ ok: true, connected: true, backendUrl: 'https://api.example.com' });
      if (msg.type === 'parseJob') return resolve({ ok: false, error: 'Could not reach page' });
      resolve({ ok: false });
    });
    loadPopupIntoDom({ sendMessage, tabsQuery });
    await flush();

    click(document.getElementById('import-button'));
    await flush();

    expect(document.getElementById('error').textContent).toBe('Could not reach page');
    expect(document.getElementById('preview-form').classList.contains('hidden')).toBe(true);
  });

  it('preview submit: sends createJob with the edited fields and shows the success message', async () => {
    const tabsQuery = vi.fn().mockResolvedValue([{ url: 'https://jobs.example.com/123' }]);
    const sendMessage = vi.fn((msg, resolve) => {
      if (msg.type === 'status') return resolve({ ok: true, connected: true, backendUrl: 'https://api.example.com' });
      if (msg.type === 'parseJob') {
        return resolve({
          ok: true,
          data: { company: 'Acme', position: 'Engineer', url: 'https://jobs.example.com/123' },
        });
      }
      if (msg.type === 'createJob') return resolve({ ok: true, data: { id: 'job-1' } });
      resolve({ ok: false });
    });
    loadPopupIntoDom({ sendMessage, tabsQuery });
    await flush();

    click(document.getElementById('import-button'));
    await flush();

    document.getElementById('field-position').value = 'Senior Engineer';
    submit(document.getElementById('preview-form'));
    await flush();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'createJob',
        payload: expect.objectContaining({
          company: 'Acme',
          position: 'Senior Engineer',
          url: 'https://jobs.example.com/123',
        }),
      }),
      expect.any(Function),
    );
    expect(document.getElementById('success').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('preview-form').classList.contains('hidden')).toBe(true);
  });

  it('preview cancel: returns to the ready-to-import state without sending a message', async () => {
    const tabsQuery = vi.fn().mockResolvedValue([{ url: 'https://jobs.example.com/123' }]);
    const sendMessage = vi.fn((msg, resolve) => {
      if (msg.type === 'status') return resolve({ ok: true, connected: true, backendUrl: 'https://api.example.com' });
      if (msg.type === 'parseJob') {
        return resolve({ ok: true, data: { company: 'Acme', position: 'Engineer' } });
      }
      resolve({ ok: false });
    });
    loadPopupIntoDom({ sendMessage, tabsQuery });
    await flush();

    click(document.getElementById('import-button'));
    await flush();
    sendMessage.mockClear();

    click(document.getElementById('preview-cancel'));
    await flush();

    expect(document.getElementById('preview-form').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('import-ready').classList.contains('hidden')).toBe(false);
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
