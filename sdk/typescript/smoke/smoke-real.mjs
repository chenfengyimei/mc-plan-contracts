#!/usr/bin/env node
/**
 * Real-HTTP smoke for @mc-plan/core-sdk against the fixed CORE-005 producer
 * image (mc-plan-core:mcp-f1-core-005-5508d60) on an isolated PostgreSQL 17.
 *
 * Not a mock transport: the SDK talks to the real running Core container.
 * A tiny local JWKS endpoint signs real RS256 OIDC/service tokens so the
 * producer's issuer/audience/scope/email_verified validation runs for real.
 * Resources (network, containers, volume) are session-unique and cleaned up
 * in finally; nothing from other sessions is touched.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';

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
const IMAGE = 'mc-plan-core:mcp-f1-core-005-5508d60';
const PG_IMAGE = process.env.SMOKE_PG_IMAGE ?? 'postgres:17-alpine';
const RUN = `mcp-c001-sdk-${process.pid}`;
const NETWORK = `${RUN}-net`;
const PG_CONTAINER = `${RUN}-pg`;
const CORE_CONTAINER = `${RUN}-core`;
const PG_VOLUME = `${RUN}-pgdata`;
const DATABASE_URL = 'postgresql://core:core@' + PG_CONTAINER + ':5432/mc_plan_core';
const OIDC_AUDIENCE = 'mc-plan-core';

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
let created = false;

async function main() {
  // 0. Preflight: image presence (no pulls of the producer image; PG may be pulled).
  const images = dockerRun(['images', '--format', '{{.Repository}}:{{.Tag}}']);
  assert(images.includes(IMAGE), `producer image ${IMAGE} not present locally`);
  if (!images.includes(PG_IMAGE)) {
    console.log(`[smoke] pulling ${PG_IMAGE}…`);
    dockerRun(['pull', PG_IMAGE], { stdio: 'inherit' });
  }
  const busy = (() => {
    try {
      const out = execFileSync(docker, ['ps', '--format', '{{.Names}}'], { encoding: 'utf8' });
      return out.split('\n');
    } catch {
      return [];
    }
  })();
  assert(
    !busy.includes(PG_CONTAINER) && !busy.includes(CORE_CONTAINER),
    'container name collision',
  );

  dockerRun(['network', 'create', NETWORK]);
  created = true;

  // 1. Isolated PostgreSQL.
  dockerRun([
    'run',
    '-d',
    '--name',
    PG_CONTAINER,
    '--network',
    NETWORK,
    '-e',
    'POSTGRES_USER=core',
    '-e',
    'POSTGRES_PASSWORD=core',
    '-e',
    'POSTGRES_DB=mc_plan_core',
    '-v',
    `${PG_VOLUME}:/var/lib/postgresql/data`,
    PG_IMAGE,
  ]);
  await waitFor(
    'postgres ready',
    () => {
      const out = dockerRun([
        'exec',
        PG_CONTAINER,
        'pg_isready',
        '-U',
        'core',
        '-d',
        'mc_plan_core',
      ]);
      return out.includes('accepting connections');
    },
    90_000,
  );
  const psql = (sql) =>
    dockerRun([
      'exec',
      PG_CONTAINER,
      'psql',
      '-U',
      'core',
      '-d',
      'mc_plan_core',
      '-tAc',
      sql,
    ]).trim();

  // 2. Local JWKS issuer.
  const rsa = await generateKeyPair('RS256');
  const publicJwk = {
    ...(await exportJWK(rsa.publicKey)),
    kid: 'sdk-smoke-key',
    alg: 'RS256',
    use: 'sig',
  };
  const jwksPort = await freePort();
  const issuer = `http://host.docker.internal:${jwksPort}/realms/sdk-smoke`;
  jwksServer = http.createServer((request, response) => {
    if (request.url === '/jwks') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => jwksServer.listen(jwksPort, '127.0.0.1', resolve));

  const baseEnv = [
    '-e',
    `DATABASE_URL=${DATABASE_URL}`,
    '-e',
    `OIDC_ISSUER=${issuer}`,
    '-e',
    `OIDC_JWKS_URL=http://host.docker.internal:${jwksPort}/jwks`,
    '-e',
    `OIDC_AUDIENCE=${OIDC_AUDIENCE}`,
    '-e',
    'OIDC_ALLOWED_ALGORITHMS=RS256',
    '-e',
    'OIDC_CLOCK_TOLERANCE_SECONDS=0',
    '-e',
    `PAT_HASH_KEY=${randomBytes(32).toString('hex')}`,
    '-e',
    'PAT_MAX_VALIDITY_DAYS=30',
    '-e',
    'NODE_ENV=production',
    '-e',
    'OTEL_ENABLED=false',
  ];

  // 3. Migrations inside the fixed image, then start the app.
  dockerRun(
    ['run', '--rm', '--network', NETWORK, ...baseEnv, IMAGE, 'npm', 'run', 'migration:deploy'],
    { stdio: 'inherit' },
  );
  const corePort = await freePort();
  dockerRun(
    [
      'run',
      '-d',
      '--name',
      CORE_CONTAINER,
      '--network',
      NETWORK,
      '-p',
      `127.0.0.1:${corePort}:3000`,
      ...baseEnv,
      IMAGE,
    ],
    { stdio: 'inherit' },
  );
  const baseUrl = `http://127.0.0.1:${corePort}`;
  await waitFor(
    'core ready',
    async () => {
      const response = await fetch(`${baseUrl}/health/ready`);
      return response.status === 200;
    },
    90_000,
  );
  console.log('[smoke] core container ready at', baseUrl);

  // 4. Real tokens.
  const sign = async (payload) =>
    new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'sdk-smoke-key' })
      .setIssuer(issuer)
      .setAudience(OIDC_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .setSubject(payload.sub)
      .sign(rsa.privateKey);
  const userToken = await sign({
    sub: 'sdk-smoke-user-001',
    scope: 'profile:read credits:read',
    email_verified: true,
  });
  const serviceToken = await sign({ sub: 'sdk-smoke-service', scope: 'credits:consume' });
  const wrongIssuerToken = await new SignJWT({
    sub: 'sdk-smoke-user-002',
    scope: 'profile:read credits:read',
    email_verified: true,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'sdk-smoke-key' })
    .setIssuer('https://untrusted.example.invalid')
    .setAudience(OIDC_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(rsa.privateKey);
  const missingScopeToken = await sign({
    sub: 'sdk-smoke-user-003',
    scope: 'profile:read',
    email_verified: true,
  });

  // 5. SDK scenarios (real HTTP).
  const { createMcPlanCoreClient, generateIdempotencyKey } = await import('../dist/index.js');
  const userClient = createMcPlanCoreClient({ baseUrl, getUserToken: async () => userToken });
  const scopedClient = createMcPlanCoreClient({
    baseUrl,
    getUserToken: async () => missingScopeToken,
  });
  const badClient = createMcPlanCoreClient({ baseUrl, getUserToken: async () => wrongIssuerToken });
  const serviceClient = createMcPlanCoreClient({
    baseUrl,
    getUserToken: async () => userToken,
    getServiceToken: async () => serviceToken,
  });

  // 5.1 Profile read provisions the business user lazily.
  const me = await userClient.getCurrentUser();
  assertEqual(me.user_id.length > 0, true, 'me.user_id non-empty');
  assert(typeof me.display_name === 'string' && me.display_name.length > 0, 'me.display_name');

  // 5.2 Entitlement view (read never consumes quota).
  const entitlements = await userClient.listCurrentEntitlements();
  assertEqual(entitlements.items.length, 1, 'one entitlement item');
  const entitlement = entitlements.items[0];
  assertEqual(entitlement.module, 'skin', 'entitlement module');
  assertEqual(entitlement.timezone, 'Asia/Shanghai', 'entitlement timezone');
  assertEqual(entitlement.granted, 3, 'entitlement granted baseline 3');
  assertEqual(entitlement.remaining, 3, 'entitlement remaining before consume');

  // 5.3 Balance read: zero without an account, and no side effects.
  assertEqual(Number(psql('SELECT count(*) FROM credit_accounts')), 0, 'credit_accounts before');
  assertEqual(Number(psql('SELECT count(*) FROM credit_ledger_entries')), 0, 'ledger before');
  const balance = await userClient.getCreditBalance();
  assertEqual(balance.balance, 0, 'balance zero without account');
  assertEqual(me.user_id, balance.user_id, 'balance user matches current user');
  assertEqual(
    Number(psql('SELECT count(*) FROM credit_accounts')),
    0,
    'credit_accounts after (no account created)',
  );
  assertEqual(
    Number(psql('SELECT count(*) FROM credit_ledger_entries')),
    0,
    'ledger after (no ledger writes)',
  );

  // 5.4 Idempotent consume: 201 first, 200 replay with same consumption_id, 409 on key conflict.
  const key = generateIdempotencyKey();
  const consumeBody = {
    user_id: me.user_id,
    module: 'skin',
    operation: 'creation_session',
    units: 1,
    reference_id: 'sdk-smoke-reference-001',
  };
  const first = await serviceClient.consumeCredits(consumeBody, key);
  assertEqual(first.replayed, false, 'first consume is 201');
  assertEqual(first.data.source, 'daily_entitlement', 'consume source stays daily_entitlement');
  assertEqual(first.data.remaining, 2, 'remaining after first consume');
  const replay = await serviceClient.consumeCredits(consumeBody, key);
  assertEqual(replay.replayed, true, 'same key replays 200');
  assertEqual(
    replay.data.consumption_id,
    first.data.consumption_id,
    'replay returns original consumption_id',
  );
  assertEqual(replay.data.remaining, 2, 'replay remaining unchanged');
  const conflict = serviceClient.consumeCredits(
    { ...consumeBody, reference_id: 'sdk-smoke-reference-002' },
    key,
  );
  await expectProblem(conflict, 409, 'IDEMPOTENCY_KEY_CONFLICT', 'same key different body');

  // 5.5 Typed problems: untrusted issuer and missing scope.
  await expectProblem(badClient.getCurrentUser(), 401, 'AUTHENTICATION_REQUIRED', 'wrong issuer');
  await expectProblem(
    scopedClient.getCreditBalance(),
    403,
    'INSUFFICIENT_SCOPE',
    'missing credits:read',
  );

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
  if (jwksServer !== undefined) {
    await new Promise((resolve) => jwksServer.close(() => resolve()));
  }
  if (created) {
    swallow(() => dockerRun(['rm', '-f', CORE_CONTAINER]));
    swallow(() => dockerRun(['rm', '-f', PG_CONTAINER]));
    swallow(() => dockerRun(['volume', 'rm', PG_VOLUME]));
    swallow(() => dockerRun(['network', 'rm', NETWORK]));
  }
}

try {
  await main();
} finally {
  await cleanup();
}
