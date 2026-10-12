import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { McPlanCommunityClient, type McPlanCommunityClientOptions } from '../src/client.js';
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

function makeClient(baseUrl: string, options: { user?: boolean } = {}) {
  const clientOptions: McPlanCommunityClientOptions = { baseUrl };
  if (options.user !== false) {
    clientOptions.getUserToken = () => 'oidc-user-token';
  }
  return new McPlanCommunityClient(clientOptions);
}

const resourceBody = JSON.stringify({
  resource_id: 'res_1',
  type: 'skin',
  owner_user_id: 'usr_1',
  title: 'Demo skin',
  description: 'synthetic',
  status: 'uploading',
  current_version_id: null,
  created_at: '2026-10-12T00:00:00Z',
  updated_at: '2026-10-12T00:00:00Z',
});

describe('McPlanCommunityClient resource commands', () => {
  it('creates a resource with a serialized body, user token and Idempotency-Key', async () => {
    const api = await startApi(() => ({ status: 201, body: resourceBody }));
    cleanup = api.server;
    const created = await makeClient(api.baseUrl).createResource(
      { type: 'skin', title: 'Demo skin', description: 'synthetic' },
      'key-12345678',
    );
    expect(created.resource_id).toBe('res_1');
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]?.method).toBe('POST');
    expect(api.requests[0]?.url).toBe('/v1/resources');
    expect(api.requests[0]?.headers.authorization).toBe('Bearer oidc-user-token');
    expect(api.requests[0]?.headers['idempotency-key']).toBe('key-12345678');
    expect(api.requests[0]?.headers['content-type']).toContain('application/json');
    expect(JSON.parse(api.requests[0]?.body ?? '{}')).toEqual({
      type: 'skin',
      title: 'Demo skin',
      description: 'synthetic',
    });
  });

  it('pre-validates createResource bodies client-side without sending', async () => {
    const api = await startApi(() => ({ status: 201, body: resourceBody }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await expect(
      client.createResource({ type: 'skin', title: '', description: '' }, 'key-12345678'),
    ).rejects.toThrow(RangeError);
    await expect(
      // @ts-expect-error deliberately malformed input from JavaScript callers
      client.createResource({ type: 'map', title: 'x' }, 'key-12345678'),
    ).rejects.toThrow(TypeError);
    await expect(
      client.createResource(
        { type: 'skin', title: 'x'.repeat(121), description: '' },
        'key-12345678',
      ),
    ).rejects.toThrow(RangeError);
    expect(api.requests).toHaveLength(0);
  });

  it('replays createResource with the same key and gets the identical recorded response', async () => {
    const api = await startApi(() => ({ status: 201, body: resourceBody }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    const first = await client.createResource(
      { type: 'skin', title: 'Demo', description: '' },
      'stable-key-1234',
    );
    const replay = await client.createResource(
      { type: 'skin', title: 'Demo', description: '' },
      'stable-key-1234',
    );
    expect(first).toEqual(replay);
    expect(api.requests[0]?.headers['idempotency-key']).toBe('stable-key-1234');
    expect(api.requests[1]?.headers['idempotency-key']).toBe('stable-key-1234');
  });
});

describe('McPlanCommunityClient upload commands', () => {
  const uploadSessionBody = JSON.stringify({
    upload_id: 'up_1',
    upload_url: 'http://127.0.0.1:9000/quarantine/up_1',
    expires_at: '2026-10-12T00:15:00Z',
    upload_headers: { 'content-type': 'image/png', 'content-length': '123' },
  });
  const completedUploadBody = JSON.stringify({
    upload_id: 'up_1',
    media_type: 'image/png',
    size_bytes: 123,
    sha256: 'a'.repeat(64),
    validated_at: '2026-10-12T00:10:00Z',
  });

  it('creates an upload session with the locked body shape and key header', async () => {
    const api = await startApi(() => ({ status: 201, body: uploadSessionBody }));
    cleanup = api.server;
    const session = await makeClient(api.baseUrl).createUploadSession(
      {
        purpose: 'resource_primary',
        media_type: 'image/png',
        size_bytes: 123,
        sha256: 'b'.repeat(64),
      },
      'key-12345678',
    );
    expect(session.upload_id).toBe('up_1');
    expect(api.requests[0]?.url).toBe('/v1/upload-sessions');
    expect(JSON.parse(api.requests[0]?.body ?? '{}')).toEqual({
      purpose: 'resource_primary',
      media_type: 'image/png',
      size_bytes: 123,
      sha256: 'b'.repeat(64),
    });
  });

  it('pre-validates the 1 MiB locked ceiling, sha pattern and purpose client-side', async () => {
    const api = await startApi(() => ({ status: 201, body: uploadSessionBody }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await expect(
      client.createUploadSession(
        {
          purpose: 'resource_primary',
          media_type: 'image/png',
          size_bytes: 1_048_577,
          sha256: 'b'.repeat(64),
        },
        'key-12345678',
      ),
    ).rejects.toThrow(RangeError);
    await expect(
      client.createUploadSession(
        {
          purpose: 'resource_primary',
          media_type: 'image/png',
          size_bytes: 0,
          sha256: 'b'.repeat(64),
        },
        'key-12345678',
      ),
    ).rejects.toThrow(RangeError);
    await expect(
      client.createUploadSession(
        // @ts-expect-error deliberately malformed input from JavaScript callers
        { purpose: 'avatar', media_type: 'image/png', size_bytes: 10, sha256: 'b'.repeat(64) },
        'key-12345678',
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      client.createUploadSession(
        { purpose: 'resource_primary', media_type: 'image/png', size_bytes: 10, sha256: 'NOT-HEX' },
        'key-12345678',
      ),
    ).rejects.toThrow(TypeError);
    expect(api.requests).toHaveLength(0);
  });

  it('completes an upload session with no body and no media type header', async () => {
    const api = await startApi(() => ({ status: 200, body: completedUploadBody }));
    cleanup = api.server;
    const completed = await makeClient(api.baseUrl).completeUploadSession('up_1', 'key-12345678');
    expect(completed.sha256).toBe('a'.repeat(64));
    expect(api.requests[0]?.method).toBe('POST');
    expect(api.requests[0]?.url).toBe('/v1/upload-sessions/up_1/complete');
    expect(api.requests[0]?.headers['idempotency-key']).toBe('key-12345678');
    expect(api.requests[0]?.headers.authorization).toBe('Bearer oidc-user-token');
    expect(api.requests[0]?.headers['content-type']).toBeUndefined();
    expect(api.requests[0]?.body).toBeUndefined();
  });

  it('attaches a version with the sealed upload body shape and receives 202', async () => {
    const versionBody = JSON.stringify({
      version_id: 'ver_1',
      resource_id: 'res_1',
      version: '1',
      schema_version: 1,
      metadata: { edition: 'java', width: 64, height: 64, arm_model: 'steve', second_layer: true },
      files: [
        {
          file_id: 'f1',
          role: 'primary',
          media_type: 'image/png',
          size_bytes: 123,
          sha256: 'a'.repeat(64),
          download_url: null,
        },
      ],
      license: {
        license_id: 'synthetic-test-only',
        license_version: '1',
        attribution_required: true,
        attribution_text: 'Synthetic author',
        snapshot_hash: 'h',
        text: 't',
      },
      created_at: '2026-10-12T00:00:00Z',
      published_at: null,
    });
    const api = await startApi(() => ({ status: 202, body: versionBody }));
    cleanup = api.server;
    const version = await makeClient(api.baseUrl).createResourceVersion(
      'res_1',
      {
        upload_id: 'up_1',
        version: '1',
        schema_version: 1,
        metadata: {
          edition: 'java',
          width: 64,
          height: 64,
          arm_model: 'steve',
          second_layer: true,
        },
        license_id: 'synthetic-test-only',
      },
      'key-12345678',
    );
    expect(version.version_id).toBe('ver_1');
    expect(version.files[0]?.download_url).toBeNull();
    expect(api.requests[0]?.url).toBe('/v1/resources/res_1/versions');
    expect(api.requests[0]?.headers['idempotency-key']).toBe('key-12345678');
    expect(JSON.parse(api.requests[0]?.body ?? '{}')).toEqual({
      upload_id: 'up_1',
      version: '1',
      schema_version: 1,
      metadata: { edition: 'java', width: 64, height: 64, arm_model: 'steve', second_layer: true },
      license_id: 'synthetic-test-only',
    });
  });

  it('rejects version bodies with a wrong schema_version or empty upload_id client-side', async () => {
    const api = await startApi(() => ({ status: 202, body: '{}' }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    const metadata = {
      edition: 'java',
      width: 64,
      height: 64,
      arm_model: 'steve',
      second_layer: true,
    } as const;
    await expect(
      client.createResourceVersion(
        'res_1',
        // @ts-expect-error deliberately malformed input from JavaScript callers
        { upload_id: 'up_1', version: '1', schema_version: 2, metadata, license_id: 'lic' },
        'key-12345678',
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      client.createResourceVersion(
        'res_1',
        { upload_id: '', version: '1', schema_version: 1, metadata, license_id: 'lic' },
        'key-12345678',
      ),
    ).rejects.toThrow(TypeError);
    expect(api.requests).toHaveLength(0);
  });
});

describe('McPlanCommunityClient publication lifecycle', () => {
  it('requests publication with a bodyless POST and receives the pending resource (202)', async () => {
    const pending = JSON.stringify({
      resource_id: 'res_1',
      type: 'skin',
      owner_user_id: 'usr_1',
      title: 'Demo',
      description: '',
      status: 'pending_moderation',
      current_version_id: null,
      created_at: '2026-10-12T00:00:00Z',
      updated_at: '2026-10-12T00:00:00Z',
    });
    const api = await startApi(() => ({ status: 202, body: pending }));
    cleanup = api.server;
    const requested = await makeClient(api.baseUrl).publishResource('res_1', 'key-12345678');
    expect(requested.status).toBe('pending_moderation');
    expect(api.requests[0]?.method).toBe('POST');
    expect(api.requests[0]?.url).toBe('/v1/resources/res_1/publish');
    expect(api.requests[0]?.headers['idempotency-key']).toBe('key-12345678');
    expect(api.requests[0]?.headers['content-type']).toBeUndefined();
    expect(api.requests[0]?.body).toBeUndefined();
  });

  it('unpublishes with a bodyless DELETE and maps 204 to void', async () => {
    const api = await startApi(() => ({ status: 204, body: '' }));
    cleanup = api.server;
    const result = await makeClient(api.baseUrl).unpublishResource('res_1', 'key-12345678');
    expect(result).toBeUndefined();
    expect(api.requests[0]?.method).toBe('DELETE');
    expect(api.requests[0]?.url).toBe('/v1/resources/res_1');
    expect(api.requests[0]?.headers['idempotency-key']).toBe('key-12345678');
    expect(api.requests[0]?.headers['content-type']).toBeUndefined();
    expect(api.requests[0]?.body).toBeUndefined();
  });
});

describe('McPlanCommunityClient reads', () => {
  const detailBody = JSON.stringify({
    resource: {
      resource_id: 'res_1',
      type: 'skin',
      owner_user_id: 'usr_1',
      title: 'Demo',
      description: '',
      status: 'published',
      current_version_id: 'ver_1',
      created_at: '2026-10-12T00:00:00Z',
      updated_at: '2026-10-12T00:00:00Z',
    },
    versions: [],
  });

  it('getResource defaults to the locked anonymous read and never sends credentials', async () => {
    const api = await startApi(() => ({ status: 200, body: detailBody }));
    cleanup = api.server;
    const detail = await makeClient(api.baseUrl).getResource('res_1');
    expect(detail.resource.resource_id).toBe('res_1');
    expect(api.requests[0]?.method).toBe('GET');
    expect(api.requests[0]?.url).toBe('/v1/resources/res_1');
    expect(api.requests[0]?.headers.authorization).toBeUndefined();
  });

  it('getResource sends the user token only in the explicit authenticated owner view', async () => {
    const api = await startApi(() => ({ status: 200, body: detailBody }));
    cleanup = api.server;
    await makeClient(api.baseUrl).getResource('res_1', { authenticated: true });
    expect(api.requests[0]?.headers.authorization).toBe('Bearer oidc-user-token');
  });

  it('lists published resources with limit/cursor/type query parameters', async () => {
    const pageBody = JSON.stringify({ items: [], next_cursor: null });
    const api = await startApi(() => ({ status: 200, body: pageBody }));
    cleanup = api.server;
    await makeClient(api.baseUrl).listResources({
      limit: 2,
      cursor: 'opaque-cursor',
      type: 'skin',
    });
    expect(api.requests[0]?.url).toBe('/v1/resources?limit=2&cursor=opaque-cursor&type=skin');
  });

  it('encodes author ids and forwards listAuthorResources pagination parameters', async () => {
    const pageBody = JSON.stringify({ items: [], next_cursor: null });
    const api = await startApi(() => ({ status: 200, body: pageBody }));
    cleanup = api.server;
    await makeClient(api.baseUrl).listAuthorResources('user/1', { limit: 5 });
    expect(api.requests[0]?.url).toBe('/v1/users/user%2F1/resources?limit=5');
  });

  it('rejects out-of-range limits and cursors client-side without sending', async () => {
    const pageBody = JSON.stringify({ items: [], next_cursor: null });
    const api = await startApi(() => ({ status: 200, body: pageBody }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await expect(client.listResources({ limit: 0 })).rejects.toThrow(RangeError);
    await expect(client.listResources({ limit: 101 })).rejects.toThrow(RangeError);
    await expect(client.listResources({ limit: 2.5 })).rejects.toThrow(RangeError);
    await expect(client.listAuthorResources('u1', { cursor: '' })).rejects.toThrow(RangeError);
    expect(api.requests).toHaveLength(0);
  });

  it('downloads a version as raw bytes with the reported media type', async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, {
        'content-type': 'image/png',
        'content-disposition': 'attachment; filename="skin-ver_1.png"',
      });
      response.end(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    });
    cleanup = server;
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address() as AddressInfo;
    const client = new McPlanCommunityClient({ baseUrl: `http://127.0.0.1:${address.port}` });
    const file = await client.downloadResourceVersion('res_1', 'ver_1');
    expect([...file.bytes]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(file.mediaType).toBe('image/png');
  });
});

describe('McPlanCommunityClient boundaries', () => {
  it('rejects idempotency keys outside the locked 8..200 range', async () => {
    const api = await startApi(() => ({ status: 201, body: resourceBody }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await expect(
      client.createResource({ type: 'skin', title: 'T', description: '' }, 'short'),
    ).rejects.toThrow(RangeError);
    expect(api.requests).toHaveLength(0);
  });

  it('throws a typed McPlanProblemError for locked problem responses', async () => {
    const api = await startApi(() => ({
      status: 409,
      body: JSON.stringify({
        type: '/problems/idempotency-key-conflict',
        title: 'Idempotency key conflict',
        status: 409,
        code: 'IDEMPOTENCY_KEY_CONFLICT',
        trace_id: 'trace-1',
      }),
    }));
    cleanup = api.server;
    const failure = makeClient(api.baseUrl).createResource(
      { type: 'skin', title: 'T', description: '' },
      'key-12345678',
    );
    await expect(failure).rejects.toBeInstanceOf(McPlanProblemError);
    await failure.catch((error: unknown) => {
      const problemError = error as McPlanProblemError;
      expect(problemError.problem.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
      expect(problemError.httpStatus).toBe(409);
    });
  });

  it('falls back to McPlanUnexpectedResponseError for non-problem error bodies', async () => {
    const api = await startApi(() => ({ status: 502, body: '<html>Bad gateway</html>' }));
    cleanup = api.server;
    await expect(makeClient(api.baseUrl).listResources()).rejects.toBeInstanceOf(
      McPlanUnexpectedResponseError,
    );
  });

  it('requires a user token provider for every authenticated operation', async () => {
    const api = await startApi(() => ({ status: 200, body: '{}' }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl, { user: false });
    await expect(
      client.createResource({ type: 'skin', title: 'T', description: '' }, 'key-12345678'),
    ).rejects.toThrow(/getUserToken/);
    await expect(client.completeUploadSession('up_1', 'key-12345678')).rejects.toThrow(
      /getUserToken/,
    );
    await expect(client.publishResource('res_1', 'key-12345678')).rejects.toThrow(/getUserToken/);
    await expect(client.unpublishResource('res_1', 'key-12345678')).rejects.toThrow(/getUserToken/);
    await expect(client.getResource('res_1', { authenticated: true })).rejects.toThrow(
      /getUserToken/,
    );
    expect(api.requests).toHaveLength(0);
  });

  it('rejects base URLs that are not http(s)', () => {
    expect(() => new McPlanCommunityClient({ baseUrl: 'ftp://example.invalid' })).toThrow(
      TypeError,
    );
  });
});
