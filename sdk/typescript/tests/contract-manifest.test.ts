import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  SUPPORTED_CONTRACT_FILES,
  SUPPORTED_CONTRACT_LOCK_COMMIT,
  SUPPORTED_CONTRACT_VERSION,
  SUPPORTED_OPERATIONS,
} from '../src/supported-operations.js';

const contractsRoot = path.resolve(__dirname, '../../../');

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe('supported contract manifest', () => {
  it('pins exactly the 12 producer-verified operations and no others', () => {
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
    ]);
    expect(SUPPORTED_OPERATIONS).not.toContain('getPublicUser');
    expect(SUPPORTED_OPERATIONS).not.toContain('listDeliveredEvents');
    expect(SUPPORTED_OPERATIONS).not.toContain('acknowledgeEvents');
    expect(SUPPORTED_CONTRACT_VERSION).toBe('0.1.0-alpha.5');
    expect(SUPPORTED_CONTRACT_LOCK_COMMIT).toBe('5ba7172427f719eca2af44a0ef5d43b9871551e5');
  });

  it('matches the sha256 of every contract file consumed by generation', async () => {
    for (const [relativePath, expectedHash] of Object.entries(SUPPORTED_CONTRACT_FILES)) {
      const content = await readFile(path.join(contractsRoot, relativePath));
      expect(sha256(content), relativePath).toBe(expectedHash);
    }
  });
});
