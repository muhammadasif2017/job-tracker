import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadBackground, createChromeStub, jsonResponse } from './sandbox.js';

const STORAGE_KEY = 'jobTrackerConnection';
const BACKEND_URL = 'http://localhost:3001';

function baseConn(overrides = {}) {
  return {
    backendUrl: BACKEND_URL,
    patToken: 'jt_pat_id.secret',
    accessToken: 'old-token',
    accessTokenExpiresAt: Date.now() + 15 * 60 * 1000, // fresh, 15 min out
    ...overrides,
  };
}

describe('background.js retry/self-heal logic', () => {
  let chrome;
  let fetchMock;
  let ctx;

  beforeEach(() => {
    chrome = createChromeStub();
    fetchMock = vi.fn();
    ctx = loadBackground({ chrome, fetch: fetchMock });
  });

  describe('ensureAccessToken', () => {
    it('returns the cached access token without re-exchanging when still fresh', async () => {
      const conn = baseConn();

      const token = await ctx.ensureAccessToken(conn);

      expect(token).toBe('old-token');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('re-exchanges when the cached token is within the refresh margin', async () => {
      const conn = baseConn({ accessTokenExpiresAt: Date.now() + 10_000 }); // < 30s margin
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { accessToken: 'new-token', expiresIn: 900 }),
      );

      const token = await ctx.ensureAccessToken(conn);

      expect(token).toBe('new-token');
      expect(fetchMock).toHaveBeenCalledWith(
        `${BACKEND_URL}/auth/token/exchange`,
        expect.objectContaining({ method: 'POST' }),
      );
      const saved = await ctx.getConnection();
      expect(saved.accessToken).toBe('new-token');
    });

    it('force-refreshes even when the cached token is still fresh, when forceRefresh is set', async () => {
      const conn = baseConn(); // fresh
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { accessToken: 'forced-token', expiresIn: 900 }),
      );

      const token = await ctx.ensureAccessToken(conn, { forceRefresh: true });

      expect(token).toBe('forced-token');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('clears the stored connection when the PAT itself is rejected (403)', async () => {
      await chrome.storage.local.set({ [STORAGE_KEY]: baseConn() });
      const conn = baseConn({ accessTokenExpiresAt: Date.now() - 1 }); // expired, forces exchange
      fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: 'Invalid access token' }));

      await expect(ctx.ensureAccessToken(conn)).rejects.toThrow('Invalid access token');

      const stored = await ctx.getConnection();
      expect(stored).toBeNull();
    });

    it('does not clear the stored connection on a non-403 exchange failure (e.g. network/5xx)', async () => {
      await chrome.storage.local.set({ [STORAGE_KEY]: baseConn() });
      const conn = baseConn({ accessTokenExpiresAt: Date.now() - 1 });
      fetchMock.mockResolvedValueOnce(jsonResponse(500, { message: 'boom' }));

      await expect(ctx.ensureAccessToken(conn)).rejects.toThrow('boom');

      const stored = await ctx.getConnection();
      expect(stored).not.toBeNull();
    });
  });

  describe('apiFetch', () => {
    it('returns the result directly on a first-try success, with no retry', async () => {
      const conn = baseConn();
      fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 'job-1' }));

      const result = await ctx.apiFetch(conn, '/jobs', { method: 'POST' });

      expect(result).toEqual({ id: 'job-1' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('on a 401, force-refreshes the token and retries the request exactly once', async () => {
      const conn = baseConn();
      await chrome.storage.local.set({ [STORAGE_KEY]: conn });

      fetchMock
        .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' })) // first request
        .mockResolvedValueOnce(
          jsonResponse(200, { accessToken: 'refreshed-token', expiresIn: 900 }),
        ) // forced re-exchange
        .mockResolvedValueOnce(jsonResponse(200, { id: 'job-2' })); // retried request

      const result = await ctx.apiFetch(conn, '/jobs', { method: 'POST' });

      expect(result).toEqual({ id: 'job-2' });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      // The retried request used the freshly-exchanged token, not the stale one.
      const retriedCallHeaders = fetchMock.mock.calls[2][1].headers;
      expect(retriedCallHeaders.Authorization).toBe('Bearer refreshed-token');
    });

    it('surfaces an error instead of retrying a second time if the retried request also 401s', async () => {
      const conn = baseConn();
      await chrome.storage.local.set({ [STORAGE_KEY]: conn });

      fetchMock
        .mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }))
        .mockResolvedValueOnce(
          jsonResponse(200, { accessToken: 'still-bad-token', expiresIn: 900 }),
        )
        .mockResolvedValueOnce(jsonResponse(401, { message: 'still unauthorized' }));

      await expect(ctx.apiFetch(conn, '/jobs', { method: 'POST' })).rejects.toThrow(
        'still unauthorized',
      );
      // Exactly 3 calls (original + exchange + one retry) - proves no infinite loop.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('throws "Not connected" instead of retrying if the connection was cleared mid-flight', async () => {
      const conn = baseConn();
      // No connection saved in storage - simulates a 403-triggered clearConnection
      // happening between the first 401 and the retry lookup.
      fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'expired' }));

      await expect(ctx.apiFetch(conn, '/jobs', { method: 'POST' })).rejects.toThrow(
        'Not connected',
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleMessage', () => {
    it('connect: exchanges the PAT, strips a trailing slash from backendUrl, and persists the connection', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { accessToken: 'at-1', expiresIn: 900 }),
      );

      const result = await ctx.handleMessage({
        type: 'connect',
        backendUrl: `${BACKEND_URL}/`,
        patToken: 'jt_pat_id.secret',
      });

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledWith(
        `${BACKEND_URL}/auth/token/exchange`,
        expect.objectContaining({
          body: JSON.stringify({ token: 'jt_pat_id.secret' }),
        }),
      );
      const saved = await ctx.getConnection();
      expect(saved).toMatchObject({
        backendUrl: BACKEND_URL,
        patToken: 'jt_pat_id.secret',
        accessToken: 'at-1',
      });
    });

    it('connect: propagates the exchange failure without saving a dead connection', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(403, { message: 'Invalid access token' }));

      await expect(
        ctx.handleMessage({
          type: 'connect',
          backendUrl: BACKEND_URL,
          patToken: 'bad-token',
        }),
      ).rejects.toThrow('Invalid access token');

      expect(await ctx.getConnection()).toBeNull();
    });

    it('disconnect: clears the stored connection', async () => {
      await chrome.storage.local.set({ [STORAGE_KEY]: baseConn() });

      const result = await ctx.handleMessage({ type: 'disconnect' });

      expect(result).toEqual({ ok: true });
      expect(await ctx.getConnection()).toBeNull();
    });

    it('status: reports connected with the stored backendUrl when a connection exists', async () => {
      await chrome.storage.local.set({ [STORAGE_KEY]: baseConn({ backendUrl: 'https://example.com' }) });

      const result = await ctx.handleMessage({ type: 'status' });

      expect(result).toEqual({
        ok: true,
        connected: true,
        backendUrl: 'https://example.com',
      });
    });

    it('status: reports disconnected with the default backend URL when nothing is stored', async () => {
      const result = await ctx.handleMessage({ type: 'status' });

      expect(result).toEqual({
        ok: true,
        connected: false,
        backendUrl: BACKEND_URL,
      });
    });

    it('parseJob: rejects with "Not connected" when there is no stored connection', async () => {
      await expect(
        ctx.handleMessage({ type: 'parseJob', url: 'https://jobs.example.com/1' }),
      ).rejects.toThrow('Not connected');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('parseJob: delegates to apiFetch against /jobs/parse and returns the parsed data', async () => {
      await chrome.storage.local.set({ [STORAGE_KEY]: baseConn() });
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { company: 'Acme', position: 'Engineer' }));

      const result = await ctx.handleMessage({
        type: 'parseJob',
        url: 'https://jobs.example.com/1',
      });

      expect(result).toEqual({
        ok: true,
        data: { company: 'Acme', position: 'Engineer' },
      });
      expect(fetchMock).toHaveBeenCalledWith(
        `${BACKEND_URL}/jobs/parse`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ url: 'https://jobs.example.com/1' }),
        }),
      );
    });

    it('createJob: rejects with "Not connected" when there is no stored connection', async () => {
      await expect(
        ctx.handleMessage({ type: 'createJob', payload: { company: 'Acme' } }),
      ).rejects.toThrow('Not connected');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('createJob: delegates to apiFetch against /jobs and returns the created job plus backendUrl', async () => {
      await chrome.storage.local.set({ [STORAGE_KEY]: baseConn() });
      fetchMock.mockResolvedValueOnce(jsonResponse(201, { id: 'job-9' }));

      const result = await ctx.handleMessage({
        type: 'createJob',
        payload: { company: 'Acme', position: 'Engineer' },
      });

      expect(result).toEqual({
        ok: true,
        data: { id: 'job-9' },
        backendUrl: BACKEND_URL,
      });
    });

    it('rejects unknown message types', async () => {
      await expect(ctx.handleMessage({ type: 'bogus' })).rejects.toThrow(
        'Unknown message type: bogus',
      );
    });
  });
});
