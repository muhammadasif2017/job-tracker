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
