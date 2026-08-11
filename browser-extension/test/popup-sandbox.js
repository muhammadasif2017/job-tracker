// Loads popup.js into an isolated vm context, same approach as
// background.js's sandbox.js. popup.js wires up DOM elements and event
// listeners at top level (it's a classic script, run once when the popup
// opens), so a minimal document/chrome stub is enough to let it load
// without throwing - this harness exists to reach the pure logic inside
// (isAllowedBackendUrl), not to exercise the DOM wiring.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.join(dirname, '..');

function stubElement() {
  return {
    value: '',
    textContent: '',
    dataset: {},
    classList: { add() {}, remove() {} },
    addEventListener() {},
  };
}

export function loadPopup({ chrome } = {}) {
  const document = { getElementById: () => stubElement() };
  const defaultChrome = {
    runtime: {
      sendMessage: (_msg, resolve) =>
        resolve({ ok: true, connected: false, backendUrl: 'http://localhost:3001' }),
    },
    permissions: { request: async () => true },
    tabs: { query: async () => [] },
  };

  const context = vm.createContext({
    document,
    chrome: chrome ?? defaultChrome,
    URL,
    console,
  });

  // popup.html loads config.js before popup.js (see the <script> order) -
  // popup.js references its constants (DEFAULT_BACKEND_URL) as free
  // variables, so it needs to be loaded into the same context first.
  const configSrc = fs.readFileSync(path.join(extensionRoot, 'config.js'), 'utf8');
  vm.runInContext(configSrc, context, { filename: 'config.js' });

  const src = fs.readFileSync(path.join(extensionRoot, 'popup.js'), 'utf8');
  vm.runInContext(src, context, { filename: 'popup.js' });

  return context;
}
