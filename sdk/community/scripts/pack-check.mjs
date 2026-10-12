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
const workspace = mkdtempSync(path.join(tmpdir(), 'mc-community-sdk-pack-check-'));

try {
  runPnpm(['pack', '--pack-destination', workspace], {
    cwd: sdkRoot,
    stdio: 'inherit',
  });

  const { version } = JSON.parse(readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'));
  const tarballName = `mc-plan-community-sdk-${version}.tgz`;
  const tarball = path.join(workspace, tarballName);

  const consumer = path.join(workspace, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'mc-community-sdk-pack-consumer-check',
        private: true,
        type: 'module',
        dependencies: {
          '@mc-plan/community-sdk': `file:${tarball}`,
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
      'import {',
      '  createMcPlanCommunityClient,',
      '  SUPPORTED_OPERATIONS,',
      '  generateIdempotencyKey,',
      '  type CommunityResource,',
      '  type ResourcePage,',
      '  type UploadSession,',
      '  type CompletedUpload,',
      '  type ResourceVersion,',
      '  type ResourceDetail,',
      '  type DownloadedVersionFile,',
      "} from '@mc-plan/community-sdk';",
      '',
      'const client = createMcPlanCommunityClient({',
      "  baseUrl: 'https://community.example.invalid',",
      '  getUserToken: async () => process.env.COMMUNITY_USER_TOKEN ?? null,',
      '});',
      '',
      'export async function createResourceContainer(): Promise<CommunityResource> {',
      '  return client.createResource(',
      "    { type: 'skin', title: 'Demo skin', description: 'Made with the SDK' },",
      '    generateIdempotencyKey(),',
      '  );',
      '}',
      '',
      'export async function startUpload(sizeBytes: number, sha256: string): Promise<UploadSession> {',
      '  return client.createUploadSession(',
      "    { purpose: 'resource_primary', media_type: 'image/png', size_bytes: sizeBytes, sha256 },",
      '    generateIdempotencyKey(),',
      '  );',
      '}',
      '',
      'export async function completeUpload(uploadId: string): Promise<CompletedUpload> {',
      '  return client.completeUploadSession(uploadId, generateIdempotencyKey());',
      '}',
      '',
      'export async function attachVersion(',
      '  resourceId: string,',
      '  uploadId: string,',
      '  licenseId: string,',
      '): Promise<ResourceVersion> {',
      '  return client.createResourceVersion(',
      '    resourceId,',
      '    {',
      '      upload_id: uploadId,',
      "      version: '1',",
      '      schema_version: 1,',
      '      metadata: { edition: "java", width: 64, height: 64, arm_model: "steve", second_layer: true },',
      `      license_id: licenseId,`,
      '    },',
      '    generateIdempotencyKey(),',
      '  );',
      '}',
      '',
      'export async function requestPublication(resourceId: string): Promise<CommunityResource> {',
      '  return client.publishResource(resourceId, generateIdempotencyKey());',
      '}',
      '',
      'export async function unpublish(resourceId: string): Promise<void> {',
      '  return client.unpublishResource(resourceId, generateIdempotencyKey());',
      '}',
      '',
      'export async function readResource(resourceId: string): Promise<ResourceDetail> {',
      '  return client.getResource(resourceId);',
      '}',
      '',
      'export async function listPublished(pageSize?: number): Promise<ResourcePage> {',
      '  return client.listResources(pageSize === undefined ? {} : { limit: pageSize });',
      '}',
      '',
      'export async function listByAuthor(userId: string): Promise<ResourcePage> {',
      '  return client.listAuthorResources(userId, { limit: 20 });',
      '}',
      '',
      'export async function downloadVersion(',
      '  resourceId: string,',
      '  versionId: string,',
      '): Promise<DownloadedVersionFile> {',
      '  return client.downloadResourceVersion(resourceId, versionId);',
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
