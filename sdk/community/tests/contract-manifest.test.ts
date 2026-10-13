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
  it('pins exactly the 12 producer-verified operations and no others', () => {
    expect([...SUPPORTED_OPERATIONS]).toEqual([
      'createUploadSession',
      'completeUploadSession',
      'createResource',
      'createResourceVersion',
      'publishResource',
      'unpublishResource',
      'getResource',
      'listResources',
      'listAuthorResources',
      'downloadResourceVersion',
      'previewResourceVersion',
      'reviewResourceVersion',
    ]);
    expect(SUPPORTED_OPERATIONS).not.toContain('someFutureOperation');
    expect(SUPPORTED_CONTRACT_VERSION).toBe('0.1.0-alpha.4');
    expect(SUPPORTED_CONTRACT_LOCK_COMMIT).toBe('f52859c16bde93dfa054e307201c6b5c2e778461');
    expect(SUPPORTED_PRODUCER_COMMIT).toBe('d482331a874b73b313601a58f1d83c3d11f03fe7');
  });

  it('matches the sha256 of every contract file consumed by generation', async () => {
    for (const [relativePath, expectedHash] of Object.entries(SUPPORTED_CONTRACT_FILES)) {
      const content = await readFile(path.join(contractsRoot, relativePath));
      expect(sha256(content), relativePath).toBe(expectedHash);
    }
  });
});
