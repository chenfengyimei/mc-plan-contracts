#!/usr/bin/env node
/**
 * Local pack + clean-project consumption check.
 *
 * 1. `pnpm pack` the SDK into a session temp directory.
 * 2. Create a brand-new consumer project there that depends on the tarball
 *    via a `file:` link (still a real packed artifact with only `dist/`).
 * 3. Install and compile a sample that imports the SDK exactly the way a
 *    downstream website would, then fail unless `tsc --strict` is green.
 * Nothing is published to any registry.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const pnpm = process.env.npm_execpath;
if (typeof pnpm !== 'string' || pnpm.length === 0) {
  throw new Error('pack-check must run through pnpm (npm_execpath missing)');
}

const sdkRoot = process.cwd();
const workspace = mkdtempSync(path.join(tmpdir(), 'mc-sdk-pack-check-'));

try {
  execFileSync(pnpm, ['pack', '--pack-destination', workspace], {
    cwd: sdkRoot,
    stdio: 'inherit',
  });

  const tarballName = 'mc-plan-core-sdk-0.1.0-alpha.4.tgz';
  const tarball = path.join(workspace, tarballName);

  const consumer = path.join(workspace, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'mc-sdk-pack-consumer-check',
        private: true,
        type: 'module',
        dependencies: {
          '@mc-plan/core-sdk': `file:${tarball}`,
        },
        devDependencies: {
          typescript: '5.9.3',
          '@types/node': '24.19.0',
        },
      },
      null,
      2,
    ) + '\n',
  );

  execFileSync(pnpm, ['install', '--offline'], { cwd: consumer, stdio: 'inherit' });

  writeFileSync(
    path.join(consumer, 'sample.ts'),
    [
      "import { createMcPlanCoreClient, SUPPORTED_OPERATIONS, type PublicActor, type ConsumptionResult } from '@mc-plan/core-sdk';",
      '',
      'const client = createMcPlanCoreClient({',
      "  baseUrl: 'https://core.example.invalid',",
      '  getUserToken: async () => process.env.CORE_USER_TOKEN ?? null,',
      '  getServiceToken: async () => process.env.CORE_SERVICE_TOKEN ?? null,',
      '});',
      '',
      'export async function showProfile(): Promise<PublicActor> {',
      '  return client.getCurrentUser();',
      '}',
      '',
      'export async function consumeOnce(',
      '  userId: string,',
      '  key: string,',
      '): Promise<ConsumptionResult> {',
      '  const call = await client.consumeCredits(',
      "    { user_id: userId, module: 'skin', operation: 'creation_session', units: 1, reference_id: 'demo' },",
      '    key,',
      '  );',
      '  return call.data;',
      '}',
      '',
      'export const operationCount: number = SUPPORTED_OPERATIONS.length;',
      '',
    ].join('\n'),
  );

  execFileSync(
    path.join(consumer, 'node_modules', '.bin', 'tsc'),
    [
      '--noEmit',
      '--strict',
      '--exactOptionalPropertyTypes',
      '--noUncheckedIndexedAccess',
      '--module',
      'nodenext',
      '--moduleResolution',
      'nodenext',
      '--target',
      'es2022',
      '--lib',
      'es2022',
      '--types',
      'node',
      'sample.ts',
    ],
    { cwd: consumer, stdio: 'inherit' },
  );

  console.log('[pack-check] clean consumer compiled against the packed tarball ✔');
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
