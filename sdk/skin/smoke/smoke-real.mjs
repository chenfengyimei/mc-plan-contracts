#!/usr/bin/env node
/**
 * Real-HTTP smoke for @mc-plan/skin-sdk against the real Skin producer.
 *
 * Honest attribution: the producer is the mc-plan-skin tree at main 14a8fe3
 * (MCP-F1-SKIN-008/009 final tree, the SUPPORTED_PRODUCER_COMMIT anchor)
 * running from the neighboring read-only checkout — the api and worker
 * processes are spawned with `node dist/main.js` against session-unique
 * manually-started PostgreSQL 17 and Redis 7 containers (this Mac cannot use
 * the testcontainers strategy probe, an established local workaround). The
 * provider is the deterministic Fake Provider: NO LLM or image model is
 * involved, no paid credentials are read, Q-001 stays untouched, and the
 * generated candidates are fixture-quality — this smoke proves the SDK and
 * the anonymous-window protocol, not model quality.
 *
 * Scenarios cover the full producer chain through the SDK:
 * create - idempotent replay and same-key conflict - render + job poll -
 * candidate preview bytes - finalize + job poll - finalized download bytes -
 * conversation detail with messages - attempts exhaustion - post-completion
 * finalize rejection - unknown-id 404 families - delete cascade with no
 * resurrection. No clock manipulation is performed: the 24h/30d retention
 * windows are only read as metadata here.
 *
 * Resources (containers, volume, child processes, temp storage) are
 * session-unique and cleaned up in finally; nothing from other sessions is
 * touched and nothing is written into the mc-plan-skin repository.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { McPlanProblemError, createMcPlanSkinClient, generateIdempotencyKey } =
  await import('../dist/index.js');

const DOCKER_CANDIDATES = [
  process.env.DOCKER_BIN,
  'docker',
  '/Applications/Docker.app/Contents/Resources/bin/docker',
  '/usr/local/bin/docker',
].filter((candidate) => typeof candidate === 'string' && candidate.length > 0);

function resolveDocker() {
  for (const candidate of DOCKER_CANDIDATES) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  throw new Error('docker CLI not found; set DOCKER_BIN');
}

const docker = resolveDocker();
const RUN = `mcp-skin-sdk-smoke-${process.pid}`;
const PG_CONTAINER = `${RUN}-pg`;
const REDIS_CONTAINER = `${RUN}-redis`;
const PG_VOLUME = `${RUN}-pgdata`;
const PG_IMAGE = 'postgres:17-alpine';
const REDIS_IMAGE = 'redis:7-alpine';
const here = path.dirname(fileURLToPath(import.meta.url));
const SKIN_ROOT = path.resolve(here, '..', '..', '..', '..', 'mc-plan-skin');

function dockerRun(args, options = {}) {
  return execFileSync(docker, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : undefined;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await fn()) {
        return;
      }
    } catch {
      // retry
    }
    if (Date.now() > deadline) {
      throw new Error(`timeout waiting for ${label}`);
    }
    await sleep(250);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`SMOKE ASSERTION FAILED: ${message}`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`SMOKE ASSERTION FAILED: ${label}: expected ${expected}, got ${actual}`);
  }
}

/** Field-closed payload check: present keys must be locked-schema keys, required keys must exist. */
function assertClosedObject(item, requiredKeys, optionalKeys, label) {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of Object.keys(item)) {
    assert(allowed.has(key), `${label}: unexpected key ${key}`);
  }
  for (const key of requiredKeys) {
    assert(key in item, `${label}: missing required key ${key}`);
  }
}

async function expectProblem(promise, expectedStatus, expectedCode, label) {
  try {
    await promise;
  } catch (error) {
    if (!(error instanceof McPlanProblemError)) {
      throw new Error(
        `${label}: expected McPlanProblemError, got ${error?.constructor?.name}: ${error?.message}`,
      );
    }
    assertEqual(error.httpStatus, expectedStatus, `${label} status`);
    assertEqual(error.problem.code, expectedCode, `${label} code`);
    assert(
      typeof error.problem.trace_id === 'string' && error.problem.trace_id.length > 0,
      `${label} trace_id`,
    );
    return;
  }
  throw new Error(`${label}: expected a problem response but the call succeeded`);
}

let children = [];
let storageRoot;
let created = false;
const apiSink = { contents: '' };
const workerSink = { contents: '' };

