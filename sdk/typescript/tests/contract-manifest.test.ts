import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  SUPPORTED_CONTRACT_FILES,
  SUPPORTED_CONTRACT_LOCK_COMMIT,
  SUPPORTED_CONTRACT_VERSION,
  SUPPORTED_OPERATIONS,
  SUPPORTED_PRODUCER_COMMIT,
} from '../src/supported-operations.js';

const contractsRoot = path.resolve(__dirname, '../../../');

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('supported contract manifest', () => {
  it('pins exactly the 23 producer-verified operations and no others', () => {
    expect([...SUPPORTED_OPERATIONS]).toEqual([
      'getCurrentUser',
      'createDeveloperApp',
      'listDeveloperApps',
      'getDeveloperApp',
      'approveDeveloperAppScopes',
      'revokeDeveloperApp',
      'createPersonalAccessToken',
      'listPersonalAccessTokens',
      'revokePersonalAccessToken',
      'listCurrentEntitlements',
      'consumeCredits',
      'getCreditBalance',
      'listDeliveredEvents',
      'acknowledgeEvents',
      'getPublicUser',
      'updateCurrentUser',
      'deactivateCurrentUser',
      'listAdminUsers',
      'getAdminUser',
      'listAdminCreditLedger',
      'listAdminEntitlementRecords',
      'listAdminAuditRecords',
      'listAdminOutboxRecords',
    ]);
    expect(SUPPORTED_OPERATIONS).not.toContain('someFutureOperation');
    // Admin write operations stay unexposed until separately producer-verified
    // (owner 2026-10-17 first batch: createAdminCreditAdjustment awaits the
    // future producer slice; later batches are owner-gated).
    for (const unexposed of [
      'createAdminCreditAdjustment',
      'revokeAdminPersonalAccessToken',
      'revokeAdminDeveloperApp',
      'setAdminUserStatus',
    ]) {
      expect(SUPPORTED_OPERATIONS).not.toContain(unexposed);
    }
    expect(SUPPORTED_CONTRACT_VERSION).toBe('0.1.0-alpha.10');
    expect(SUPPORTED_CONTRACT_LOCK_COMMIT).toBe('8f917bda76eaccd705a73fd35fe9a23a3903ad73');
    // Producer evidence for the seventeen business operations comes from the
    // MCP-F1-CORE-005/008/009/010 slices; the six admin read-only operations
    // come from MCP-F4-CORE-001 whose final tree re-ran the producer gates
    // plus the Ops real-stack administrator acceptance. The alpha.10 write
    // face has NO producer evidence yet and stays unexposed.
    expect(SUPPORTED_PRODUCER_COMMIT).toBe('06de705698f126a8eb462b828c7aaad16e992cbf');
    expect(Object.keys(SUPPORTED_CONTRACT_FILES)).toHaveLength(24);
  });

  it('matches the sha256 of every contract file consumed by generation', async () => {
    for (const [relativePath, expectedHash] of Object.entries(SUPPORTED_CONTRACT_FILES)) {
      const content = await readFile(path.join(contractsRoot, relativePath));
      expect(sha256(content), relativePath).toBe(expectedHash);
    }
  });
});
