/** The breaker's three states. */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Thrown instead of calling the upstream while the breaker is open. Callers
 * already treat an upstream failure as best-effort, so this reads to them as
 * one more failure, just without the wait.
 */
export class CircuitOpenError extends Error {
  constructor(
    readonly circuit: string,
    readonly retryAfterMs: number,
  ) {
    super(
      `${circuit} is temporarily unavailable (circuit open, retry in ${Math.ceil(retryAfterMs / 1000)}s)`,
    );
    this.name = 'CircuitOpenError';
  }
}

/**
 * Thrown when a half-open trial call outlives `trialTimeoutMs`. Always
 * counts as a failure, whatever `isFailure` says: the upstream did not
 * answer in time, which is exactly what the trial was asking.
 */
export class CircuitTrialTimeoutError extends Error {
  constructor(
    readonly circuit: string,
    readonly timeoutMs: number,
  ) {
    super(`${circuit} trial call timed out after ${timeoutMs}ms`);
    this.name = 'CircuitTrialTimeoutError';
  }
}

/** A point-in-time view of one breaker, for the admin queues page. */
export interface CircuitStatus {
  name: string;
  state: CircuitState;
  /** Milliseconds until an open circuit lets a trial call through; null otherwise. */
  retryAfterMs: number | null;
}

/** Tuning and hooks for one breaker. */
export interface CircuitBreakerOptions {
  /** Names the upstream in errors and logs. */
  name: string;
  /** Consecutive counted failures that open the circuit. */
  failureThreshold: number;
  /** How long the circuit stays open before one trial call is let through. */
  resetTimeoutMs: number;
  /**
   * Longest a half-open trial may run before it counts as a failure. Bounds
   * how long one slow trial can keep every other call failing fast, even
   * when the client's own timeout does not cover the whole call. Unset
   * means no breaker-level deadline.
   */
  trialTimeoutMs?: number;
  /**
   * Whether an error means the upstream is unhealthy. Anything else (a 400
   * for a bad request, say) proves the upstream answered, so it resets the
   * count instead of adding to it. Defaults to counting every error.
   */
  isFailure?: (err: unknown) => boolean;
  /**
   * Called on every state change, for logging. An error it throws is
   * swallowed: a logging failure must never change a call's outcome.
   */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
  /**
   * Monotonic clock in milliseconds, injectable for tests. Defaults to
   * `performance.now()`, not `Date.now()`: a wall-clock step backwards would
   * otherwise hold the circuit open for the size of the step.
   */
  now?: () => number;
}

/** What `admit` hands a call: when it was admitted, and whether it is the trial. */
interface Ticket {
  generation: number;
  trial: boolean;
}

/**
 * A circuit breaker for one upstream dependency (ADR-048).
 *
 * - **Closed:** calls go through. `failureThreshold` consecutive counted
 *   failures open the circuit.
 * - **Open:** calls fail at once with `CircuitOpenError`, without touching
 *   the upstream, for `resetTimeoutMs`.
 * - **Half-open:** the first call after the cool-down is a trial. Success
 *   closes the circuit; a counted failure (or outliving `trialTimeoutMs`)
 *   reopens it for another cool-down. Other calls made while the trial is in
 *   flight fail fast, so a recovering upstream is not hit by the whole
 *   backlog at once.
 *
 * Every open starts a new generation, and each call remembers the
 * generation it was admitted in. A call admitted before the latest open
 * settles as stale and is ignored: with slow calls, requests admitted while
 * the circuit was still closed keep failing after it opened, and counting
 * them would restart the cool-down or clobber the running trial.
 *
 * State lives in this process only. The API runs as a single instance
 * today; with several, each would learn about an outage on its own, which
 * costs at most `failureThreshold` slow calls per instance.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private generation = 0;
  private trialInFlight = false;
  private readonly isFailure: (err: unknown) => boolean;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.isFailure = options.isFailure ?? (() => true);
    this.now = options.now ?? (() => performance.now());
  }

  /**
   * The breaker's name, state and remaining cool-down. An open circuit whose
   * cool-down has passed still reads `open` with `retryAfterMs: 0`: it only
   * moves to half-open when the next call arrives to be the trial.
   */
  status(): CircuitStatus {
    return {
      name: this.options.name,
      state: this.state,
      // Whole milliseconds: the monotonic clock has sub-ms precision, which
      // is noise to anyone reading the value.
      retryAfterMs:
        this.state === 'open'
          ? Math.max(
              0,
              Math.ceil(
                this.options.resetTimeoutMs - (this.now() - this.openedAt),
              ),
            )
          : null,
    };
  }

  /** Runs `call` through the breaker, or throws `CircuitOpenError` without running it. */
  async execute<T>(call: () => Promise<T>): Promise<T> {
    const ticket = this.admit();
    let result: T;
    try {
      result = ticket.trial ? await this.withTrialDeadline(call) : await call();
    } catch (err) {
      const counted =
        err instanceof CircuitTrialTimeoutError || this.isFailure(err);
      this.settle(ticket, counted ? 'failure' : 'success');
      throw err;
    }
    this.settle(ticket, 'success');
    return result;
  }

  /** Lets the call through and issues its ticket, or throws if the circuit forbids it. */
  private admit(): Ticket {
    if (this.state === 'closed') {
      return { generation: this.generation, trial: false };
    }

    if (this.state === 'open') {
      const elapsed = this.now() - this.openedAt;
      if (elapsed < this.options.resetTimeoutMs) {
        throw new CircuitOpenError(
          this.options.name,
          this.options.resetTimeoutMs - elapsed,
        );
      }
      this.transition('half-open');
    }

    // Half-open: exactly one trial at a time.
    if (this.trialInFlight) {
      throw new CircuitOpenError(this.options.name, 0);
    }
    this.trialInFlight = true;
    return { generation: this.generation, trial: true };
  }

  /**
   * Races the trial against `trialTimeoutMs`. The losing call keeps running
   * underneath; its eventual rejection is absorbed so it does not surface as
   * an unhandled rejection after the trial has already been judged.
   */
  private async withTrialDeadline<T>(call: () => Promise<T>): Promise<T> {
    const timeoutMs = this.options.trialTimeoutMs;
    if (timeoutMs === undefined) return call();

    const pending = call();
    pending.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(new CircuitTrialTimeoutError(this.options.name, timeoutMs)),
        timeoutMs,
      );
    });
    try {
      return await Promise.race([pending, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Records a call's outcome, unless the call was admitted before the latest open. */
  private settle(ticket: Ticket, outcome: 'success' | 'failure') {
    if (ticket.generation !== this.generation) return;
    if (ticket.trial) this.trialInFlight = false;

    if (outcome === 'success') {
      this.consecutiveFailures = 0;
      if (this.state !== 'closed') this.transition('closed');
      return;
    }

    if (this.state === 'half-open') {
      this.open();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.options.failureThreshold) this.open();
  }

  /** Starts a new cool-down and a new generation. */
  private open() {
    this.openedAt = this.now();
    this.consecutiveFailures = 0;
    this.generation += 1;
    this.transition('open');
  }

  /** Changes state and reports it; a throwing hook cannot undo the change. */
  private transition(to: CircuitState) {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    try {
      this.options.onStateChange?.(from, to);
    } catch {
      // Deliberately ignored: the hook is for logging only, and a logger that
      // throws must not turn a good call into a failure or strand the state.
    }
  }
}
