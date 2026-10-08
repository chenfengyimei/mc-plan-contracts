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
  it('pins exactly the 14 producer-verified operations and no others', () => {
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
    ]);
    expect(SUPPORTED_OPERATIONS).not.toContain('someFutureOperation');
    expect(SUPPORTED_CONTRACT_VERSION).toBe('0.1.0-alpha.7');
    expect(SUPPORTED_CONTRACT_LOCK_COMMIT).toBe('56bff96fe5fcad31f85943b7a557ec54148ea503');
    // Producer evidence for all sixteen supported operations comes from the
    // closed MCP-F1-CORE-009 slice (MCP-F1-CORE-008/005 before it) whose
    // final tree re-ran every gate; the alpha.7 deactivation operation is
    // not yet exposed and does not claim producer evidence here.
    expect(SUPPORTED_PRODUCER_COMMIT).toBe('7d2253999480117422aab48feb9f2602af8f444e');
  });

  it('matches the sha256 of every contract file consumed by generation', async () => {
    for (const [relativePath, expectedHash] of Object.entries(SUPPORTED_CONTRACT_FILES)) {
      const content = await readFile(path.join(contractsRoot, relativePath));
      expect(sha256(content), relativePath).toBe(expectedHash);
    }
  });
});
