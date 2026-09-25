import {
  CircuitBreaker,
  CircuitOpenError,
  CircuitTrialTimeoutError,
  type CircuitBreakerOptions,
  type CircuitState,
} from './circuit-breaker.js';

const RESET_MS = 30_000;

function setup(
  isFailure?: (err: unknown) => boolean,
  extra: Partial<CircuitBreakerOptions> = {},
) {
  let time = 0;
  const transitions: Array<[CircuitState, CircuitState]> = [];
  const breaker = new CircuitBreaker({
    name: 'Upstream',
    failureThreshold: 3,
    resetTimeoutMs: RESET_MS,
    isFailure,
    now: () => time,
    onStateChange: (from, to) => transitions.push([from, to]),
    ...extra,
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
    expect(breaker.status().state).toBe('closed');
  });

  it('opens after the threshold of consecutive failures', async () => {
    const { breaker, transitions } = setup();

    await failTimes(breaker, 2);
    expect(breaker.status().state).toBe('closed');
    await failTimes(breaker, 1);

    expect(breaker.status().state).toBe('open');
    expect(transitions).toEqual([['closed', 'open']]);
  });

  it('resets the count on a success, so only consecutive failures open it', async () => {
    const { breaker } = setup();

    await failTimes(breaker, 2);
    await breaker.execute(ok);
    await failTimes(breaker, 2);

    expect(breaker.status().state).toBe('closed');
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

    expect(breaker.status().state).toBe('closed');
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
    expect(breaker.status().state).toBe('open');

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
    expect(breaker.status().state).toBe('closed');
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

    expect(breaker.status().state).toBe('closed');
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

  /** A call that stays pending until the test settles it. */
  function pendingCall() {
    let resolve: (v: string) => void = () => undefined;
    let reject: (e: Error) => void = () => undefined;
    const promise = new Promise<string>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { call: () => promise, resolve, reject };
  }

  it('ignores a call admitted before the circuit opened that fails during the trial', async () => {
    // The hang-type outage: D is admitted while closed, then outlives the
    // open and fails while E is the half-open trial.
    const { breaker, advance, transitions } = setup();
    const d = pendingCall();
    const lateD = breaker.execute(d.call);
    await failTimes(breaker, 3);
    advance(RESET_MS);
    const e = pendingCall();
    const trialE = breaker.execute(e.call);

    d.reject(new Error('upstream down'));
    await expect(lateD).rejects.toThrow('upstream down');

    // Still half-open with E in flight: no reopen, and no second trial.
    expect(breaker.status().state).toBe('half-open');
    await expect(breaker.execute(ok)).rejects.toBeInstanceOf(CircuitOpenError);
    e.resolve('ok');
    await expect(trialE).resolves.toBe('ok');
    expect(transitions).toEqual([
      ['closed', 'open'],
      ['open', 'half-open'],
      ['half-open', 'closed'],
    ]);
  });

  it('ignores a stale success from before the open, too', async () => {
    const { breaker } = setup();
    const d = pendingCall();
    const lateD = breaker.execute(d.call);
    await failTimes(breaker, 3);

    d.resolve('late');
    await expect(lateD).resolves.toBe('late');

    expect(breaker.status().state).toBe('open');
  });

  it('fails a trial that outlives trialTimeoutMs and reopens the circuit', async () => {
    jest.useFakeTimers();
    try {
      const { breaker, advance } = setup(undefined, { trialTimeoutMs: 1000 });
      await failTimes(breaker, 3);
      advance(RESET_MS);
      const stalled = pendingCall();

      const trial = breaker.execute(stalled.call);
      const settled = expect(trial).rejects.toBeInstanceOf(
        CircuitTrialTimeoutError,
      );
      await jest.advanceTimersByTimeAsync(1000);
      await settled;

      expect(breaker.status().state).toBe('open');
      // The stalled call failing later must not surface or count.
      stalled.reject(new Error('finally failed'));
    } finally {
      jest.useRealTimers();
    }
  });

  it('counts a trial timeout even when the classifier would not count its error', async () => {
    jest.useFakeTimers();
    try {
      // This classifier counts only 'upstream down', so it would return false
      // for the timeout error itself; the timeout must count anyway.
      const { breaker, advance } = setup(
        (err) => err instanceof Error && err.message === 'upstream down',
        { trialTimeoutMs: 500 },
      );
      await failTimes(breaker, 3);
      advance(RESET_MS);

      const trial = breaker.execute(() => pendingCall().call());
      const settled = expect(trial).rejects.toBeInstanceOf(
        CircuitTrialTimeoutError,
      );
      await jest.advanceTimersByTimeAsync(500);
      await settled;

      expect(breaker.status().state).toBe('open');
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps a good result when the state-change hook throws', async () => {
    const { breaker, advance } = setup(undefined, {
      onStateChange: () => {
        throw new Error('logger died');
      },
    });
    await failTimes(breaker, 3);
    advance(RESET_MS);

    await expect(breaker.execute(ok)).resolves.toBe('ok');
    expect(breaker.status().state).toBe('closed');
  });

  it('uses a monotonic clock by default', async () => {
    const now = jest.spyOn(performance, 'now');
    const breaker = new CircuitBreaker({
      name: 'Upstream',
      failureThreshold: 1,
      resetTimeoutMs: RESET_MS,
    });

    await expect(breaker.execute(boom)).rejects.toThrow('upstream down');

    expect(breaker.status().state).toBe('open');
    expect(now).toHaveBeenCalled();
    now.mockRestore();
  });

  it('reports whole milliseconds even with a sub-millisecond clock', async () => {
    let time = 0.25;
    const breaker = new CircuitBreaker({
      name: 'Upstream',
      failureThreshold: 1,
      resetTimeoutMs: RESET_MS,
      now: () => time,
    });
    await expect(breaker.execute(boom)).rejects.toThrow();
    time += 1000.6;

    // 28999.4ms left, rounded up: never report the trial as sooner than it is.
    expect(breaker.status().retryAfterMs).toBe(29_000);
  });
});
