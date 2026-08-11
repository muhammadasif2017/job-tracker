// Loads background.js (a classic extension script, not a module) into an
// isolated vm context so it can be unit tested without modifying it. The
// script declares `async function name() {}` at top level, which - same as
// in a real service worker - attaches to the context's global object, so
// the functions come back out as properties of the returned context.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.join(dirname, '..');

export function loadBackground({ chrome, fetch }) {
  const context = vm.createContext({
    chrome,
    fetch,
    console,
    Date,
    JSON,
    Promise,
    Error,
    URL,
  });

  const configSrc = fs.readFileSync(path.join(extensionRoot, 'config.js'), 'utf8');
  vm.runInContext(configSrc, context, { filename: 'config.js' });

  // Strip the importScripts call - config.js is already loaded above into
  // the same context, so background.js's free references to its constants
  // (STORAGE_KEY, DEFAULT_BACKEND_URL, ACCESS_TOKEN_REFRESH_MARGIN_MS)
  // resolve against that shared context scope.
  const bgSrc = fs
    .readFileSync(path.join(extensionRoot, 'background.js'), 'utf8')
    .replace(/^importScripts\([^)]*\);\s*$/m, '');
  vm.runInContext(bgSrc, context, { filename: 'background.js' });

  return context;
}

export function createChromeStub(initialStorage = {}) {
  const store = { ...initialStorage };
  return {
    storage: {
      local: {
        get: async (key) => ({ [key]: store[key] }),
        set: async (obj) => {
          Object.assign(store, obj);
        },
        remove: async (key) => {
          delete store[key];
        },
      },
    },
    runtime: {
      onMessage: { addListener: () => {} },
    },
    _store: store,
  };
}

export function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
