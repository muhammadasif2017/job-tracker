import * as Sentry from '@sentry/nestjs';

jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
  onUnhandledRejectionIntegration: jest.fn((options: object) => ({
    name: 'OnUnhandledRejection',
    options,
  })),
}));

const DSN = 'https://k@o1.ingest.us.sentry.io/2';

/** Loads src/instrument.ts fresh, with the given environment. */
async function loadInstrument(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await jest.isolateModulesAsync(async () => {
      await import('./instrument.js');
    });
  } finally {
    process.env = saved;
  }
}

/** The options object Sentry.init was last called with. */
function initOptions() {
  return jest.mocked(Sentry.init).mock.calls[0][0] as Record<string, unknown>;
}

describe('instrument', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not start Sentry without a DSN, including an empty one', async () => {
    await loadInstrument({ SENTRY_DSN: undefined });
    await loadInstrument({ SENTRY_DSN: '' });

    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('never collects cookies, headers, bodies or stack-frame variables', async () => {
    await loadInstrument({ SENTRY_DSN: DSN });

    expect(initOptions()).toMatchObject({
      tracesSampleRate: 0,
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpHeaders: false,
        httpBodies: [],
        stackFrameVariables: false,
      },
    });
  });

  it('drops the Nest auto-capture and the Express spans, and makes unhandled rejections strict', async () => {
    await loadInstrument({ SENTRY_DSN: DSN });
    const integrations = initOptions().integrations as (
      defaults: Array<{ name: string }>,
    ) => Array<{ name: string; options?: object }>;

    const result = integrations([
      { name: 'Nest' },
      { name: 'Express' },
      { name: 'OnUnhandledRejection' },
      { name: 'Http' },
    ]);

    expect(result.map((i) => i.name)).toEqual(['Http', 'OnUnhandledRejection']);
    expect(result[1].options).toEqual({ mode: 'strict' });
  });

  it('treats an empty release as none', async () => {
    await loadInstrument({ SENTRY_DSN: DSN, SENTRY_RELEASE: '' });

    expect(initOptions().release).toBeUndefined();
  });
});
