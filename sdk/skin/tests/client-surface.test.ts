import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  McPlanSkinClient,
  type CreateRenderRequest,
  type McPlanSkinClientOptions,
} from '../src/client.js';
import { McPlanProblemError, McPlanUnexpectedResponseError } from '../src/problem.js';

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | undefined;
}

type Responder = (request: RecordedRequest) => {
  status: number;
  body?: Buffer | string;
  contentType?: string;
};

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
        reply.contentType ??
        (reply.status >= 200 && reply.status < 300 && !(reply.body instanceof Buffer)
          ? 'application/json'
          : 'application/problem+json');
      response.writeHead(reply.status, { 'content-type': contentType });
      response.end(reply.body ?? '{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}`, requests });
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

function makeClient(baseUrl: string): McPlanSkinClient {
  const options: McPlanSkinClientOptions = { baseUrl };
  return new McPlanSkinClient(options);
}

const conversationBody = JSON.stringify({
  conversation_id: 'conv_1',
  status: 'active',
  attempts_used: 0,
  attempts_limit: 3,
  expires_at: '2026-10-16T12:00:00Z',
});

const png64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 64,
  0, 0, 0, 64, 8, 6, 0, 0, 0,
]);

describe('McPlanSkinClient surface', () => {
  it('creates a conversation with an Idempotency-Key and a serialized body', async () => {
    const api = await startApi(() => ({ status: 201, body: conversationBody }));
    cleanup = api.server;
    const conversation = await makeClient(api.baseUrl).createConversation(
      { initial_message: 'a snow explorer with a deep blue scarf' },
      'key-12345678',
    );
    expect(conversation.conversation_id).toBe('conv_1');
    expect(conversation.attempts_limit).toBe(3);
    expect(api.requests).toHaveLength(1);
    expect(api.requests[0]?.method).toBe('POST');
    expect(api.requests[0]?.url).toBe('/v1/conversations');
    expect(api.requests[0]?.headers['idempotency-key']).toBe('key-12345678');
    expect(api.requests[0]?.headers['content-type']).toContain('application/json');
    expect(JSON.parse(api.requests[0]?.body ?? '{}')).toEqual({
      initial_message: 'a snow explorer with a deep blue scarf',
    });
    // Anonymous window: the SDK has no credential model and never sends one.
    expect(api.requests[0]?.headers.authorization).toBeUndefined();
  });

  it('rejects invalid messages and keys client-side without sending', async () => {
    const api = await startApi(() => ({ status: 201, body: conversationBody }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await expect(
      client.createConversation({ initial_message: '' }, 'key-12345678'),
    ).rejects.toThrow(RangeError);
    await expect(
      client.createConversation({ initial_message: 'x'.repeat(4001) }, 'key-12345678'),
    ).rejects.toThrow(RangeError);
    await expect(client.createConversation({ initial_message: 'ok' }, 'short')).rejects.toThrow(
      RangeError,
    );
    await expect(
      client.createConversation({ initial_message: 'ok' }, 'k'.repeat(201)),
    ).rejects.toThrow(RangeError);
    expect(api.requests).toHaveLength(0);
  });

  it('builds render payloads with and without the arm model and validates the enum', async () => {
    const api = await startApi(() => ({
      status: 202,
      body: '{"job_id":"job_1","status":"queued"}',
    }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await client.createRender('conv 1', { message: 'warmer tones' }, 'key-12345678');
    await client.createRender(
      'conv 1',
      { message: 'warmer tones', preferred_arm_model: 'alex' },
      'key-12345679',
    );
    // Deliberately malformed input from JavaScript callers: the enum value
    // only exists at runtime, so it is injected through an unknown cast.
    const malformed: unknown = { message: 'x', preferred_arm_model: 'zombie' };
    await expect(
      client.createRender('conv 1', malformed as CreateRenderRequest, 'key-12345680'),
    ).rejects.toThrow(RangeError);
    expect(api.requests[0]?.url).toBe('/v1/conversations/conv%201/renders');
    expect(JSON.parse(api.requests[0]?.body ?? '{}')).toEqual({ message: 'warmer tones' });
    expect(JSON.parse(api.requests[1]?.body ?? '{}')).toEqual({
      message: 'warmer tones',
      preferred_arm_model: 'alex',
    });
    expect(api.requests).toHaveLength(2);
  });

  it('validates the finalize payload client-side and posts the closed body', async () => {
    const api = await startApi(() => ({
      status: 202,
      body: '{"job_id":"job_2","status":"queued"}',
    }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await expect(
      client.finalizeSkin(
        'conv_1',
        { candidate_id: '', title: 'T', description: '' },
        'key-12345678',
      ),
    ).rejects.toThrow(TypeError);
    await expect(
      client.finalizeSkin(
        'conv_1',
        { candidate_id: 'cand_1', title: 'x'.repeat(121), description: '' },
        'key-12345678',
      ),
    ).rejects.toThrow(RangeError);
    const accepted = await client.finalizeSkin(
      'conv_1',
      { candidate_id: 'cand_1', title: 'Snow Explorer', description: '' },
      'key-12345678',
    );
    expect(accepted.job_id).toBe('job_2');
    expect(api.requests[0]?.url).toBe('/v1/conversations/conv_1/finalize');
    expect(JSON.parse(api.requests[0]?.body ?? '{}')).toEqual({
      candidate_id: 'cand_1',
      title: 'Snow Explorer',
      description: '',
    });
  });

  it('reads typed job and conversation detail with encoded paths', async () => {
    const api = await startApi((request) => {
      if (request.url.startsWith('/v1/jobs/')) {
        return {
          status: 200,
          body: JSON.stringify({
            job_id: 'job 1',
            kind: 'render',
            status: 'succeeded',
            candidate_id: 'cand_1',
            resource_id: null,
            error_code: null,
            created_at: '2026-10-16T10:00:00Z',
            updated_at: '2026-10-16T10:00:05Z',
          }),
        };
      }
      return {
        status: 200,
        body: JSON.stringify({
          conversation_id: 'conv_1',
          status: 'active',
          attempts_used: 1,
          attempts_limit: 3,
          expires_at: '2026-10-16T12:00:00Z',
          messages: [
            { role: 'user', content: 'hello', created_at: '2026-10-16T10:00:00Z' },
            { role: 'assistant', content: 'hi', created_at: '2026-10-16T10:00:01Z' },
          ],
        }),
      };
    });
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    const job = await client.getJob('job 1');
    expect(job.status).toBe('succeeded');
    expect(job.candidate_id).toBe('cand_1');
    expect(api.requests[0]?.url).toBe('/v1/jobs/job%201');
    const detail = await client.getConversation('conv_1');
    expect(detail.messages).toHaveLength(2);
    expect(detail.messages[0]?.role).toBe('user');
    expect(api.requests[1]?.url).toBe('/v1/conversations/conv_1');
    expect(api.requests[1]?.headers.authorization).toBeUndefined();
  });

  it('maps deleteConversation 204 to void and 404 problems to typed errors', async () => {
    let status = 204;
    const api = await startApi(() => ({
      status,
      body:
        status === 204
          ? ''
          : JSON.stringify({
              type: '/problems/skin-conversation-not-found',
              title: 'Conversation not found',
              status: 404,
              code: 'SKIN_CONVERSATION_NOT_FOUND',
              trace_id: 'trace-skin',
            }),
    }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await expect(client.deleteConversation('conv_1')).resolves.toBeUndefined();
    status = 404;
    await expect(client.deleteConversation('conv_1')).rejects.toMatchObject({
      problem: { code: 'SKIN_CONVERSATION_NOT_FOUND' },
      httpStatus: 404,
    });
    expect(api.requests).toHaveLength(2);
    expect(api.requests[0]?.method).toBe('DELETE');
  });

  it('returns validated 64x64 PNG bytes for preview and download', async () => {
    const api = await startApi(() => ({ status: 200, body: png64, contentType: 'image/png' }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    const preview = await client.getCandidatePreview('conv_1', 'cand_1');
    expect(preview.mediaType).toBe('image/png');
    expect(preview.bytes.subarray(0, 8)).toEqual(new Uint8Array(png64.subarray(0, 8)));
    expect(api.requests[0]?.url).toBe('/v1/conversations/conv_1/candidates/cand_1/preview');
    expect(api.requests[0]?.headers.accept).toBe('image/png');
    const download = await client.downloadSkin('conv_1', 'res_1');
    expect(download.bytes.length).toBe(png64.length);
    expect(api.requests[1]?.url).toBe('/v1/conversations/conv_1/skins/res_1/download');
  });

  it('rejects producer bytes that are not a 64x64 PNG', async () => {
    const notPng = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    const wrongSize = Buffer.from(png64);
    wrongSize[19] = 32;
    let body = notPng;
    const api = await startApi(() => ({ status: 200, body, contentType: 'image/png' }));
    cleanup = api.server;
    const client = makeClient(api.baseUrl);
    await expect(client.getCandidatePreview('conv_1', 'cand_1')).rejects.toThrow(TypeError);
    body = wrongSize;
    await expect(client.getCandidatePreview('conv_1', 'cand_1')).rejects.toThrow(TypeError);
  });

  it('maps 409 idempotency conflicts to typed problems', async () => {
    const api = await startApi(() => ({
      status: 409,
      body: JSON.stringify({
        type: '/problems/skin-idempotency-conflict',
        title: 'Idempotency conflict',
        status: 409,
        code: 'SKIN_IDEMPOTENCY_CONFLICT',
        trace_id: 'trace-conflict',
      }),
    }));
    cleanup = api.server;
    const conflict = makeClient(api.baseUrl).createConversation(
      { initial_message: 'different body, same key' },
      'key-12345678',
    );
    await expect(conflict).rejects.toBeInstanceOf(McPlanProblemError);
    await conflict.catch((error: unknown) => {
      const problemError = error as McPlanProblemError;
      expect(problemError.problem.code).toBe('SKIN_IDEMPOTENCY_CONFLICT');
      expect(problemError.httpStatus).toBe(409);
    });
  });

  it('falls back to McPlanUnexpectedResponseError for non-problem error bodies', async () => {
    const api = await startApi(() => ({ status: 502, body: '<html>Bad gateway</html>' }));
    cleanup = api.server;
    await expect(makeClient(api.baseUrl).getJob('job_1')).rejects.toBeInstanceOf(
      McPlanUnexpectedResponseError,
    );
  });

  it('retries retryable server errors on the idempotent GETs', async () => {
    let calls = 0;
    const api = await startApi(() => {
      calls += 1;
      return {
        status: calls < 3 ? 503 : 200,
        body:
          calls < 3
            ? ''
            : '{"job_id":"job_1","kind":"render","status":"queued","created_at":"2026-10-16T10:00:00Z","updated_at":"2026-10-16T10:00:00Z"}',
      };
    });
    cleanup = api.server;
    const job = await makeClient(api.baseUrl).getJob('job_1');
    expect(job.job_id).toBe('job_1');
    expect(api.requests).toHaveLength(3);
  });

  it('rejects base URLs that are not http(s)', () => {
    expect(() => new McPlanSkinClient({ baseUrl: 'ftp://skin.example.invalid' })).toThrow(
      TypeError,
    );
  });
});
