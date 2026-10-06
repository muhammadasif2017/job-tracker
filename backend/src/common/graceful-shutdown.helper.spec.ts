import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  closeHttpServer,
  registerGracefulShutdown,
} from './graceful-shutdown.helper.js';

/** Starts a server whose `/slow` route answers after `slowMs`. */
async function startServer(
  slowMs = 300,
): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    if (req.url === '/slow') {
      setTimeout(() => res.end('slow'), slowMs);
      return;
    }
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as AddressInfo).port };
}

/** Sends one keep-alive GET; resolves with the body, or the error code if it fails. */
function get(port: number, path: string): Promise<string> {
  return new Promise((resolve) => {
    const req = request(
      { host: '127.0.0.1', port, path, headers: { connection: 'keep-alive' } },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () => resolve(body));
      },
    );
    req.on('error', (err: NodeJS.ErrnoException) =>
      resolve(err.code ?? 'error'),
    );
    req.end();
  });
}

describe('closeHttpServer', () => {
  it('lets an in-flight request finish, then refuses new connections', async () => {
    const { server, port } = await startServer();
    const inFlight = get(port, '/slow');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const closed = closeHttpServer(server);

    expect(await get(port, '/')).toBe('ECONNREFUSED');
    expect(await inFlight).toBe('slow');
    await closed;
  });

  it('cuts connections still open after the timeout', async () => {
    const { server, port } = await startServer(5_000);
    const inFlight = get(port, '/slow');
    await new Promise((resolve) => setTimeout(resolve, 50));

    const started = Date.now();
    await closeHttpServer(server, 100);

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(await inFlight).toBe('ECONNRESET');
  });
});

describe('registerGracefulShutdown', () => {
  it('drains the HTTP server before closing the app, then exits 0', async () => {
    const { server, port } = await startServer();
    const order: string[] = [];
    const exit = jest.fn<void, [number]>();
    const handlers = new Map<string, () => void>();
    server.on('close', () => order.push('server closed'));

    registerGracefulShutdown({
      server,
      closeApp: () => {
        order.push('app closed');
        return Promise.resolve();
      },
      onError: jest.fn(),
      exit,
      onSignal: (signal, handler) => handlers.set(signal, handler),
    });
    expect([...handlers.keys()]).toEqual(['SIGTERM', 'SIGINT']);

    handlers.get('SIGTERM')!();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(order).toEqual(['server closed', 'app closed']);
    expect(exit).toHaveBeenCalledWith(0);
    expect(await get(port, '/')).toBe('ECONNREFUSED');
  });

  it('reports a failed close and exits 1', async () => {
    const { server } = await startServer();
    const failure = new Error('redis quit failed');
    const exit = jest.fn<void, [number]>();
    const onError = jest.fn();
    const handlers = new Map<string, () => void>();

    registerGracefulShutdown({
      server,
      closeApp: () => Promise.reject(failure),
      onError,
      exit,
      onSignal: (signal, handler) => handlers.set(signal, handler),
    });
    handlers.get('SIGINT')!();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(onError).toHaveBeenCalledWith(failure);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('runs the shutdown once when a second signal arrives', async () => {
    const { server } = await startServer();
    const closeApp = jest.fn(() => Promise.resolve());
    const exit = jest.fn<void, [number]>();
    const handlers = new Map<string, () => void>();

    registerGracefulShutdown({
      server,
      closeApp,
      onError: jest.fn(),
      exit,
      onSignal: (signal, handler) => handlers.set(signal, handler),
    });
    handlers.get('SIGTERM')!();
    handlers.get('SIGINT')!();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(closeApp).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
