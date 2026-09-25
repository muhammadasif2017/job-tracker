import { createServer, type Server } from 'node:http';
import type { Registry } from 'prom-client';
import { METRICS_PATH } from './metrics.constants.js';

/**
 * Serves `GET /metrics` on its own port (ADR-052), outside the Nest app, so
 * it skips the API's guards, throttler, versioning and CORS, and Caddy, which
 * proxies only the API port, never exposes it. Anything else gets a 404.
 *
 * A listen or render failure goes to `onError` instead of crashing: missing
 * metrics show up in Grafana as `up == 0`, which is better than taking the
 * API down with them.
 */
export function startMetricsServer(
  port: number,
  registry: Registry,
  onError: (err: unknown) => void,
): Server {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== METRICS_PATH) {
      res.writeHead(404).end();
      return;
    }
    registry.metrics().then(
      (body) => {
        res.writeHead(200, { 'Content-Type': registry.contentType }).end(body);
      },
      (err: unknown) => {
        onError(err);
        res.writeHead(500).end();
      },
    );
  });
  server.on('error', onError);
  server.listen(port);
  return server;
}
