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
    ]);
    expect(SUPPORTED_OPERATIONS).not.toContain('getPublicUser');
    expect(SUPPORTED_OPERATIONS).not.toContain('updateCurrentUser');
    expect(SUPPORTED_CONTRACT_VERSION).toBe('0.1.0-alpha.6');
    expect(SUPPORTED_CONTRACT_LOCK_COMMIT).toBe('6b80c4cf78053fb953452f50cb08c15272176759');
    // Producer evidence for the two event operations comes from the closed
    // MCP-F1-CORE-008 slice whose final tree re-ran every gate.
    expect(SUPPORTED_PRODUCER_COMMIT).toBe('87ddd66f24a9044ebcebd2d4043511fd5796029d');
  });

  it('matches the sha256 of every contract file consumed by generation', async () => {
    for (const [relativePath, expectedHash] of Object.entries(SUPPORTED_CONTRACT_FILES)) {
      const content = await readFile(path.join(contractsRoot, relativePath));
      expect(sha256(content), relativePath).toBe(expectedHash);
    }
  });
});
