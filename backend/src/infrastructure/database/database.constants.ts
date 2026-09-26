import type { PoolConfig } from 'pg';

/**
 * Pool settings for the pg driver adapter, beyond the connection string.
 *
 * - `connectionTimeoutMillis`: pg's default is no limit, so a database that
 *   never answers (a dropped route, a stalled TLS handshake) would hang boot
 *   and every query with no error. 10s fails fast instead, and still clears
 *   a Neon resume, which has been measured at under a second.
 * - `idleTimeoutMillis`: pg closes an idle connection after 10s by default,
 *   so after any quiet spell the next query (often the `/health` probe) paid
 *   for a new TLS connection to Neon again. The first `/health` after a
 *   deploy took 5.9s and failed its 5s database ping on a healthy database
 *   (seen on the VM after #444). Five minutes matches Neon's own suspend
 *   window: past that the compute is asleep and the connection is gone
 *   anyway.
 * - `keepAlive`: TCP keepalive, so a connection a middlebox dropped while
 *   idle is noticed rather than hanging the next query.
 */
export const DB_POOL_OPTIONS: Pick<
  PoolConfig,
  'connectionTimeoutMillis' | 'idleTimeoutMillis' | 'keepAlive'
> = {
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 300_000,
  keepAlive: true,
};
