import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCreate, mockPost, requestUse, responseUse, instanceCall } =
  vi.hoisted(() => {
    return {
      mockCreate: vi.fn(),
      mockPost: vi.fn(),
      requestUse: vi.fn(),
      responseUse: vi.fn(),
      instanceCall: vi.fn(),
    };
  });

vi.mock('axios', () => {
  const instance = Object.assign(instanceCall, {
    interceptors: {
      request: { use: requestUse },
      response: { use: responseUse },
    },
  });
  mockCreate.mockReturnValue(instance);
  return {
    default: { create: mockCreate, post: mockPost },
  };
});

vi.mock('./auth', () => ({
  tokenStorage: {
    getAccess: vi.fn(),
    setAccess: vi.fn(),
    clear: vi.fn(),
  },
}));

// Imported for its module-load side effect: registers the interceptors above.
import './api';

describe('api response interceptor — concurrent 401 refresh queue', () => {
  let responseErrorHandler: (error: unknown) => Promise<unknown>;

  beforeEach(() => {
    instanceCall.mockClear();
    mockPost.mockClear();
    // Captured once at module load; the module is only evaluated once across
    // the whole test file, so re-read the same handler reference each time.
    responseErrorHandler = responseUse.mock.calls[0][1];
  });

  it('stamps _retry on a queued request before it is retried, preventing a re-refresh loop', async () => {
    let resolveRefresh: (v: unknown) => void;
    mockPost.mockReturnValue(
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
    );

    const leaderConfig: Record<string, unknown> = { url: '/jobs', headers: {} };
    const queuedConfig: Record<string, unknown> = {
      url: '/stats',
      headers: {},
    };

    // First 401 becomes the "leader" — triggers the refresh call and leaves
    // isRefreshing=true until the mocked axios.post resolves below.
    const leaderPromise = responseErrorHandler({
      config: leaderConfig,
      response: { status: 401 },
    });

    // Second 401 arrives while the refresh is still in flight — this is the
    // queued path the fix touches.
    const queuedPromise = responseErrorHandler({
      config: queuedConfig,
      response: { status: 401 },
    });

    // Assert synchronously, before the refresh resolves: the queued request
    // must already be marked so a subsequent 401 on it won't re-enter refresh.
    expect(queuedConfig._retry).toBe(true);

    resolveRefresh!({
      data: { accessToken: 'new-access', refreshToken: 'new-refresh' },
    });
    await leaderPromise;
    await queuedPromise;

    expect(instanceCall).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { Authorization: 'Bearer new-access' },
      }),
    );
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
