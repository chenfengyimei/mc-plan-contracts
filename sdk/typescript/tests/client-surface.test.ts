import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { McPlanCoreClient, type McPlanCoreClientOptions } from '../src/client.js';
import { McPlanProblemError, McPlanUnexpectedResponseError } from '../src/problem.js';
import { McPlanNetworkError } from '../src/transport.js';

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

type Responder = (request: RecordedRequest) => { status: number; body?: string };

function startApi(responder: Responder): Promise<{
  server: Server;
  baseUrl: string;
  requests: RecordedRequest[];
}> {
  const requests: RecordedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const recorded: RecordedRequest = {
        method: request.method ?? 'GET',
        url: request.url ?? '/',
        headers: request.headers as Record<string, string>,
        body: chunks.length === 0 ? undefined : Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(recorded);
      const reply = responder(recorded);
      const contentType =
        reply.status >= 200 && reply.status < 300 ? 'application/json' : 'application/problem+json';
      response.writeHead(reply.status, { 'content-type': contentType });
      response.end(reply.body ?? '{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
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

function makeClient(baseUrl: string, options: { user?: boolean; service?: boolean } = {}) {
  const clientOptions: McPlanCoreClientOptions = { baseUrl };
  if (options.user !== false) {
    clientOptions.getUserToken = () => 'oidc-user-token';
  }
  if (options.service !== false) {
    clientOptions.getServiceToken = () => 'service-token';
  }
  return new McPlanCoreClient(clientOptions);
}

const actorBody = JSON.stringify({
  user_id: 'usr_1',
  display_name: 'Smoke User',
  avatar_url: null,
});

describe('McPlanCoreClient surface', () => {
  it('sends getCurrentUser with a user bearer token', async () => {
    const api = await startApi(() => ({ status: 200, body: actorBody }));
    cleanup = api.server;
    const user = await makeClient(api.baseUrl).getCurrentUser();
    expect(user).toEqual({ user_id: 'usr_1', display_name: 'Smoke User', avatar_url: null });
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]?.method).toBe('GET');
    expect(api.requests[0]?.url).toBe('/v1/me');
    expect(api.requests[0]?.headers.authorization).toBe('Bearer oidc-user-token');
  });

  it('creates a developer app with a serialized body and no retry', async () => {
    const api = await startApi(() => ({
      status: 201,
      body: JSON.stringify({
        app_id: 'app_1',
        name: 'Demo',
        client_type: 'public',
        status: 'active',
        approved_scopes: ['profile:read'],
        redirect_uris: ['https://app.example.invalid/cb'],
        created_at: '2026-10-05T00:00:00Z',
      }),
    }));
    cleanup = api.server;
    const created = await makeClient(api.baseUrl).createDeveloperApp({
      name: 'Demo',
      client_type: 'public',
      redirect_uris: ['https://app.example.invalid/cb'],
      approved_scopes: ['profile:read'],
    });
    expect(created.app_id).toBe('app_1');
    expect(api.requests[0]?.url).toBe('/v1/developer-apps');
    expect(JSON.parse(api.requests[0]?.body ?? '{}')).toEqual({
      name: 'Demo',
      client_type: 'public',
      redirect_uris: ['https://app.example.invalid/cb'],
      approved_scopes: ['profile:read'],
    });
  });

  it('encodes path segments for getDeveloperApp and revokePersonalAccessToken', async () => {
    const api = await startApi((request) =>
      request.url.includes('developer-apps')
        ? { status: 200, body: '{"app_id":"a b"}' }
        : { status: 200, body: '{"token_id":"t/1"}' },
    );
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await client.getDeveloperApp('a b');
    await client.revokePersonalAccessToken('t/1');
    expect(api.requests[0]?.url).toBe('/v1/developer-apps/a%20b');
    expect(api.requests[1]?.url).toBe('/v1/personal-access-tokens/t%2F1');
  });

  it('distinguishes 200 replay from 201 success on consumeCredits and never rotates the key', async () => {
    const consumption = {
      consumption_id: 'con_1',
      source: 'daily_entitlement',
      units: 1,
      remaining: 2,
      created_at: '2026-10-05T00:00:00Z',
    };
    let call = 0;
    const api = await startApi(() => {
      call += 1;
      return { status: call === 1 ? 201 : 200, body: JSON.stringify(consumption) };
    });
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    const first = await client.consumeCredits(
      {
        user_id: 'usr_1',
        module: 'skin',
        operation: 'creation_session',
        units: 1,
        reference_id: 'ref-1',
      },
      'stable-idempotency-key',
    );
    const replay = await client.consumeCredits(
      {
        user_id: 'usr_1',
        module: 'skin',
        operation: 'creation_session',
        units: 1,
        reference_id: 'ref-1',
      },
      'stable-idempotency-key',
    );
    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(first.data).toEqual(replay.data);
    expect(api.requests[0]?.headers['idempotency-key']).toBe('stable-idempotency-key');
    expect(api.requests[1]?.headers['idempotency-key']).toBe('stable-idempotency-key');
    expect(api.requests[0]?.headers.authorization).toBe('Bearer service-token');
    expect(api.requests[0]?.headers['content-type']).toContain('application/json');
  });

  it('rejects idempotency keys outside the locked 8..200 range', async () => {
    const api = await startApi(() => ({ status: 201, body: '{}' }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await expect(
      client.consumeCredits(
        {
          user_id: 'u',
          module: 'skin',
          operation: 'creation_session',
          units: 1,
          reference_id: 'r',
        },
        'short',
      ),
    ).rejects.toThrow(RangeError);
    expect(api.requests).toHaveLength(0);
  });

  it('throws a typed McPlanProblemError for problem responses', async () => {
    const api = await startApi(() => ({
      status: 409,
      body: JSON.stringify({
        type: '/problems/entitlement-exhausted',
        title: 'Daily entitlement exhausted',
        status: 409,
        code: 'ENTITLEMENT_EXHAUSTED',
        trace_id: 'trace-1',
      }),
    }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    const failure = client.consumeCredits(
      {
        user_id: 'u1',
        module: 'skin',
        operation: 'creation_session',
        units: 1,
        reference_id: 'r',
      },
      'key-12345678',
    );
    await expect(failure).rejects.toBeInstanceOf(McPlanProblemError);
    await failure.catch((error: unknown) => {
      const problemError = error as McPlanProblemError;
      expect(problemError.problem.code).toBe('ENTITLEMENT_EXHAUSTED');
      expect(problemError.httpStatus).toBe(409);
    });
  });

  it('falls back to McPlanUnexpectedResponseError for non-problem error bodies', async () => {
    const api = await startApi(() => ({ status: 502, body: '<html>Bad gateway</html>' }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await expect(client.getCurrentUser()).rejects.toBeInstanceOf(McPlanUnexpectedResponseError);
  });

  it('enforces the user vs service credential boundary', async () => {
    const api = await startApi(() => ({ status: 200, body: actorBody }));
    cleanup = api.server;
    await expect(makeClient(api.baseUrl, { user: false }).getCurrentUser()).rejects.toThrow(
      /getUserToken/,
    );
    await expect(
      makeClient(api.baseUrl, { service: false }).consumeCredits(
        {
          user_id: 'u1',
          module: 'skin',
          operation: 'creation_session',
          units: 1,
          reference_id: 'r',
        },
        'key-12345678',
      ),
    ).rejects.toThrow(/getServiceToken/);
    expect(api.requests).toHaveLength(0);
  });

  it('rejects base URLs that are not http(s)', () => {
    expect(() => new McPlanCoreClient({ baseUrl: 'ftp://example.invalid' })).toThrow(TypeError);
  });
});

const eventEnvelope = {
  correlation_id: null,
  data: { entry_id: 'entry_1' },
  event_id: 'evt_1',
  occurred_at: '2026-10-08T00:00:00.000Z',
  producer: 'mc-plan-core',
  schema_version: 1,
  subject: 'usr_1',
  type: 'credit.changed.v1',
};
const eventPageBody = JSON.stringify({ items: [eventEnvelope], next_cursor: 'mcp-evc1-cursor' });
const acknowledgmentBody = JSON.stringify({ cursor: 'mcp-evc1-cursor' });

describe('McPlanCoreClient events surface (service-only consumer pull)', () => {
  it('sends the service token to GET /v1/events and types the EventPage', async () => {
    const api = await startApi((request) => {
      if (request.url.startsWith('/v1/events') && request.method === 'GET') {
        return { status: 200, body: eventPageBody };
      }
      return { status: 404, body: '{}' };
    });
    cleanup = api.server;
    const page = await makeClient(api.baseUrl).listDeliveredEvents();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toEqual(eventEnvelope);
    expect(page.next_cursor).toBe('mcp-evc1-cursor');
    expect(api.requests[0]?.method).toBe('GET');
    expect(api.requests[0]?.url).toBe('/v1/events');
    expect(api.requests[0]?.headers.authorization).toBe('Bearer service-token');
  });

  it('forwards an explicit integer limit as the only query parameter', async () => {
    const api = await startApi(() => ({ status: 200, body: eventPageBody }));
    cleanup = api.server;
    await makeClient(api.baseUrl).listDeliveredEvents({ limit: 2 });
    expect(api.requests[0]?.url).toBe('/v1/events?limit=2');
  });

  it('rejects out-of-range or non-integer limits client-side without sending', async () => {
    const api = await startApi(() => ({ status: 200, body: eventPageBody }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await expect(client.listDeliveredEvents({ limit: 0 })).rejects.toThrow(RangeError);
    await expect(client.listDeliveredEvents({ limit: 201 })).rejects.toThrow(RangeError);
    await expect(client.listDeliveredEvents({ limit: 2.5 })).rejects.toThrow(RangeError);
    expect(api.requests).toHaveLength(0);
  });

  it('acknowledges a cursor via POST /v1/events/acknowledgments with a JSON body', async () => {
    const api = await startApi((request) => {
      if (request.url === '/v1/events/acknowledgments') {
        return { status: 200, body: acknowledgmentBody };
      }
      return { status: 404, body: '{}' };
    });
    cleanup = api.server;
    const acknowledged = await makeClient(api.baseUrl).acknowledgeEvents({
      cursor: 'mcp-evc1-cursor',
    });
    expect(acknowledged).toEqual({ cursor: 'mcp-evc1-cursor' });
    expect(api.requests[0]?.method).toBe('POST');
    expect(api.requests[0]?.url).toBe('/v1/events/acknowledgments');
    expect(api.requests[0]?.headers.authorization).toBe('Bearer service-token');
    expect(JSON.parse(api.requests[0]?.body ?? '{}')).toEqual({ cursor: 'mcp-evc1-cursor' });
  });

  it('requires a non-empty cursor and never fabricates one', async () => {
    const api = await startApi(() => ({ status: 200, body: acknowledgmentBody }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    // @ts-expect-error deliberately malformed input from JavaScript callers
    await expect(client.acknowledgeEvents(undefined)).rejects.toThrow(TypeError);
    await expect(client.acknowledgeEvents({ cursor: '' })).rejects.toThrow(TypeError);
    expect(api.requests).toHaveLength(0);
  });

  it('maps events problem responses to typed McPlanProblemError', async () => {
    const api = await startApi((request) => ({
      status: request.url === '/v1/events' ? 403 : 400,
      body: JSON.stringify({
        type:
          request.url === '/v1/events'
            ? '/problems/access-forbidden'
            : '/problems/validation-failed',
        title: 'rejected',
        status: request.url === '/v1/events' ? 403 : 400,
        code: request.url === '/v1/events' ? 'INSUFFICIENT_SCOPE' : 'VALIDATION_FAILED',
        trace_id: 'trace-events',
      }),
    }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await expect(client.listDeliveredEvents()).rejects.toMatchObject({
      problem: { code: 'INSUFFICIENT_SCOPE' },
      httpStatus: 403,
    });
    await expect(client.acknowledgeEvents({ cursor: 'mcp-evc1-cursor' })).rejects.toMatchObject({
      problem: { code: 'VALIDATION_FAILED' },
      httpStatus: 400,
    });
  });

  it('requires a service token provider for both events operations', async () => {
    const api = await startApi(() => ({ status: 200, body: eventPageBody }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl, { service: false });
    await expect(client.listDeliveredEvents()).rejects.toThrow(/getServiceToken/);
    await expect(client.acknowledgeEvents({ cursor: 'mcp-evc1-cursor' })).rejects.toThrow(
      /getServiceToken/,
    );
    expect(api.requests).toHaveLength(0);
  });
});

describe('McPlanCoreClient deactivation surface (alpha.7 deactivateCurrentUser)', () => {
  it('POSTs /v1/me/deactivation with a user token, no body and no media type, and maps 204 to void', async () => {
    const api = await startApi(() => ({ status: 204, body: '' }));
    cleanup = api.server;
    const result = await makeClient(api.baseUrl).deactivateCurrentUser();
    expect(result).toBeUndefined();
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]?.method).toBe('POST');
    expect(api.requests[0]?.url).toBe('/v1/me/deactivation');
    expect(api.requests[0]?.headers.authorization).toBe('Bearer oidc-user-token');
    expect(api.requests[0]?.headers.accept).toBe('application/json');
    expect(api.requests[0]?.headers['content-type']).toBeUndefined();
    expect(api.requests[0]?.body).toBeUndefined();
  });

  it('maps 401 and 403 problem responses to typed McPlanProblemError', async () => {
    let status = 401;
    const api = await startApi(() => ({
      status,
      body: JSON.stringify({
        type: '/problems/authentication-required',
        title: status === 401 ? 'Authentication required' : 'Account unavailable',
        status,
        code: status === 401 ? 'AUTHENTICATION_REQUIRED' : 'ACCOUNT_UNAVAILABLE',
        trace_id: `trace-${status}`,
      }),
    }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    const unauthenticated = client.deactivateCurrentUser();
    await expect(unauthenticated).rejects.toMatchObject({
      problem: { code: 'AUTHENTICATION_REQUIRED' },
      httpStatus: 401,
    });
    status = 403;
    const unavailable = client.deactivateCurrentUser();
    await expect(unavailable).rejects.toMatchObject({
      problem: { code: 'ACCOUNT_UNAVAILABLE' },
      httpStatus: 403,
    });
    expect(api.requests).toHaveLength(2);
  });

  it('never retries the deactivation POST on retryable server errors', async () => {
    const api = await startApi(() => ({ status: 503, body: '' }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await expect(client.deactivateCurrentUser()).rejects.toBeInstanceOf(
      McPlanUnexpectedResponseError,
    );
    expect(api.requests).toHaveLength(1);
  });

  it('fires exactly one deactivation request when the connection drops mid-flight', async () => {
    let attempts = 0;
    const server = createServer((request) => {
      attempts += 1;
      request.socket.destroy();
    });
    cleanup = server;
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    const client = new McPlanCoreClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      getUserToken: () => 'oidc-user-token',
    });
    await expect(client.deactivateCurrentUser()).rejects.toBeInstanceOf(McPlanNetworkError);
    // A retry would surface within the transport's first backoff window.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(attempts).toBe(1);
  });

  it('requires a user token provider for deactivation and sends nothing without one', async () => {
    const api = await startApi(() => ({ status: 204, body: '' }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl, { user: false });
    await expect(client.deactivateCurrentUser()).rejects.toThrow(/getUserToken/);
    expect(api.requests).toHaveLength(0);
  });
});
