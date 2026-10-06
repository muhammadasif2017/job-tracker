import type { Server } from 'node:http';

/**
 * How long in-flight requests get to finish after SIGTERM before their
 * connections are cut. Below the backend's 30s `stop_grace_period` in
 * docker-compose.prod.yml, so the rest of the shutdown still runs before
 * Docker kills the container.
 */
export const DRAIN_TIMEOUT_MS = 20_000;

/**
 * Stops accepting connections and resolves once every open one has closed:
 * in-flight requests finish, and keep-alive connections are closed as soon
 * as they go idle. Connections still open after `timeoutMs` are destroyed.
 */
export function closeHttpServer(
  server: Server,
  timeoutMs = DRAIN_TIMEOUT_MS,
): Promise<void> {
  return new Promise((resolve) => {
    // A keep-alive connection that finishes its request after close() goes
    // idle without being closed, so sweep the idle ones until all are gone.
    const sweep = setInterval(() => server.closeIdleConnections(), 250);
    const cutoff = setTimeout(() => server.closeAllConnections(), timeoutMs);
    server.close(() => {
      clearInterval(sweep);
      clearTimeout(cutoff);
      resolve();
    });
    server.closeIdleConnections();
  });
}

/** What `registerGracefulShutdown` needs; `exit` and `onSignal` are seams for tests. */
export interface GracefulShutdownOptions {
  server: Server;
  /** Releases everything else: Nest's `app.close()`. */
  closeApp: () => Promise<void>;
  onError: (err: unknown) => void;
  exit?: (code: number) => void;
  onSignal?: (signal: NodeJS.Signals, handler: () => void) => void;
}

/**
 * On SIGTERM or SIGINT, drains the HTTP server first, then closes the app,
 * then exits (ADR-057). Nest's own `enableShutdownHooks()` runs the order the
 * other way: it disconnects Prisma and Redis before it closes the server, so
 * requests still arriving at a container being replaced fail against closed
 * clients. Exiting explicitly matters too: the container's main process is
 * node itself, which ignores a re-raised SIGTERM, and the metrics listener
 * would otherwise keep it alive until Docker kills it.
 */
export function registerGracefulShutdown({
  server,
  closeApp,
  onError,
  exit = (code) => process.exit(code),
  onSignal = (signal, handler) => process.once(signal, handler),
}: GracefulShutdownOptions): void {
  let started = false;
  const shutdown = async () => {
    try {
      await closeHttpServer(server);
      await closeApp();
      exit(0);
    } catch (err) {
      onError(err);
      exit(1);
    }
  };
  const handler = () => {
    if (started) return;
    started = true;
    void shutdown();
  };
  onSignal('SIGTERM', handler);
  onSignal('SIGINT', handler);
}
