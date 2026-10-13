#!/usr/bin/env node
/** Real HTTP alpha.4 SDK acceptance: final Community image, isolated Core/DB/S3, LOCAL-JWKS user/reviewer tokens. All review decisions use the real authorized API with synthetic content; no database decision seed. Producer separately verifies real realm-gated Keycloak PKCE. Session resources are cleaned in finally. */

import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { exportJWK, generateKeyPair, SignJWT } from 'jose';

const { McPlanProblemError } = await import('../dist/index.js');

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
const COMMUNITY_IMAGE = 'mc-plan-community:mcp-f2-community-003-d482331';
const CORE_IMAGE = 'mc-plan-core:mcp-f2-core-001-fb1bc07';
const PG_IMAGE = process.env.SMOKE_PG_IMAGE ?? 'postgres:17-alpine';
const RUN = `mcp-c002-community-sdk-${process.pid}`;
const NETWORK = `${RUN}-net`;
const COMMUNITY_PG = `${RUN}-cpg`;
const CORE_PG = `${RUN}-kpg`;
const CORE_CONTAINER = `${RUN}-core`;
const COMMUNITY_CONTAINER = `${RUN}-community`;
const COMMUNITY_PG_VOLUME = `${RUN}-cpgdata`;
const CORE_PG_VOLUME = `${RUN}-kpgdata`;
const S3_BUCKET = 'community-sdk-smoke';
const S3RVER_DEFAULT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
  'mc-plan-community',
  'node_modules',
  's3rver',
  'bin',
  's3rver.js',
);
const S3RVER_BIN = process.env.S3RVER_BIN ?? S3RVER_DEFAULT;
const OIDC_ISSUER = 'https://identity.example.invalid/realms/community-sdk-smoke';
const LICENSE_ID = 'synthetic-smoke-license';
const LICENSES_JSON = JSON.stringify([
  {
    id: LICENSE_ID,
    version: '1',
    text: 'Synthetic smoke fixture only: no production policy or real author license.',
    attributionRequired: false,
    attributionText: null,
  },
]);
// Deterministic 64x64 all-opaque PNG (180 bytes) — the exact fixture shape the
// producer's own acceptance used; matches metadata
// {edition:"java",width:64,height:64,arm_model:"steve",second_layer:true}.
const SKIN_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAe0lEQVR4AeXBAQEAIAyAME4UwxnOkj4I25z7PmESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3ESJ3EStx7LArGLilXJAAAAAElFTkSuQmCC';
const SKIN_BYTES = Buffer.from(SKIN_PNG_BASE64, 'base64');
const SKIN_SHA256 = createHash('sha256').update(SKIN_BYTES).digest('hex');
const SKIN_METADATA = {
  edition: 'java',
  width: 64,
  height: 64,
  arm_model: 'steve',
  second_layer: true,
};

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
    await sleep(750);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`SMOKE ASSERTION FAILED: ${message}`);
  }
}

