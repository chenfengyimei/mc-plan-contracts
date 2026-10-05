import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_TIMEOUT_MS,
  McPlanAbortError,
  McPlanNetworkError,
  McPlanTimeoutError,
  transportSend,
  type TransportRequest,
} from '../src/transport.js';

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

interface FixtureBehavior {
  status?: number;
  body?: string;
  delayMs?: number;
  statuses?: number[];
}

function startFixture(behavior: FixtureBehavior): Promise<{
  server: Server;
  url: (path: string) => string;
  requests: RecordedRequest[];
}> {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        headers: request.headers as Record<string, string>,
        body: chunks.length === 0 ? undefined : Buffer.concat(chunks).toString('utf8'),
      });
      const scripted =
        behavior.statuses?.[Math.min(requests.length - 1, behavior.statuses.length - 1)];
      const status = scripted ?? behavior.status ?? 500;
      if (behavior.delayMs !== undefined) {
        setTimeout(() => {
          response.writeHead(status, { 'content-type': 'application/json' });
          response.end(behavior.body ?? '{}');
        }, behavior.delayMs);
        return;
      }
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(behavior.body ?? '{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        server,
        url: (path: string) => `http://127.0.0.1:${address.port}${path}`,
        requests,
      });
    });
  });
}

let cleanup: Server | undefined;

beforeEach(() => {
  cleanup = undefined;
});

afterEach(async () => {
  if (cleanup !== undefined) {
    await new Promise<void>((resolve) => cleanup?.close(() => resolve()));
    cleanup = undefined;
  }
});

function get(url: string): TransportRequest {
  return { method: 'GET', url, headers: {}, idempotent: true };
}

describe('transport timeouts and aborts', () => {
  it('fails with McPlanTimeoutError when the server exceeds timeoutMs', async () => {
    const fixture = await startFixture({ status: 200, delayMs: 500 });
    cleanup = fixture.server;
    await expect(
      transportSend(get(fixture.url('/v1/me')), { timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(McPlanTimeoutError);
  });

  it('propagates caller aborts as McPlanAbortError', async () => {
    const fixture = await startFixture({ status: 200, delayMs: 500 });
    cleanup = fixture.server;
    const controller = new AbortController();
    const pending = transportSend({ ...get(fixture.url('/v1/me')), signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(McPlanAbortError);
  });

  it('defaults to the documented timeout', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
  });
});

describe('transport bounded retries', () => {
  it('retries idempotent requests on retryable statuses and keeps every header, including the Idempotency-Key', async () => {
    const fixture = await startFixture({
      statuses: [503, 503, 201],
      body: '{"consumption_id":"c1"}',
    });
    cleanup = fixture.server;
    const result = await transportSend(
      {
        method: 'POST',
        url: fixture.url('/v1/credits/consume'),
        headers: { 'Idempotency-Key': 'same-key-12345678' },
        body: '{"user_id":"u1"}',
        idempotent: true,
      },
      { maxRetries: 2 },
    );
    expect(result.status).toBe(201);
    expect(fixture.requests).toHaveLength(3);
    for (const request of fixture.requests) {
      expect(request.headers['idempotency-key']).toBe('same-key-12345678');
      expect(request.body).toBe('{"user_id":"u1"}');
    }
  });

  it('does not retry non-idempotent requests', async () => {
    const fixture = await startFixture({ statuses: [503, 201] });
    cleanup = fixture.server;
    const result = await transportSend(
      {
        method: 'POST',
        url: fixture.url('/v1/developer-apps'),
        headers: {},
        idempotent: false,
      },
      { maxRetries: 2 },
    );
    expect(result.status).toBe(503);
    expect(fixture.requests).toHaveLength(1);
  });

  it('gives up after maxRetries attempts', async () => {
    const fixture = await startFixture({ status: 503 });
    cleanup = fixture.server;
    const result = await transportSend(get(fixture.url('/v1/entitlements')), { maxRetries: 1 });
    expect(result.status).toBe(503);
    expect(fixture.requests).toHaveLength(2);
  });

  it('does not retry 4xx responses', async () => {
    const fixture = await startFixture({ status: 409, body: '{"code":"X"}' });
    cleanup = fixture.server;
    const result = await transportSend(get(fixture.url('/v1/credits/consume')));
    expect(result.status).toBe(409);
    expect(fixture.requests).toHaveLength(1);
  });

  it('retries a network error for idempotent requests and finally throws McPlanNetworkError', async () => {
    const unreachable = 'http://127.0.0.1:1/v1/me';
    await expect(
      transportSend(get(unreachable), { maxRetries: 1, timeoutMs: 500 }),
    ).rejects.toBeInstanceOf(McPlanNetworkError);
  });
});
