/**
 * True when ioredis gave up waiting for a reply (`commandTimeout`), as
 * opposed to refusing to send the command at all. Only the refusal proves
 * nothing reached Redis: a timed-out command may still have run. ioredis
 * exposes no error class or code for this, so the message is the only
 * signal.
 */
export function isCommandTimeout(err: unknown): boolean {
  return err instanceof Error && err.message === 'Command timed out';
}

/**
 * True when a failed command means Redis is unreachable right now — the
 * client is not connected, or it stopped answering — rather than a fault
 * that retrying cannot fix, such as a wrong password or an unknown command.
 * Callers map the first to a 503 and let the second surface as a 500, so a
 * misconfiguration is not disguised as a passing outage.
 */
export function isRedisUnavailable(
  client: { status: string },
  err: unknown,
): boolean {
  return client.status !== 'ready' || isCommandTimeout(err);
}

/**
 * The messages ioredis rejects a command with when it cannot reach Redis at
 * all, as opposed to Redis answering with an error. ioredis has no error
 * codes for these, so matching the text is the only way to tell.
 */
const CONNECTION_FAILURE_MESSAGES = new Set([
  'Command timed out',
  "Stream isn't writeable and enableOfflineQueue options is false",
  'Connection is closed.',
]);

/**
 * True for an ioredis rejection that means Redis was unreachable, judged
 * from the error alone. Used where no client is at hand to ask for its
 * status: the global exception filter, which only sees what a caller let
 * escape. Prefer `isRedisUnavailable` when the client is available.
 */
export function isRedisConnectionError(err: unknown): err is Error {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'MaxRetriesPerRequestError' ||
    CONNECTION_FAILURE_MESSAGES.has(err.message)
  );
}
