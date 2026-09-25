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
   * Whether an error means the upstream is unhealthy. Anything else (a 400
   * for a bad request, say) proves the upstream answered, so it resets the
   * count instead of adding to it. Defaults to counting every error.
   */
  isFailure?: (err: unknown) => boolean;
  /** Called on every state change, for logging. */
  onStateChange?: (from: CircuitState, to: CircuitState) => void;
  /** Clock, injectable for tests. */
  now?: () => number;
}

/**
 * A circuit breaker for one upstream dependency (ADR-048).
 *
 * - **Closed:** calls go through. `failureThreshold` consecutive counted
 *   failures open the circuit.
 * - **Open:** calls fail at once with `CircuitOpenError`, without touching
 *   the upstream, for `resetTimeoutMs`.
 * - **Half-open:** the first call after the cool-down is a trial. Success
 *   closes the circuit; a counted failure reopens it for another cool-down.
 *   Other calls made while the trial is in flight fail fast, so a recovering
 *   upstream is not hit by the whole backlog at once.
 *
 * State lives in this process only. The API runs as a single instance
 * today; with several, each would learn about an outage on its own, which
 * costs at most `failureThreshold` slow calls per instance.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private trialInFlight = false;
  private readonly isFailure: (err: unknown) => boolean;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.isFailure = options.isFailure ?? (() => true);
    this.now = options.now ?? (() => Date.now());
  }

  /** The current state, for health reporting and tests. */
  get currentState(): CircuitState {
    return this.state;
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
      retryAfterMs:
        this.state === 'open'
          ? Math.max(
              0,
              this.options.resetTimeoutMs - (this.now() - this.openedAt),
            )
          : null,
    };
  }

  /** Runs `call` through the breaker, or throws `CircuitOpenError` without running it. */
  async execute<T>(call: () => Promise<T>): Promise<T> {
    this.admit();
    try {
      const result = await call();
      this.recordSuccess();
      return result;
    } catch (err) {
      if (this.isFailure(err)) this.recordFailure();
      else this.recordSuccess();
      throw err;
    }
  }

  /** Lets the call through, or throws if the circuit forbids it right now. */
  private admit() {
    if (this.state === 'closed') return;

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
  }

  /** The upstream answered: close the circuit and clear the count. */
  private recordSuccess() {
    this.consecutiveFailures = 0;
    this.trialInFlight = false;
    if (this.state !== 'closed') this.transition('closed');
  }

  /** A counted failure: reopen after a failed trial, or open at the threshold. */
  private recordFailure() {
    // A call that was already in flight when the circuit opened can still
    // fail afterwards; it says nothing new and must not extend the cool-down.
    if (this.state === 'open') return;
    this.trialInFlight = false;
    if (this.state === 'half-open') {
      this.open();
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.options.failureThreshold) this.open();
  }

  /** Starts a new cool-down. */
  private open() {
    this.openedAt = this.now();
    this.consecutiveFailures = 0;
    this.transition('open');
  }

  /** Changes state and reports it. */
  private transition(to: CircuitState) {
    const from = this.state;
    if (from === to) return;
    this.state = to;
    this.options.onStateChange?.(from, to);
  }
}
