import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Counter, Registry } from '@prometheus-io/client';
import request from 'supertest';
import { startMetricsServer } from './metrics-server.helper.js';

describe('startMetricsServer', () => {
  let server: Server;
  let registry: Registry;
  const onError = jest.fn();

  /** Starts the listener on a free port and waits until it accepts requests. */
  async function start() {
    server = startMetricsServer(0, registry, onError);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    registry = new Registry();
    new Counter({ name: 'probe_total', help: 'test', registers: [registry] });
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it('serves the registry in Prometheus text format at GET /metrics', async () => {
    const res = await request(await start())
      .get('/metrics')
      .expect(200);

    expect(res.headers['content-type']).toBe(registry.contentType);
    expect(res.text).toContain('probe_total 0');
  });

  it('answers 404 for any other path or method', async () => {
    const url = await start();

    await request(url).get('/').expect(404);
    await request(url).get('/metrics/extra').expect(404);
    await request(url).post('/metrics').expect(404);
  });

  it('answers 500 and reports the error when the registry cannot render', async () => {
    const failure = new Error('collect failed');
    jest.spyOn(registry, 'metrics').mockRejectedValue(failure);

    await request(await start())
      .get('/metrics')
      .expect(500);

    expect(onError).toHaveBeenCalledWith(failure);
  });

  it('reports a listen failure instead of throwing', async () => {
    const url = await start();
    const port = Number(new URL(url).port);

    const second = startMetricsServer(port, registry, onError);
    await new Promise((resolve) => second.once('error', resolve));

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'EADDRINUSE' }),
    );
  });
});