async function main() {
  // 0. Preflight: images present locally (no pulls), no container name collision.
  const images = dockerRun(['images', '--format', '{{.Repository}}:{{.Tag}}']);
  assert(images.includes(PG_IMAGE), `image ${PG_IMAGE} not present locally`);
  assert(images.includes(REDIS_IMAGE), `image ${REDIS_IMAGE} not present locally`);
  const busy = dockerRun(['ps', '-a', '--format', '{{.Names}}']).split('\n');
  assert(
    !busy.includes(PG_CONTAINER) && !busy.includes(REDIS_CONTAINER),
    'container name collision',
  );
  assert(
    (await import('node:fs')).existsSync(path.join(SKIN_ROOT, 'apps', 'api', 'dist', 'main.js')),
    'skin api dist missing in the producer checkout',
  );

  // 1. Session-unique PostgreSQL + Redis (manually started; testcontainers
  // strategy probing is unreliable on this host).
  const pgPort = await freePort();
  const redisPort = await freePort();
  dockerRun([
    'run',
    '-d',
    '--name',
    PG_CONTAINER,
    '-p',
    `127.0.0.1:${pgPort}:5432`,
    '-e',
    'POSTGRES_USER=skin',
    '-e',
    'POSTGRES_PASSWORD=local-only',
    '-e',
    'POSTGRES_DB=skin',
    '-v',
    `${PG_VOLUME}:/var/lib/postgresql/data`,
    PG_IMAGE,
  ]);
  dockerRun([
    'run',
    '-d',
    '--name',
    REDIS_CONTAINER,
    '-p',
    `127.0.0.1:${redisPort}:6379`,
    REDIS_IMAGE,
  ]);
  created = true;
  await waitFor(
    'postgres ready',
    () => {
      const out = dockerRun(['exec', PG_CONTAINER, 'pg_isready', '-U', 'skin', '-d', 'skin']);
      return out.includes('accepting connections');
    },
    90_000,
  );
  await waitFor(
    'redis ready',
    () => dockerRun(['exec', REDIS_CONTAINER, 'redis-cli', 'ping']).includes('PONG'),
    30_000,
  );

  const databaseUrl = `postgresql://skin:local-only@127.0.0.1:${pgPort}/skin`;
  const redisUrl = `redis://127.0.0.1:${redisPort}`;

  // 2. Migrations inside the producer checkout (no repository writes).
  const dbEnv = { ...process.env, SKIN_DATABASE_URL: databaseUrl };
  execFileSync(process.execPath, ['scripts/require-database-url.mjs'], {
    cwd: path.join(SKIN_ROOT, 'packages', 'db'),
    env: dbEnv,
    stdio: 'ignore',
  });
  execFileSync(
    path.join(SKIN_ROOT, 'packages', 'db', 'node_modules', '.bin', 'prisma'),
    ['migrate', 'deploy', '--config', 'prisma7.config.ts'],
    {
      cwd: path.join(SKIN_ROOT, 'packages', 'db'),
      env: dbEnv,
      stdio: 'ignore',
    },
  );

  // 3. Spawn the producer api + worker (deterministic fake provider, offline).
  storageRoot = mkdtempSync(path.join(tmpdir(), `${RUN}-storage-`));
  const apiPort = await freePort();
  const sharedEnv = {
    ...process.env,
    SKIN_RUN_MODE: 'standalone',
    SKIN_ENV: 'development',
    SKIN_PROVIDER: 'fake',
    SKIN_LOG_LEVEL: 'warn',
    SKIN_DATABASE_URL: databaseUrl,
    SKIN_REDIS_URL: redisUrl,
    SKIN_API_HOST: '127.0.0.1',
    SKIN_API_PORT: String(apiPort),
    SKIN_CANDIDATE_STORAGE_ROOT: storageRoot,
    SKIN_OFFICIAL_CORE_BASE_URL: '',
  };
  const spawnProducer = (cwdRelative, sink) => {
    const child = spawn(process.execPath, ['--enable-source-maps', 'dist/main.js'], {
      cwd: path.join(SKIN_ROOT, cwdRelative),
      env: sharedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => {
      sink.contents += chunk;
    });
    child.stderr.on('data', (chunk) => {
      sink.contents += chunk;
    });
    children.push(child);
    return child;
  };
  spawnProducer(path.join('apps', 'api'), apiSink);
  spawnProducer(path.join('apps', 'worker'), workerSink);

  const baseUrl = `http://127.0.0.1:${apiPort}`;
  await waitFor(
    'skin api ready',
    async () => {
      const response = await fetch(`${baseUrl}/health/ready`);
      return response.status === 200;
    },
    90_000,
  );
  console.log('[smoke] producer ready at', baseUrl);

  // 4. SDK scenarios (real HTTP).
  const client = createMcPlanSkinClient({ baseUrl });

  // 4.1 Create; field-closed conversation; idempotent replay; key conflict.
  const conversationKey = generateIdempotencyKey();
  const conversation = await client.createConversation(
    { initial_message: 'a snow explorer with a deep blue scarf' },
    conversationKey,
  );
  assertClosedObject(
    conversation,
    ['conversation_id', 'status', 'attempts_used', 'attempts_limit', 'expires_at'],
    [],
    'conversation',
  );
  assertEqual(conversation.status, 'active', 'conversation status');
  assertEqual(conversation.attempts_used, 0, 'conversation attempts before render');
  assertEqual(conversation.attempts_limit, 3, 'conversation attempt limit');
  const replay = await client.createConversation(
    { initial_message: 'a snow explorer with a deep blue scarf' },
    conversationKey,
  );
  assertEqual(
    replay.conversation_id,
    conversation.conversation_id,
    'same-key replay returns the original conversation',
  );
  await expectProblem(
    client.createConversation({ initial_message: 'a different logical command' }, conversationKey),
    409,
    'SKIN_IDEMPOTENCY_CONFLICT',
    'same key with a different body',
  );
  const conversationId = conversation.conversation_id;

  // 4.2 Render + job poll (fake provider is deterministic and fast).
  const accepted = await client.createRender(
    conversationId,
    { message: 'cooler tones, snow drifts, brighter scarf' },
    generateIdempotencyKey(),
  );
  assertClosedObject(accepted, ['job_id', 'status'], [], 'job accepted');
  assertEqual(accepted.status, 'queued', 'render accepted as queued');
  let renderJob = await client.getJob(accepted.job_id);
  for (
    let hop = 0;
    hop < 200 && renderJob.status !== 'succeeded' && renderJob.status !== 'failed';
    hop += 1
  ) {
    await sleep(250);
    renderJob = await client.getJob(accepted.job_id);
  }
  assertEqual(renderJob.status, 'succeeded', 'render job succeeded');
  assertClosedObject(
    renderJob,
    ['job_id', 'kind', 'status', 'created_at', 'updated_at'],
    ['candidate_id', 'resource_id', 'error_code'],
    'render job',
  );
  assertEqual(renderJob.kind, 'render', 'render job kind');
  assert(typeof renderJob.candidate_id === 'string', 'succeeded render exposes candidate_id');
  const candidateId = renderJob.candidate_id ?? '';

  // 4.3 Candidate preview bytes (SDK validates the 64x64 PNG in-band).
  const preview = await client.getCandidatePreview(conversationId, candidateId);
  assertEqual(preview.mediaType, 'image/png', 'preview content type');
  assert(preview.bytes.length > 100, 'preview carries real PNG bytes');
  await expectProblem(
    client.getCandidatePreview(conversationId, '00000000-0000-4000-8000-000000000000'),
    404,
    'SKIN_CANDIDATE_NOT_FOUND',
    'unknown candidate preview',
  );

  // 4.4 Conversation detail with the message history.
  const detail = await client.getConversation(conversationId);
  assertClosedObject(
    detail,
    ['conversation_id', 'status', 'attempts_used', 'attempts_limit', 'expires_at', 'messages'],
    [],
    'conversation detail',
  );
  assertEqual(detail.attempts_used, 1, 'detail attempts after one render');
  assert(detail.messages.length >= 2, 'detail carries the user and assistant messages');
  assertEqual(detail.messages[0]?.role, 'user', 'first message role');
  assertEqual(
    detail.messages[0]?.content,
    'a snow explorer with a deep blue scarf',
    'first message content',
  );
  for (const message of detail.messages) {
    assertClosedObject(message, ['role', 'content', 'created_at'], [], 'detail message');
  }

  // 4.5 Finalize + job poll; replay; post-completion rejection.
  const finalizeKey = generateIdempotencyKey();
  const finalizeAccepted = await client.finalizeSkin(
    conversationId,
    { candidate_id: candidateId, title: 'Snow Explorer', description: 'sdk smoke finalization' },
    finalizeKey,
  );
  let finalizeJob = await client.getJob(finalizeAccepted.job_id);
  for (
    let hop = 0;
    hop < 200 && finalizeJob.status !== 'succeeded' && finalizeJob.status !== 'failed';
    hop += 1
  ) {
    await sleep(250);
    finalizeJob = await client.getJob(finalizeAccepted.job_id);
  }
  assertEqual(finalizeJob.status, 'succeeded', 'finalize job succeeded');
  assertEqual(finalizeJob.kind, 'finalize', 'finalize job kind');
  assert(typeof finalizeJob.resource_id === 'string', 'succeeded finalize exposes resource_id');
  const resourceId = finalizeJob.resource_id ?? '';
  const finalizeReplay = await client.finalizeSkin(
    conversationId,
    { candidate_id: candidateId, title: 'Snow Explorer', description: 'sdk smoke finalization' },
    finalizeKey,
  );
  assertEqual(
    finalizeReplay.job_id,
    finalizeAccepted.job_id,
    'same-key finalize replay returns the original job',
  );
  await expectProblem(
    client.finalizeSkin(
      conversationId,
      { candidate_id: candidateId, title: 'Again', description: '' },
      generateIdempotencyKey(),
    ),
    409,
    'SKIN_CONVERSATION_NOT_ACTIVE',
    'finalize after completion',
  );

  // 4.6 Finalized download bytes.
  const skin = await client.downloadSkin(conversationId, resourceId);
  assertEqual(skin.mediaType, 'image/png', 'download content type');
  assert(skin.bytes.length > 100, 'download carries real PNG bytes');
  await expectProblem(
    client.downloadSkin(conversationId, '00000000-0000-4000-8000-000000000000'),
    404,
    'SKIN_RESOURCE_NOT_FOUND',
    'unknown finalized resource',
  );

  // 4.7 Attempts exhaustion on a second conversation (no clock manipulation).
  const second = await client.createConversation(
    { initial_message: 'attempt limit probe conversation' },
    generateIdempotencyKey(),
  );
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const queued = await client.createRender(
      second.conversation_id,
      { message: `attempt ${attempt}` },
      generateIdempotencyKey(),
    );
    assertEqual(queued.status, 'queued', `attempt ${attempt} queued`);
  }
  await expectProblem(
    client.createRender(
      second.conversation_id,
      { message: 'one too many' },
      generateIdempotencyKey(),
    ),
    409,
    'SKIN_ATTEMPTS_EXHAUSTED',
    'render beyond the attempt limit',
  );

  // 4.8 Unknown-id 404 families.
  await expectProblem(
    client.getJob('00000000-0000-4000-8000-000000000000'),
    404,
    'SKIN_JOB_NOT_FOUND',
    'unknown job',
  );
  await expectProblem(
    client.getConversation('00000000-0000-4000-8000-000000000000'),
    404,
    'SKIN_CONVERSATION_NOT_FOUND',
    'unknown conversation',
  );

  // 4.9 Delete cascade with no resurrection on any public face.
  await expectProblem(
    client.deleteConversation('00000000-0000-4000-8000-000000000000'),
    404,
    'SKIN_CONVERSATION_NOT_FOUND',
    'delete unknown conversation',
  );
  const deleted = await client.deleteConversation(conversationId);
  assertEqual(deleted, undefined, 'delete resolves to void on 204');
  await expectProblem(
    client.getConversation(conversationId),
    404,
    'SKIN_CONVERSATION_NOT_FOUND',
    'detail after delete',
  );
  await expectProblem(
    client.getCandidatePreview(conversationId, candidateId),
    404,
    'SKIN_CANDIDATE_NOT_FOUND',
    'preview after delete (no resurrection)',
  );
  await expectProblem(
    client.downloadSkin(conversationId, resourceId),
    404,
    'SKIN_RESOURCE_NOT_FOUND',
    'download after delete (no resurrection)',
  );

  console.log('[smoke] all scenarios passed ✔');
  children.forEach((child) => child.kill());
  children = [];
}

async function cleanup() {
  const swallow = (fn) => {
    try {
      fn();
    } catch {
      // best effort cleanup of this session's own resources only
    }
  };
  for (const child of children) {
    swallow(() => child.kill());
  }
  if (created) {
    swallow(() => dockerRun(['rm', '-f', REDIS_CONTAINER]));
    swallow(() => dockerRun(['rm', '-f', PG_CONTAINER]));
    swallow(() => dockerRun(['volume', 'rm', PG_VOLUME]));
  }
  if (storageRoot !== undefined) {
    swallow(() => rmSync(storageRoot, { recursive: true, force: true }));
  }
}

try {
  await main();
} catch (error) {
  console.error('[smoke] failed:', error instanceof Error ? error.message : error);
  console.error('--- producer api output (tail) ---');
  console.error(apiSink.contents.slice(-6000) || '(no api output)');
  console.error('--- producer worker output (tail) ---');
  console.error(workerSink.contents.slice(-6000) || '(no worker output)');
  throw error;
} finally {
  await cleanup();
}
