#!/usr/bin/env node
/**
 * Local pack + clean-project consumption check.
 *
 * 1. `pnpm pack` the SDK into a session temp directory.
 * 2. Create a brand-new consumer project there that depends on the tarball
 *    via a `file:` link (still a real packed artifact with only `dist/`).
 * 3. Install and compile a sample that imports the SDK exactly the way a
 *    downstream Standalone site would, then fail unless `tsc --strict` is
 *    green. Nothing is published to any registry.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const pnpm = process.env.npm_execpath;
if (typeof pnpm !== 'string' || pnpm.length === 0) {
  throw new Error('pack-check must run through pnpm (npm_execpath missing)');
}

/**
 * npm_execpath may point at a .mjs/.cjs CLI entry that is not directly
 * executable; in that case the entry runs through the current node binary.
 */
function runPnpm(args, options = {}) {
  if (pnpm.endsWith('.mjs') || pnpm.endsWith('.cjs')) {
    return execFileSync(process.execPath, [pnpm, ...args], options);
  }
  return execFileSync(pnpm, args, options);
}

const sdkRoot = process.cwd();
const workspace = mkdtempSync(path.join(tmpdir(), 'mc-skin-sdk-pack-check-'));

try {
  runPnpm(['pack', '--pack-destination', workspace], {
    cwd: sdkRoot,
    stdio: 'inherit',
  });

  const { version } = JSON.parse(readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'));
  const tarballName = `mc-plan-skin-sdk-${version}.tgz`;
  const tarball = path.join(workspace, tarballName);

  const consumer = path.join(workspace, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'mc-skin-sdk-pack-consumer-check',
        private: true,
        type: 'module',
        dependencies: {
          '@mc-plan/skin-sdk': `file:${tarball}`,
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

  runPnpm(['install', '--offline'], { cwd: consumer, stdio: 'inherit' });

  writeFileSync(
    path.join(consumer, 'sample.ts'),
    [
      "import { createMcPlanSkinClient, generateIdempotencyKey, SUPPORTED_OPERATIONS, type Conversation, type Job, type SkinPng } from '@mc-plan/skin-sdk';",
      '',
      "const client = createMcPlanSkinClient({ baseUrl: 'https://skin-api.example.invalid' });",
      '',
      'export async function startConversation(): Promise<Conversation> {',
      "  return client.createConversation({ initial_message: 'a snow explorer' }, generateIdempotencyKey());",
      '}',
      '',
      'export async function pollRender(conversationId: string): Promise<Job> {',
      "  const accepted = await client.createRender(conversationId, { message: 'cooler tones' }, generateIdempotencyKey());",
      '  return client.getJob(accepted.job_id);',
      '}',
      '',
      'export async function fetchPreview(conversationId: string, candidateId: string): Promise<SkinPng> {',
      '  return client.getCandidatePreview(conversationId, candidateId);',
      '}',
      '',
      'export async function removeConversation(conversationId: string): Promise<void> {',
      '  return client.deleteConversation(conversationId);',
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