/**
 * Order-insensitive canonical JSON: the producer replays the recorded
 * response through a jsonb column, which does not preserve key order.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`SMOKE ASSERTION FAILED: ${label}: expected ${expected}, got ${actual}`);
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

let jwksServer;
let s3Process;
let s3Directory;
let networkCreated = false;
let containersStarted = false;

async function main() {
  // 0. Preflight: images and fixtures.
  const images = dockerRun(['images', '--format', '{{.Repository}}:{{.Tag}}']);
  assert(images.includes(COMMUNITY_IMAGE), `producer image ${COMMUNITY_IMAGE} not present locally`);
  assert(images.includes(CORE_IMAGE), `core image ${CORE_IMAGE} not present locally`);
  assert(images.includes(PG_IMAGE), `postgres image ${PG_IMAGE} not present locally`);
  assert(existsSync(S3RVER_BIN), `s3rver CLI not found at ${S3RVER_BIN}`);
  const busy = (() => {
    try {
      const out = execFileSync(docker, ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
      return out.split('\n');
    } catch {
      return [];
    }
  })();
  for (const name of [COMMUNITY_PG, CORE_PG, CORE_CONTAINER, COMMUNITY_CONTAINER]) {
    assert(!busy.includes(name), `container name collision: ${name}`);
  }

  dockerRun(['network', 'create', NETWORK]);
  networkCreated = true;

  // 1. Isolated PostgreSQL containers (community + core).
  for (const [name, volume, user, password, database] of [
    [COMMUNITY_PG, COMMUNITY_PG_VOLUME, 'community', 'local-only', 'community'],
    [CORE_PG, CORE_PG_VOLUME, 'core_test', 'local-test-only', 'isolated_core_test'],
  ]) {
    dockerRun([
      'run',
      '-d',
      '--name',
      name,
      '--network',
      NETWORK,
      '-e',
      `POSTGRES_USER=${user}`,
      '-e',
      `POSTGRES_PASSWORD=${password}`,
      '-e',
      `POSTGRES_DB=${database}`,
      '-v',
      `${volume}:/var/lib/postgresql/data`,
      PG_IMAGE,
    ]);
  }
  containersStarted = true;
  await waitFor(
    'community postgres ready',
    () => {
      const out = dockerRun([
        'exec',
        COMMUNITY_PG,
        'pg_isready',
        '-U',
        'community',
        '-d',
        'community',
      ]);
      return out.includes('accepting connections');
    },
    90_000,
  );
  await waitFor(
    'core postgres ready',
    () => {
      const out = dockerRun([
        'exec',
        CORE_PG,
        'pg_isready',
        '-U',
        'core_test',
        '-d',
        'isolated_core_test',
      ]);
      return out.includes('accepting connections');
    },
    90_000,
  );

  // 2. Local JWKS test issuer on the host (honestly attributed: NOT Keycloak).
  const rsa = await generateKeyPair('RS256');
  const publicJwk = {
    ...(await exportJWK(rsa.publicKey)),
    kid: 'community-sdk-smoke-key',
    alg: 'RS256',
    use: 'sig',
  };
  const jwksPort = await freePort();
  jwksServer = http.createServer((request, response) => {
    if (request.url === '/jwks') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => jwksServer.listen(jwksPort, '0.0.0.0', resolve));
  const hostJwks = `http://host.docker.internal:${jwksPort}/jwks`;

  // 3. S3rver (the producer's own S3-protocol test server) on the host.
  s3Directory = mkdtempSync(path.join(tmpdir(), `${RUN}-s3-`));
  const s3Port = await freePort();
  s3Process = spawn(
    process.execPath,
    [
      S3RVER_BIN,
      '--directory',
      s3Directory,
      '--address',
      '0.0.0.0',
      '--port',
      String(s3Port),
      '--no-vhost-buckets',
      '--configure-bucket',
      S3_BUCKET,
    ],
    { stdio: 'ignore' },
  );
  const s3EndpointHost = `http://127.0.0.1:${s3Port}`;
  await waitFor(
    's3rver ready',
    async () => {
      try {
        await fetch(s3EndpointHost);
        return true;
      } catch {
        return false;
      }
    },
    30_000,
  );
  console.log(`[smoke] s3rver ready at ${s3EndpointHost} (bucket ${S3_BUCKET})`);

  // 4. Real Core container (separate identity truth, own database).
  const coreEnv = [
    '-e',
    'NODE_ENV=test',
    '-e',
    'HOST=0.0.0.0',
    '-e',
    'PORT=3000',
    '-e',
    'LOG_LEVEL=fatal',
    '-e',
    'DATABASE_URL=postgresql://core_test:local-test-only@' + CORE_PG + ':5432/isolated_core_test',
    '-e',
    `OIDC_ISSUER=${OIDC_ISSUER}`,
    '-e',
    `OIDC_AUDIENCE=mc-plan-core`,
    '-e',
    `OIDC_JWKS_URL=${hostJwks}`,
    '-e',
    'PAT_HASH_KEY=local-test-only-hash-key-0123456789abcdef',
    '-e',
    `KEYCLOAK_ADMIN_TOKEN_URL=${OIDC_ISSUER}/protocol/openid-connect/token`,
    '-e',
    'KEYCLOAK_ADMIN_REALM=community-sdk-smoke',
    '-e',
    'KEYCLOAK_ADMIN_CLIENT_ID=core-test-admin',
    '-e',
    'KEYCLOAK_ADMIN_CLIENT_SECRET=local-test-only-admin-secret',
    '-e',
    'OUTBOX_PUBLISHER_ENABLED=false',
    '-e',
    'OTEL_ENABLED=false',
  ];
  dockerRun(
    [
      'run',
      '--rm',
      '--network',
      NETWORK,
      '--add-host',
      'host.docker.internal:host-gateway',
      ...coreEnv,
      CORE_IMAGE,
      'npm',
      'run',
      'migration:deploy',
    ],
    { stdio: 'inherit' },
  );
  dockerRun([
    'run',
    '-d',
    '--name',
    CORE_CONTAINER,
    '--network',
    NETWORK,
    '--add-host',
    'host.docker.internal:host-gateway',
    ...coreEnv,
    CORE_IMAGE,
  ]);
  await waitFor(
    'core ready',
    async () => {
      const out = dockerRun([
        'exec',
        CORE_CONTAINER,
        'node',
        '-e',
        'fetch("http://127.0.0.1:3000/health/ready").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))',
      ]);
      return true;
    },
    90_000,
  );
  console.log('[smoke] core container ready (separate identity truth)');

  // 5. Community container on the fixed producer image.
  const communityPort = await freePort();
  const communityEnv = [
    '-e',
    'NODE_ENV=test',
    '-e',
    'HOST=0.0.0.0',
    '-e',
    'PORT=3100',
    '-e',
    'DATABASE_URL=postgresql://community:local-only@' + COMMUNITY_PG + ':5432/community',
    '-e',
    `OIDC_ISSUER=${OIDC_ISSUER}`,
    '-e',
    `OIDC_JWKS_URL=${hostJwks}`,
    '-e',
    'OIDC_AUDIENCE=mc-plan-community',
    '-e',
    `CORE_API_URL=http://${CORE_CONTAINER}:3000`,
    '-e',
    `PUBLIC_API_URL=http://127.0.0.1:${communityPort}`,
    '-e',
    `S3_ENDPOINT=http://host.docker.internal:${s3Port}`,
    '-e',
    `S3_PUBLIC_ENDPOINT=${s3EndpointHost}`,
    '-e',
    'S3_REGION=us-east-1',
    '-e',
    `S3_BUCKET=${S3_BUCKET}`,
    '-e',
    'S3_ACCESS_KEY_ID=S3RVER',
    '-e',
    'S3_SECRET_ACCESS_KEY=S3RVER',
    '-e',
    `CURSOR_SECRET=local-smoke-cursor-secret-0123456789-${randomBytes(4).toString('hex')}`,
    '-e',
    `LICENSES_JSON=${LICENSES_JSON}`,
    '-e',
    'UPLOAD_TTL_SECONDS=900',
    '-e',
    'MAX_ACTIVE_UPLOADS=32',
    '-e',
    'WRITE_RATE_LIMIT_PER_MINUTE=1000',
    '-e',
    'WORKER_ENABLED=true',
    '-e',
    'WORKER_INTERVAL_MS=250',
    '-e',
    'MODERATION_MODE=manual',
  ];
  dockerRun(
    [
      'run',
      '--rm',
      '--network',
      NETWORK,
      '--add-host',
      'host.docker.internal:host-gateway',
      ...communityEnv,
      COMMUNITY_IMAGE,
      'npm',
      'run',
      'migration:deploy',
    ],
    { stdio: 'inherit' },
  );
  dockerRun([
    'run',
    '-d',
    '--name',
    COMMUNITY_CONTAINER,
    '--network',
    NETWORK,
    '--add-host',
    'host.docker.internal:host-gateway',
    '-p',
    `127.0.0.1:${communityPort}:3100`,
    ...communityEnv,
    COMMUNITY_IMAGE,
  ]);
  const baseUrl = `http://127.0.0.1:${communityPort}`;
  await waitFor(
    'community ready',
    async () => {
      const response = await fetch(`${baseUrl}/health/ready`);
      return response.status === 200;
    },
    90_000,
  );
  console.log('[smoke] community container ready at', baseUrl);

  // 6. Local-JWKS tokens (dual audience per locked alpha.2 semantics).
  const sign = async (payload, issuer = OIDC_ISSUER, expires = '5m') =>
    new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'community-sdk-smoke-key' })
      .setIssuer(issuer)
      .setAudience(['mc-plan-core', 'mc-plan-community'])
      .setIssuedAt()
      .setExpirationTime(expires)
      .setSubject(payload.sub)
      .sign(rsa.privateKey);
  const fullScopes = 'profile:read resource:read resource:write upload:write';
  const reviewerToken = await sign({
    sub: 'community-sdk-smoke-reviewer',
    scope: 'profile:read moderation:review',
    email_verified: true,
    azp: 'community-sdk-smoke-browser',
  });
  const userAToken = await sign({
    sub: 'community-sdk-smoke-user-a',
    scope: fullScopes,
    email_verified: true,
    azp: 'community-sdk-smoke-browser',
  });
  const userBToken = await sign({
    sub: 'community-sdk-smoke-user-b',
    scope: fullScopes,
    email_verified: true,
    azp: 'community-sdk-smoke-browser',
  });
  const noWriteToken = await sign({
    sub: 'community-sdk-smoke-user-no-write',
    scope: 'profile:read resource:read',
    email_verified: true,
    azp: 'community-sdk-smoke-browser',
  });
  const noResourceReadToken = await sign({
    sub: 'community-sdk-smoke-user-no-resource-read',
    scope: 'profile:read resource:write upload:write',
    email_verified: true,
    azp: 'community-sdk-smoke-browser',
  });
  const wrongIssuerToken = await sign(
    {
      sub: 'community-sdk-smoke-user-wrong-issuer',
      scope: fullScopes,
      email_verified: true,
      azp: 'community-sdk-smoke-browser',
    },
    'https://untrusted.example.invalid/realms/other',
  );
  const expiredToken = await sign(
    {
      sub: 'community-sdk-smoke-user-expired',
      scope: fullScopes,
      email_verified: true,
      azp: 'community-sdk-smoke-browser',
    },
    OIDC_ISSUER,
    1,
  );

  const { createMcPlanCommunityClient, generateIdempotencyKey } = await import('../dist/index.js');
  const reviewerClient = createMcPlanCommunityClient({
    baseUrl,
    getUserToken: async () => reviewerToken,
  });
  const clientA = createMcPlanCommunityClient({
    baseUrl,
    getUserToken: async () => userAToken,
  });
  const clientB = createMcPlanCommunityClient({
    baseUrl,
    getUserToken: async () => userBToken,
  });
  const noWriteClient = createMcPlanCommunityClient({
    baseUrl,
    getUserToken: async () => noWriteToken,
  });
  const noResourceReadClient = createMcPlanCommunityClient({
    baseUrl,
    getUserToken: async () => noResourceReadToken,
  });
  const wrongIssuerClient = createMcPlanCommunityClient({
    baseUrl,
    getUserToken: async () => wrongIssuerToken,
  });
  const expiredClient = createMcPlanCommunityClient({
    baseUrl,
    getUserToken: async () => expiredToken,
  });

  // 7. [REAL-PRODUCER-HTTP] Anonymous public reads start empty.
  const emptyPage = await createMcPlanCommunityClient({ baseUrl }).listResources();
  assertEqual(emptyPage.items.length, 0, 'fresh deployment lists no published resources');
  assertEqual(emptyPage.next_cursor, null, 'fresh deployment page has no cursor');

  // 8. [REAL-PRODUCER-HTTP] User A provisions an ACTIVE identity through the
  // separate Core container on the first protected call, then owns a resource.
  const resourceA = await clientA.createResource(
    { type: 'skin', title: 'Snow Explorer skin', description: 'SDK smoke fixture A' },
    generateIdempotencyKey(),
  );
  assertEqual(resourceA.status, 'uploading', 'new resource starts in uploading');
  assertEqual(resourceA.owner_user_id.length > 0, true, 'owner resolved through Core /v1/me');
  const ownerA = resourceA.owner_user_id;

  // 8.1 Same-key/same-request replay returns the identical recorded response;
  // same key with a different request is the locked 409 conflict.
  const createdWithKey = await clientA.createResource(
    { type: 'skin', title: 'Keyed replay fixture', description: 'SDK smoke replay' },
    'replay-key-resource-a',
  );
  const replayedWithKey = await clientA.createResource(
    { type: 'skin', title: 'Keyed replay fixture', description: 'SDK smoke replay' },
    'replay-key-resource-a',
  );
  assert(
    canonicalJson(createdWithKey) === canonicalJson(replayedWithKey),
    'same-key createResource replay returns the identical recorded response',
  );
  await expectProblem(
    clientA.createResource(
      { type: 'skin', title: 'Different title', description: '' },
      'replay-key-resource-a',
    ),
    409,
    'IDEMPOTENCY_KEY_CONFLICT',
    'same key different request',
  );

  // 9. [REAL-PRODUCER-HTTP] Upload session lifecycle with a real signed S3 PUT.
  const session = await clientA.createUploadSession(
    {
      purpose: 'resource_primary',
      media_type: 'image/png',
      size_bytes: SKIN_BYTES.length,
      sha256: SKIN_SHA256,
    },
    generateIdempotencyKey(),
  );
  assert(typeof session.upload_url === 'string' && session.upload_url.length > 0, 'signed URL');
  assert(typeof session.expires_at === 'string', 'session expiry');
  const putResponse = await fetch(session.upload_url, {
    method: 'PUT',
    headers: session.upload_headers,
    body: SKIN_BYTES,
  });
  assertEqual(putResponse.status, 200, 'external signed PUT');
  const completed = await clientA.completeUploadSession(
    session.upload_id,
    generateIdempotencyKey(),
  );
  assertEqual(completed.media_type, 'image/png', 'completed upload media type');
  assertEqual(completed.size_bytes, SKIN_BYTES.length, 'completed upload size');
  assertEqual(completed.sha256, SKIN_SHA256, 'completed upload sha256');

  // 9.1 A repeated complete (the upload is already VALIDATED, so no re-seal)
  // returns the identical recorded body.
  const completedAgain = await clientA.completeUploadSession(
    session.upload_id,
    'complete-replay-key-1',
  );
  assertEqual(canonicalJson(completedAgain), canonicalJson(completed), 'complete replay identical');

  // 9.2 [REAL-PRODUCER-HTTP] A session whose declared bytes are not a PNG
  // seals nothing: complete re-reads the actual bytes and answers UPLOAD_INVALID.
  const garbage = randomBytes(200);
  const garbageSession = await clientA.createUploadSession(
    {
      purpose: 'resource_primary',
      media_type: 'image/png',
      size_bytes: garbage.length,
      sha256: createHash('sha256').update(garbage).digest('hex'),
    },
    generateIdempotencyKey(),
  );
  const garbagePut = await fetch(garbageSession.upload_url, {
    method: 'PUT',
    headers: garbageSession.upload_headers,
    body: garbage,
  });
  assertEqual(garbagePut.status, 200, 'garbage signed PUT accepted at the object store');
  await expectProblem(
    clientA.completeUploadSession(garbageSession.upload_id, generateIdempotencyKey()),
    400,
    'UPLOAD_INVALID',
    'non-PNG bytes rejected at complete',
  );

  // 9.3 [REAL-PRODUCER-HTTP] Completing before any PUT: the locked 409.
  const emptySession = await clientA.createUploadSession(
    {
      purpose: 'resource_primary',
      media_type: 'image/png',
      size_bytes: SKIN_BYTES.length,
      sha256: SKIN_SHA256,
    },
    generateIdempotencyKey(),
  );
  await expectProblem(
    clientA.completeUploadSession(emptySession.upload_id, generateIdempotencyKey()),
    409,
    'UPLOAD_NOT_READY',
    'complete without uploaded bytes',
  );

  // 9.4 Unknown upload ids are 404 without exposing existence.
  await expectProblem(
    clientA.completeUploadSession(randomUUID(), generateIdempotencyKey()),
    404,
    'NOT_FOUND',
    'unknown upload id',
  );

  // 9.5 The 1 MiB locked ceiling: the SDK refuses client-side and the raw
  // producer boundary answers the locked 400.
  let sdkCeilingError;
  try {
    await clientA.createUploadSession(
      {
        purpose: 'resource_primary',
        media_type: 'image/png',
        size_bytes: 1_048_577,
        sha256: SKIN_SHA256,
      },
      generateIdempotencyKey(),
    );
  } catch (error) {
    sdkCeilingError = error;
  }
  assert(sdkCeilingError instanceof RangeError, 'SDK pre-validates the 1 MiB ceiling');
  const rawOversize = await fetch(`${baseUrl}/v1/upload-sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${userAToken}`,
      'idempotency-key': generateIdempotencyKey(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      purpose: 'resource_primary',
      media_type: 'image/png',
      size_bytes: 1_048_577,
      sha256: SKIN_SHA256,
    }),
  });
  assertEqual(rawOversize.status, 400, 'raw over-limit upload rejected');
  assertEqual((await rawOversize.json()).code, 'VALIDATION_FAILED', 'raw over-limit problem code');

  // 10. [REAL-PRODUCER-HTTP] Version attach + publish request keep the
  // resource private until moderation allows it (ADR-0016: no decision yet).
  const versionA = await clientA.createResourceVersion(
    resourceA.resource_id,
    {
      upload_id: session.upload_id,
      version: '1',
      schema_version: 1,
      metadata: SKIN_METADATA,
      license_id: LICENSE_ID,
    },
    generateIdempotencyKey(),
  );
  assertEqual(versionA.files.length, 1, 'version carries exactly one primary file');
  assertEqual(versionA.files[0].download_url, null, 'unpublished version has no download URL');
  assert(versionA.license !== null, 'version carries the immutable license snapshot');
  const publishRequested = await clientA.publishResource(
    resourceA.resource_id,
    generateIdempotencyKey(),
  );
  assertEqual(
    publishRequested.status,
    'pending_moderation',
    'manual review without a decision keeps pending',
  );

  // 10.1 [REAL-PRODUCER-HTTP] Owner authenticated view sees the private
  // candidate; the anonymous read stays 404 without exposing state.
  const ownerView = await clientA.getResource(resourceA.resource_id, { authenticated: true });
  assertEqual(ownerView.resource.resource_id, resourceA.resource_id, 'owner view resource id');
  assert(
    ownerView.versions.some((v) => v.version_id === versionA.version_id),
    'owner sees candidate',
  );
  await expectProblem(
    createMcPlanCommunityClient({ baseUrl }).getResource(resourceA.resource_id),
    404,
    'NOT_FOUND',
    'anonymous read of a pending resource',
  );

  // 10.2 [REAL-PRODUCER-HTTP] Publishing without any version is the locked
  // state-machine 409; a foreign owner is a flat 404.
  const bareResource = await clientA.createResource(
    { type: 'skin', title: 'Bare container', description: '' },
    generateIdempotencyKey(),
  );
  await expectProblem(
    clientA.publishResource(bareResource.resource_id, generateIdempotencyKey()),
    409,
    'RESOURCE_STATE_CONFLICT',
    'publish without a candidate version',
  );
  await expectProblem(
    clientB.createResourceVersion(
      resourceA.resource_id,
      {
        upload_id: session.upload_id,
        version: '2',
        schema_version: 1,
        metadata: SKIN_METADATA,
        license_id: LICENSE_ID,
      },
      generateIdempotencyKey(),
    ),
    404,
    'NOT_FOUND',
    'foreign owner cannot attach a version',
  );
  await expectProblem(
    clientB.unpublishResource(resourceA.resource_id, generateIdempotencyKey()),
    404,
    'NOT_FOUND',
    'foreign owner cannot unpublish',
  );

  // 11. Real authorized manual decision on synthetic content; no database bypass.
  await expectProblem(
    clientA.reviewResourceVersion(
      resourceA.resource_id,
      versionA.version_id,
      { decision: 'approve' },
      generateIdempotencyKey(),
    ),
    403,
    'INSUFFICIENT_SCOPE',
    'author cannot approve',
  );
  const reviewKey = generateIdempotencyKey(),
    reviewBody = { decision: 'approve', reason: 'SYNTHETIC local operator fixture' };
  const reviewed = await reviewerClient.reviewResourceVersion(
    resourceA.resource_id,
    versionA.version_id,
    reviewBody,
    reviewKey,
  );
  assertEqual(reviewed.status, 'published', 'review publishes exact candidate');
  assertEqual(reviewed.current_version_id, versionA.version_id, 'reviewed current version');
  const reviewReplay = await reviewerClient.reviewResourceVersion(
    resourceA.resource_id,
    versionA.version_id,
    reviewBody,
    reviewKey,
  );
  assertEqual(
    reviewReplay.current_version_id,
    reviewed.current_version_id,
    'manual decision replay',
  );
  await expectProblem(
    reviewerClient.reviewResourceVersion(
      resourceA.resource_id,
      versionA.version_id,
      { decision: 'reject' },
      reviewKey,
    ),
    409,
    'IDEMPOTENCY_KEY_CONFLICT',
    'review key cannot change decision',
  );

  // 12. [REAL-PRODUCER-HTTP] Published anonymous read, author list and
  // controlled download with byte-identity assertions.
  const publicView = await createMcPlanCommunityClient({ baseUrl }).getResource(
    resourceA.resource_id,
  );
  assertEqual(publicView.resource.status, 'published', 'published resource status');
  assertEqual(publicView.versions.length, 1, 'published view shows the published version');
  assertEqual(
    publicView.versions[0].published_at !== null,
    true,
    'published version carries published_at',
  );
  const publicVersion = publicView.versions[0];
  assert(
    typeof publicVersion.files[0].download_url === 'string' &&
      publicVersion.files[0].download_url.endsWith(
        `/v1/resources/${resourceA.resource_id}/versions/${publicVersion.version_id}/download`,
      ),
    'published version exposes the controlled download URL',
  );
  const inline = await createMcPlanCommunityClient({ baseUrl }).previewResourceVersion(
    resourceA.resource_id,
    publicView.versions[0].version_id,
  );
  assertEqual(
    createHash('sha256').update(inline.bytes).digest('hex'),
    SKIN_SHA256,
    'inline preview is exact sealed PNG',
  );
  const downloaded = await createMcPlanCommunityClient({ baseUrl }).downloadResourceVersion(
    resourceA.resource_id,
    publicVersion.version_id,
  );
  assertEqual(downloaded.mediaType, 'image/png', 'download content type');
  assertEqual(
    createHash('sha256').update(downloaded.bytes).digest('hex'),
    publicVersion.files[0].sha256,
    'downloaded bytes hash to the locked file sha256',
  );
  const rawDownload = await fetch(
    `${baseUrl}/v1/resources/${resourceA.resource_id}/versions/${publicVersion.version_id}/download`,
  );
  assertEqual(
    rawDownload.headers.get('content-disposition'),
    'attachment; filename="skin-' + publicVersion.version_id + '.png"',
    'download disposition',
  );
  assertEqual(rawDownload.headers.get('x-content-type-options'), 'nosniff', 'download nosniff');
  assertEqual(rawDownload.headers.get('cache-control'), 'no-store', 'download no-store');

  // 13. [REAL-PRODUCER-HTTP] Two more published resources (real lifecycle +
  // authorized manual decisions) to exercise deterministic pagination.
  const publishedResources = [resourceA];
  for (const [index, title] of ['Pagination fixture B', 'Pagination fixture C'].entries()) {
    const resource = await clientA.createResource(
      { type: 'skin', title, description: 'SDK smoke pagination fixture' },
      generateIdempotencyKey(),
    );
    const uploadSession = await clientA.createUploadSession(
      {
        purpose: 'resource_primary',
        media_type: 'image/png',
        size_bytes: SKIN_BYTES.length,
        sha256: SKIN_SHA256,
      },
      generateIdempotencyKey(),
    );
    const put = await fetch(uploadSession.upload_url, {
      method: 'PUT',
      headers: uploadSession.upload_headers,
      body: SKIN_BYTES,
    });
    assertEqual(put.status, 200, `signed PUT for ${title}`);
    const upload = await clientA.completeUploadSession(
      uploadSession.upload_id,
      generateIdempotencyKey(),
    );
    const version = await clientA.createResourceVersion(
      resource.resource_id,
      {
        upload_id: uploadSession.upload_id,
        version: '1',
        schema_version: 1,
        metadata: SKIN_METADATA,
        license_id: LICENSE_ID,
      },
      generateIdempotencyKey(),
    );
    await clientA.publishResource(resource.resource_id, generateIdempotencyKey());
    await reviewerClient.reviewResourceVersion(
      resource.resource_id,
      version.version_id,
      { decision: 'approve', reason: 'SYNTHETIC pagination fixture' },
      generateIdempotencyKey(),
    );
    publishedResources.push(resource);
  }

  // 13.1 Cursor pagination over listResources: limit 2 → next page → done,
  // with the locked created_at DESC, resource_id DESC ordering.
  const anonClient = createMcPlanCommunityClient({ baseUrl });
  const pageOne = await anonClient.listResources({ limit: 2 });
  assertEqual(pageOne.items.length, 2, 'page one size');
  assert(pageOne.next_cursor !== null, 'page one carries a cursor');
  const pageTwo = await anonClient.listResources({ limit: 2, cursor: pageOne.next_cursor });
  assertEqual(pageTwo.items.length, 1, 'page two size');
  assertEqual(pageTwo.next_cursor, null, 'page two is the last page');
  const listed = [...pageOne.items, ...pageTwo.items];
  assertEqual(listed.length, 3, 'pagination returns every published resource exactly once');
  const expectedIds = new Set(publishedResources.map((r) => r.resource_id));
  for (const item of listed) {
    assert(
      expectedIds.has(item.resource_id),
      `pagination item ${item.resource_id} is a published fixture`,
    );
  }
  for (let index = 1; index < listed.length; index += 1) {
    const previous = listed[index - 1];
    const current = listed[index];
    const previousKey = `${previous.created_at}|${previous.resource_id}`;
    const currentKey = `${current.created_at}|${current.resource_id}`;
    assert(
      previousKey > currentKey,
      `locked created_at DESC, resource_id DESC order at index ${index}`,
    );
  }

  // 13.2 Author pages use the same protocol; an unknown author is an empty
  // page, never a 404.
  const authorPageOne = await anonClient.listAuthorResources(ownerA, { limit: 2 });
  assertEqual(authorPageOne.items.length, 2, 'author page one size');
  assert(authorPageOne.next_cursor !== null, 'author page one carries a cursor');
  const authorPageTwo = await anonClient.listAuthorResources(ownerA, {
    limit: 2,
    cursor: authorPageOne.next_cursor,
  });
  assertEqual(authorPageTwo.items.length, 1, 'author page two size');
  assertEqual(authorPageTwo.next_cursor, null, 'author page two is the last page');
  const unknownAuthor = await anonClient.listAuthorResources(randomUUID());
  assertEqual(unknownAuthor.items.length, 0, 'unknown author is an empty page');
  assertEqual(unknownAuthor.next_cursor, null, 'unknown author page has no cursor');

  // 13.3 Forged cursors and cursors replayed across filter surfaces are the
  // locked 400; the SDK only ever passes cursors through.
  await expectProblem(
    anonClient.listResources({ cursor: 'forged-cursor' }),
    400,
    'VALIDATION_FAILED',
    'forged cursor',
  );
  await expectProblem(
    anonClient.listAuthorResources(ownerA, { cursor: pageOne.next_cursor }),
    400,
    'VALIDATION_FAILED',
    'list cursor replayed on the author surface',
  );

  // 14. [REAL-PRODUCER-HTTP] Auth negatives through the SDK.
  await expectProblem(
    noWriteClient.createResource(
      { type: 'skin', title: 'Denied', description: '' },
      generateIdempotencyKey(),
    ),
    403,
    'INSUFFICIENT_SCOPE',
    'token without resource:write',
  );
  await expectProblem(
    noResourceReadClient.getResource(resourceA.resource_id, { authenticated: true }),
    403,
    'INSUFFICIENT_SCOPE',
    'owner view without resource:read',
  );
  await expectProblem(
    wrongIssuerClient.createResource(
      { type: 'skin', title: 'Denied', description: '' },
      generateIdempotencyKey(),
    ),
    401,
    'AUTHENTICATION_REQUIRED',
    'untrusted issuer token',
  );
  await expectProblem(
    expiredClient.createResource(
      { type: 'skin', title: 'Denied', description: '' },
      generateIdempotencyKey(),
    ),
    401,
    'AUTHENTICATION_REQUIRED',
    'expired token',
  );

  // 14.1 [REAL-PRODUCER-HTTP] The raw no-credential boundary (the SDK refuses
  // to send authenticated calls without a provider, so the producer boundary
  // is probed directly).
  const bare = await fetch(`${baseUrl}/v1/resources`, {
    method: 'POST',
    headers: {
      'idempotency-key': generateIdempotencyKey(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ type: 'skin', title: 'Bare', description: '' }),
  });
  assertEqual(bare.status, 401, 'no-credential command rejected with 401');
  assertEqual((await bare.json()).code, 'AUTHENTICATION_REQUIRED', 'no-credential problem code');

  // 14.2 [REAL-PRODUCER-HTTP] Unknown ids and raw over-range limits.
  await expectProblem(
    anonClient.getResource('not-a-uuid'),
    404,
    'NOT_FOUND',
    'malformed resource id',
  );
  const rawLimit = await fetch(`${baseUrl}/v1/resources?limit=101`);
  assertEqual(rawLimit.status, 400, 'raw over-range limit rejected');
  assertEqual((await rawLimit.json()).code, 'VALIDATION_FAILED', 'raw over-range problem code');
  let sdkLimitError;
  try {
    await anonClient.listResources({ limit: 101 });
  } catch (error) {
    sdkLimitError = error;
  }
  assert(sdkLimitError instanceof RangeError, 'SDK pre-validates the limit range');

  // 15. [REAL-PRODUCER-HTTP] User B keeps a fully independent identity and
  // never sees A's private surfaces through any SDK read.
  const resourceB = await clientB.createResource(
    { type: 'skin', title: 'User B private skin', description: 'Owner isolation fixture' },
    generateIdempotencyKey(),
  );
  assert(resourceB.owner_user_id !== ownerA, 'user B resolves a distinct Core identity');
  await expectProblem(
    anonClient.getResource(resourceB.resource_id),
    404,
    'NOT_FOUND',
    'anonymous read of user B private resource',
  );
  const ownerViewB = await clientB.getResource(resourceB.resource_id, { authenticated: true });
  assertEqual(ownerViewB.resource.resource_id, resourceB.resource_id, 'user B owner view works');

  // 16. [REAL-PRODUCER-HTTP] Terminal unpublish: 204 void, replay 204, new
  // key 204, and every public surface of A disappears immediately.
  const unpublishKey = generateIdempotencyKey();
  const unpublishFirst = await clientA.unpublishResource(resourceA.resource_id, unpublishKey);
  assertEqual(unpublishFirst, undefined, 'unpublish resolves to void on 204');
  await clientA.unpublishResource(resourceA.resource_id, unpublishKey);
  await clientA.unpublishResource(resourceA.resource_id, generateIdempotencyKey());
  await expectProblem(
    anonClient.getResource(resourceA.resource_id),
    404,
    'NOT_FOUND',
    'anonymous read after unpublish',
  );
  await expectProblem(
    anonClient.downloadResourceVersion(resourceA.resource_id, publicVersion.version_id),
    404,
    'NOT_FOUND',
    'download after unpublish',
  );
  await expectProblem(
    anonClient.previewResourceVersion(resourceA.resource_id, publicVersion.version_id),
    404,
    'NOT_FOUND',
    'preview after unpublish',
  );
  await expectProblem(
    reviewerClient.reviewResourceVersion(
      resourceA.resource_id,
      publicVersion.version_id,
      { decision: 'approve' },
      generateIdempotencyKey(),
    ),
    409,
    'RESOURCE_STATE_CONFLICT',
    'review cannot revive unpublish',
  );
  const afterUnpublish = await anonClient.listResources({ limit: 100 });
  assert(
    !afterUnpublish.items.some((item) => item.resource_id === resourceA.resource_id),
    'unpublished resource leaves the public list immediately',
  );
  assertEqual(afterUnpublish.items.length, 2, 'the other published fixtures remain listed');

  // 17. Every exposed operation has at least one success path in this run:
  // createUploadSession (9), completeUploadSession (9/13), createResource
  // (8/13/15), createResourceVersion (10/13), publishResource (10/13),
  // getResource (10.1/12/15), listResources (7/13.1), listAuthorResources
  // (13.2), downloadResourceVersion (12), unpublishResource (16), reviewResourceVersion (11/13), previewResourceVersion (12/16).
  console.log('[smoke] all scenarios passed ✔');
}

async function cleanup() {
  const swallow = (fn) => {
    try {
      fn();
    } catch {
      // best effort cleanup of this session's own resources only
    }
  };
  if (s3Process !== undefined) {
    swallow(() => s3Process.kill('SIGTERM'));
  }
  if (s3Directory !== undefined) {
    swallow(() => rmSync(s3Directory, { recursive: true, force: true }));
  }
  if (jwksServer !== undefined) {
    await new Promise((resolve) => jwksServer.close(() => resolve()));
  }
  if (networkCreated) {
    swallow(() => dockerRun(['rm', '-f', COMMUNITY_CONTAINER]));
    swallow(() => dockerRun(['rm', '-f', CORE_CONTAINER]));
    swallow(() => dockerRun(['rm', '-f', COMMUNITY_PG]));
    swallow(() => dockerRun(['rm', '-f', CORE_PG]));
    swallow(() => dockerRun(['volume', 'rm', COMMUNITY_PG_VOLUME]));
    swallow(() => dockerRun(['volume', 'rm', CORE_PG_VOLUME]));
    swallow(() => dockerRun(['network', 'rm', NETWORK]));
  }
}

try {
  await main();
} catch (error) {
  try {
    console.error('--- community container logs (tail) ---');
    console.error(dockerRun(['logs', '--tail', '60', COMMUNITY_CONTAINER]));
  } catch {
    // the container may not exist; cleanup still runs
  }
  throw error;
} finally {
  await cleanup();
}
