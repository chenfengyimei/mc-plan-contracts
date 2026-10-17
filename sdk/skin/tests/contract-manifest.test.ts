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
  it('pins exactly the 8 producer-verified operations and no others', () => {
    expect([...SUPPORTED_OPERATIONS]).toEqual([
      'createConversation',
      'createRender',
      'finalizeSkin',
      'getJob',
      'getConversation',
      'deleteConversation',
      'getCandidatePreview',
      'downloadSkin',
    ]);
    expect(SUPPORTED_OPERATIONS).not.toContain('someFutureOperation');
    // Official-mode or F3 surfaces stay unexposed until separately contracted
    // and producer-verified (Q-001/Q-011/Q-012 owner-gated).
    for (const unexposed of ['publishToCommunity', 'consumeOfficialEntitlement']) {
      expect(SUPPORTED_OPERATIONS).not.toContain(unexposed);
    }
    expect(SUPPORTED_CONTRACT_VERSION).toBe('0.1.0-alpha.1');
    expect(SUPPORTED_CONTRACT_LOCK_COMMIT).toBe('30064022daa61795b9a1945af2d23a0ce88d04dd');
    // Producer evidence for all eight operations comes from the closed
    // MCP-F1-SKIN-008/009 slices whose final tree implements the full
    // anonymous-window surface (four original creation-flow operations plus
    // the alpha.1 public endpoints) and re-ran every producer gate.
    expect(SUPPORTED_PRODUCER_COMMIT).toBe('14a8fe3d24ecb68b02cc8ab765f57b6103893e76');
    expect(Object.keys(SUPPORTED_CONTRACT_FILES)).toHaveLength(2);
  });

  it('matches the sha256 of every contract file consumed by generation', async () => {
    for (const [relativePath, expectedHash] of Object.entries(SUPPORTED_CONTRACT_FILES)) {
      const content = await readFile(path.join(contractsRoot, relativePath));
      expect(sha256(content), relativePath).toBe(expectedHash);
    }
  });
});
