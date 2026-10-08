#!/usr/bin/env node
/**
 * Real-HTTP smoke for @mc-plan/core-sdk against the fixed MCP-F1-CORE-008
 * producer image (mc-plan-core:mcp-f1-core-008-87ddd66) on an isolated
 * PostgreSQL 17.
 *
 * Not a mock transport: the SDK talks to the real running Core container.
 * A tiny local JWKS endpoint signs real RS256 OIDC/service tokens so the
 * producer's issuer/audience/scope/email_verified validation runs for real.
 * Resources (network, containers, volume) are session-unique and cleaned up
 * in finally; nothing from other sessions is touched.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
const IMAGE = 'mc-plan-core:mcp-f1-core-008-87ddd66';
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
    '-e',
    'OUTBOX_PUBLISHER_ENABLED=true',
    '-e',
    'OUTBOX_SINK=pull',
    '-e',
    'OUTBOX_DRAIN_INTERVAL_MS=250',
    // MCP-F1-CORE-007 made the Keycloak admin client fail-closed at startup:
    // the smoke never calls admin endpoints, but the four keys must be
    // present and the token URL must embed the realm (validated shape only,
    // no startup network call; admin stays out of readiness).
    '-e',
    'KEYCLOAK_ADMIN_TOKEN_URL=http://keycloak-smoke.invalid/realms/sdk-smoke/protocol/openid-connect/token',
    '-e',
    'KEYCLOAK_ADMIN_REALM=sdk-smoke',
    '-e',
    'KEYCLOAK_ADMIN_CLIENT_ID=sdk-smoke-admin',
    '-e',
    `KEYCLOAK_ADMIN_CLIENT_SECRET=local-smoke-${randomBytes(16).toString('hex')}`,
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

  // 6. Consumer-pull events surface (MCP-F1-CORE-008 producer evidence).
  const consumerAToken = await sign({
    sub: 'sdk-smoke-events-consumer-a',
    scope: 'events:consume',
  });
  const consumerBToken = await sign({
    sub: 'sdk-smoke-events-consumer-b',
    scope: 'events:consume',
  });
  const consumerA = createMcPlanCoreClient({
    baseUrl,
    getServiceToken: async () => consumerAToken,
  });
  const consumerB = createMcPlanCoreClient({
    baseUrl,
    getServiceToken: async () => consumerBToken,
  });

  // 6.1 [REAL-PRODUCER-HTTP] The real identity provisioning and entitlement
  // consumption produced flat internal events; once they reach terminal
  // PUBLISHED they must never surface on the pull API.
  await waitFor(
    'flat internal events published',
    () => {
      const published = Number(
        psql(
          "SELECT count(*) FROM outbox_records WHERE state = 'PUBLISHED' AND event_type <> 'credit.changed.v1'",
        ),
      );
      return published >= 2;
    },
    30_000,
  );
  const flatPull = await consumerA.listDeliveredEvents();
  assertEqual(flatPull.items.length, 0, 'flat internal events never surface (items empty)');
  assertEqual(flatPull.next_cursor, null, 'flat internal events never surface (null cursor)');

  // 6.2 [SYNTHETIC-DB-SEED] Two locked-valid credit.changed.v1 envelopes are
  // seeded straight into outbox_records (no public credit API produces
  // credit.changed.v1; the publisher structurally validates and publishes
  // them). This mirrors the labeled Ops acceptance seed, honestly attributed.
  const eventsUserId = me.user_id;
  const seedEnvelope = (seed) =>
    JSON.stringify({
      event_id: seed.eventId,
      type: 'credit.changed.v1',
      occurred_at: '2026-10-07T12:00:00.000Z',
      producer: 'mc-plan-core',
      subject: eventsUserId,
      correlation_id: null,
      schema_version: 1,
      data: {
        entry_id: seed.entryId,
        user_id: eventsUserId,
        kind: 'grant',
        amount: seed.amount,
        balance_before: seed.balanceBefore,
        balance_after: seed.balanceAfter,
        source: 'internal.test',
        reference_id: null,
        created_at: '2026-10-07T12:00:00.000Z',
      },
    });
  const seededEnvelopes = [
    {
      eventId: randomUUID(),
      entryId: randomUUID(),
      amount: 5,
      balanceBefore: 0,
      balanceAfter: 5,
    },
    {
      eventId: randomUUID(),
      entryId: randomUUID(),
      amount: 3,
      balanceBefore: 5,
      balanceAfter: 8,
    },
  ];
  for (const seed of seededEnvelopes) {
    const payload = seedEnvelope(seed).replace(/'/g, "''");
    psql(
      `insert into outbox_records (id, user_id, event_type, visibility, state, payload) values (gen_random_uuid(), '${eventsUserId}'::uuid, 'credit.changed.v1', 'INTERNAL', 'PENDING', '${payload}'::jsonb)`,
    );
  }
  await waitFor(
    'seeded envelopes published',
    () => {
      const published = Number(
        psql(
          "SELECT count(*) FROM outbox_records WHERE state = 'PUBLISHED' AND event_type = 'credit.changed.v1'",
        ),
      );
      return published >= 2;
    },
    30_000,
  );

  // 6.3 [REAL-PRODUCER-HTTP] Consumer A pulls the seeded envelopes in publish
  // order and processes them with a durable, file-backed event_id registry.
  // The first pass deliberately crashes BEFORE acknowledging; the rebuilt
  // consumer re-pulls the real redelivery, the durable registry prevents
  // duplicate side effects, and only then does A acknowledge and converge.
  const registryDir = mkdtempSync(path.join(tmpdir(), 'mcp-c004-dedup-'));
  const registryFile = path.join(registryDir, 'processed-events.json');
  const readRegistry = () => {
    try {
      return new Set(JSON.parse(readFileSync(registryFile, 'utf8')));
    } catch {
      return new Set();
    }
  };
  const writeRegistry = (processed) => writeFileSync(registryFile, JSON.stringify([...processed]));
  async function consumePageDurably(consumer) {
    const page = await consumer.listDeliveredEvents({ limit: 50 });
    const processed = readRegistry();
    let applied = 0;
    for (const event of page.items) {
      if (processed.has(event.event_id)) {
        continue;
      }
      processed.add(event.event_id);
      applied += 1;
    }
    writeRegistry(processed);
    return { pulled: page.items.length, applied, cursorToken: page.next_cursor };
  }
  const firstPass = await consumePageDurably(consumerA);
  assertEqual(firstPass.pulled, 2, 'consumer A first pull sees both seeded envelopes');
  assertEqual(firstPass.applied, 2, 'first processing pass applies both side effects');
  assert(firstPass.cursorToken !== null, 'unacknowledged pull returns a cursor');
  // CRASH before ack; the rebuilt consumer simulates a restart with the same
  // durable registry and re-pulls the unacknowledged page.
  const secondPass = await consumePageDurably(consumerA);
  assertEqual(secondPass.pulled, 2, 'unacknowledged events are really redelivered (at-least-once)');
  assertEqual(secondPass.applied, 0, 'durable dedup prevents duplicate side effects');
  assertEqual(secondPass.cursorToken, firstPass.cursorToken, 'redelivery returns the same cursor');
  const ackA = await consumerA.acknowledgeEvents({ cursor: secondPass.cursorToken });
  assert(
    typeof ackA.cursor === 'string' && ackA.cursor.length > 0,
    'acknowledgment returns a cursor',
  );

  // 6.4 Caught up: empty items and null cursor.
  const caughtUpA = await consumerA.listDeliveredEvents();
  assertEqual(caughtUpA.items.length, 0, 'consumer A caught up (no items)');
  assertEqual(caughtUpA.next_cursor, null, 'consumer A caught up (null cursor)');

  // 6.5 Idempotent re-acknowledgment returns the current position.
  const repeatAck = await consumerA.acknowledgeEvents({ cursor: secondPass.cursorToken });
  assertEqual(repeatAck.cursor, ackA.cursor, 're-acknowledging the same cursor is idempotent');

  // 6.6 A/B isolation: B still sees both events after A acknowledged; B
  // acknowledges independently and catches up.
  const pageB = await consumerB.listDeliveredEvents();
  assertEqual(pageB.items.length, 2, 'consumer B still sees both events after A acked');
  assertEqual(
    pageB.items[0].event_id,
    seededEnvelopes[0].eventId,
    'publish order preserved for consumer B',
  );
  assertEqual(
    pageB.items[1].event_id,
    seededEnvelopes[1].eventId,
    'publish order preserved for consumer B',
  );
  await consumerB.acknowledgeEvents({ cursor: pageB.next_cursor });
  const caughtUpB = await consumerB.listDeliveredEvents();
  assertEqual(caughtUpB.items.length, 0, 'consumer B caught up after its own ack');

  // 6.7 Negatives: A's cursor presented by B, and a malformed cursor.
  await expectProblem(
    consumerB.acknowledgeEvents({ cursor: secondPass.cursorToken }),
    400,
    'VALIDATION_FAILED',
    'consumer A cursor presented by consumer B',
  );
  await expectProblem(
    consumerA.acknowledgeEvents({ cursor: 'not-a-cursor' }),
    400,
    'VALIDATION_FAILED',
    'malformed cursor',
  );

  // 6.8 Scope and issuer boundaries: credits:consume-only service token and
  // a user OIDC token both lack events:consume (403); a wrong-issuer service
  // token is rejected before scopes are considered (401).
  const creditsOnlyClient = createMcPlanCoreClient({
    baseUrl,
    getServiceToken: async () => serviceToken,
  });
  await expectProblem(
    creditsOnlyClient.listDeliveredEvents(),
    403,
    'INSUFFICIENT_SCOPE',
    'credits:consume-only service token lacks events:consume',
  );
  const userAsServiceClient = createMcPlanCoreClient({
    baseUrl,
    getServiceToken: async () => userToken,
  });
  await expectProblem(
    userAsServiceClient.listDeliveredEvents(),
    403,
    'INSUFFICIENT_SCOPE',
    'user OIDC token never carries events:consume',
  );
  const wrongIssuerServiceClient = createMcPlanCoreClient({
    baseUrl,
    getServiceToken: async () => wrongIssuerToken,
  });
  await expectProblem(
    wrongIssuerServiceClient.listDeliveredEvents(),
    401,
    'AUTHENTICATION_REQUIRED',
    'wrong-issuer service token',
  );

  rmSync(registryDir, { recursive: true, force: true });
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
