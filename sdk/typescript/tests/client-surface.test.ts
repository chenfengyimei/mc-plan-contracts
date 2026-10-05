import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { McPlanCoreClient, type McPlanCoreClientOptions } from '../src/client.js';
import { McPlanProblemError, McPlanUnexpectedResponseError } from '../src/problem.js';

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
