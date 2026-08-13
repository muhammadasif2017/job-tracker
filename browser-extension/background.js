importScripts('config.js');

async function getConnection() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] ?? null;
}

async function saveConnection(conn) {
  await chrome.storage.local.set({ [STORAGE_KEY]: conn });
}

async function clearConnection() {
  await chrome.storage.local.remove(STORAGE_KEY);
}

async function parseErrorBody(res) {
  try {
    const body = await res.json();
    if (Array.isArray(body.message)) return body.message.join(', ');
    if (typeof body.message === 'string') return body.message;
  } catch {
    // fall through to generic message below
  }
  return `Request failed (${res.status})`;
}

// Exchanges the stored personal access token for a fresh short-lived access
// JWT and persists it. Called on connect and whenever the cached access
// token is missing/near expiry - the PAT itself never expires server-side,
// so this is cheap to repeat.
async function exchangeToken(backendUrl, patToken) {
  const res = await fetch(`${backendUrl}/auth/token/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: patToken }),
  });
  if (!res.ok) {
    const err = new Error(await parseErrorBody(res));
    err.status = res.status;
    throw err;
  }
  return res.json(); // { accessToken, expiresIn }
}

async function ensureAccessToken(conn, { forceRefresh = false } = {}) {
  const fresh =
    !forceRefresh &&
    conn.accessToken &&
    conn.accessTokenExpiresAt &&
    conn.accessTokenExpiresAt - Date.now() > ACCESS_TOKEN_REFRESH_MARGIN_MS;
  if (fresh) return conn.accessToken;

  let exchanged;
  try {
    exchanged = await exchangeToken(conn.backendUrl, conn.patToken);
  } catch (err) {
    // 403 means the server rejected the PAT itself (revoked/invalid), not a
    // transient failure - stop presenting a dead connection as "Connected".
    if (err.status === 403) await clearConnection();
    throw err;
  }

  const { accessToken, expiresIn } = exchanged;
  const updated = {
    ...conn,
    accessToken,
    accessTokenExpiresAt: Date.now() + expiresIn * 1000,
  };
  await saveConnection(updated);
  return accessToken;
}

async function apiFetch(conn, path, options = {}, retrying = false) {
  const accessToken = await ensureAccessToken(conn, { forceRefresh: retrying });
  const res = await fetch(`${conn.backendUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });
  if (res.status === 401 && !retrying) {
    // Cached access token was rejected for a reason other than elapsed TTL
    // (e.g. the PAT was revoked mid-lifetime) - force one re-exchange and
    // retry once before surfacing an error to the popup.
    const latest = await getConnection();
    if (!latest) throw new Error('Not connected');
    return apiFetch(latest, path, options, true);
  }
  if (!res.ok) throw new Error(await parseErrorBody(res));
  return res.json();
}

async function handleMessage(msg) {
  switch (msg.type) {
    case 'connect': {
      const backendUrl = msg.backendUrl.replace(/\/+$/, '');
      // Validates the token immediately so a typo/revoked PAT fails fast
      // instead of silently saving a connection that will never work.
      const { accessToken, expiresIn } = await exchangeToken(
        backendUrl,
        msg.patToken,
      );
      await saveConnection({
        backendUrl,
        patToken: msg.patToken,
        accessToken,
        accessTokenExpiresAt: Date.now() + expiresIn * 1000,
      });
      return { ok: true };
    }

    case 'disconnect': {
      await clearConnection();
      return { ok: true };
    }

    case 'status': {
      const conn = await getConnection();
      return {
        ok: true,
        connected: !!conn,
        backendUrl: conn?.backendUrl ?? DEFAULT_BACKEND_URL,
      };
    }

    case 'parseJob': {
      const conn = await getConnection();
      if (!conn) throw new Error('Not connected');
      const data = await apiFetch(conn, '/jobs/parse', {
        method: 'POST',
        body: JSON.stringify({ url: msg.url, text: msg.text }),
      });
      return { ok: true, data };
    }

    case 'createJob': {
      const conn = await getConnection();
      if (!conn) throw new Error('Not connected');
      const data = await apiFetch(conn, '/jobs', {
        method: 'POST',
        body: JSON.stringify(msg.payload),
      });
      return { ok: true, data, backendUrl: conn.backendUrl };
    }

    default:
      throw new Error(`Unknown message type: ${msg.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true; // keep the message channel open for the async response
});
