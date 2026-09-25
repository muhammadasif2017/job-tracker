import {
  CircuitBreaker,
  CircuitOpenError,
  type CircuitState,
} from './circuit-breaker.js';

const RESET_MS = 30_000;

function setup(isFailure?: (err: unknown) => boolean) {
  let time = 0;
  const transitions: Array<[CircuitState, CircuitState]> = [];
  const breaker = new CircuitBreaker({
    name: 'Upstream',
    failureThreshold: 3,
    resetTimeoutMs: RESET_MS,
    isFailure,
    now: () => time,
    onStateChange: (from, to) => transitions.push([from, to]),
  });
  return {
    breaker,
    transitions,
    advance: (ms: number) => (time += ms),
  };
}

const ok = () => Promise.resolve('ok');
const boom = () => Promise.reject(new Error('upstream down'));

async function failTimes(breaker: CircuitBreaker, n: number) {
  for (let i = 0; i < n; i++) {
    await expect(breaker.execute(boom)).rejects.toThrow('upstream down');
  }
}

describe('CircuitBreaker', () => {
  it('passes calls through while closed', async () => {
    const { breaker } = setup();

    await expect(breaker.execute(ok)).resolves.toBe('ok');
    expect(breaker.currentState).toBe('closed');
  });

  it('opens after the threshold of consecutive failures', async () => {
    const { breaker, transitions } = setup();

    await failTimes(breaker, 2);
    expect(breaker.currentState).toBe('closed');
    await failTimes(breaker, 1);

    expect(breaker.currentState).toBe('open');
    expect(transitions).toEqual([['closed', 'open']]);
  });

  it('resets the count on a success, so only consecutive failures open it', async () => {
    const { breaker } = setup();

    await failTimes(breaker, 2);
    await breaker.execute(ok);
    await failTimes(breaker, 2);

    expect(breaker.currentState).toBe('closed');
  });

  it('fails fast while open, without calling the upstream', async () => {
    const { breaker, advance } = setup();
    await failTimes(breaker, 3);
    advance(10_000);
    const call = jest.fn(ok);

    const err = await breaker.execute(call).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CircuitOpenError);
    expect((err as CircuitOpenError).retryAfterMs).toBe(20_000);
    expect((err as CircuitOpenError).message).toMatch(/Upstream.*retry in 20s/);
    expect(call).not.toHaveBeenCalled();
  });

  it('lets one trial through after the cool-down and closes on success', async () => {
    const { breaker, advance, transitions } = setup();
    await failTimes(breaker, 3);
    advance(RESET_MS);

    await expect(breaker.execute(ok)).resolves.toBe('ok');

    expect(breaker.currentState).toBe('closed');
    expect(transitions).toEqual([
      ['closed', 'open'],
      ['open', 'half-open'],
      ['half-open', 'closed'],
    ]);
  });

  it('reopens for a fresh cool-down when the trial fails', async () => {
    const { breaker, advance } = setup();
    await failTimes(breaker, 3);
    advance(RESET_MS);

    await failTimes(breaker, 1);
    expect(breaker.currentState).toBe('open');

    advance(RESET_MS - 1);
    await expect(breaker.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
    advance(1);
    await expect(breaker.execute(ok)).resolves.toBe('ok');
  });

  it('fails other calls fast while the half-open trial is in flight', async () => {
    const { breaker, advance } = setup();
    await failTimes(breaker, 3);
    advance(RESET_MS);
    let finishTrial: (v: string) => void = () => undefined;
    const trial = breaker.execute(
      () => new Promise<string>((resolve) => (finishTrial = resolve)),
    );

    await expect(breaker.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);

    finishTrial('ok');
    await expect(trial).resolves.toBe('ok');
    expect(breaker.currentState).toBe('closed');
  });

  it('does not count errors the classifier says the upstream answered', async () => {
    const { breaker } = setup(
      (err) => !(err instanceof Error && err.message === 'bad request'),
    );
    const badRequest = () => Promise.reject(new Error('bad request'));

    await failTimes(breaker, 2);
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(badRequest)).rejects.toThrow('bad request');
    }
    await failTimes(breaker, 2);

    expect(breaker.currentState).toBe('closed');
  });

  it('does not extend the cool-down for a call that fails after the circuit opened', async () => {
    const { breaker, advance } = setup();
    let failLate: (e: Error) => void = () => undefined;
    const late = breaker.execute(
      () => new Promise<string>((_, reject) => (failLate = reject)),
    );
    await failTimes(breaker, 3);

    advance(RESET_MS - 1);
    failLate(new Error('upstream down'));
    await expect(late).rejects.toThrow('upstream down');
    advance(1);

    await expect(breaker.execute(ok)).resolves.toBe('ok');
  });

  it('reports its state and remaining cool-down', async () => {
    const { breaker, advance } = setup();
    expect(breaker.status()).toEqual({
      name: 'Upstream',
      state: 'closed',
      retryAfterMs: null,
    });

    await failTimes(breaker, 3);
    advance(12_000);
    expect(breaker.status()).toEqual({
      name: 'Upstream',
      state: 'open',
      retryAfterMs: 18_000,
    });

    advance(40_000);
    expect(breaker.status().retryAfterMs).toBe(0);
  });
});
