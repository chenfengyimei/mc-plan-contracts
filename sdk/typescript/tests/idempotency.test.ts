import { describe, expect, it } from 'vitest';

import {
  generateIdempotencyKey,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  IDEMPOTENCY_KEY_MIN_LENGTH,
  validateIdempotencyKey,
} from '../src/idempotency.js';

describe('idempotency keys', () => {
  it('generates unique keys inside the locked 8..200 range', () => {
    const keys = new Set<string>();
    for (let index = 0; index < 100; index += 1) {
      const key = generateIdempotencyKey();
      expect(key.length).toBeGreaterThanOrEqual(IDEMPOTENCY_KEY_MIN_LENGTH);
      expect(key.length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX_LENGTH);
      keys.add(key);
    }
    expect(keys.size).toBe(100);
  });

  it('validates boundary lengths exactly as the contract locks them', () => {
    expect(validateIdempotencyKey('a'.repeat(8))).toBe('a'.repeat(8));
    expect(validateIdempotencyKey('a'.repeat(200))).toBe('a'.repeat(200));
    expect(() => validateIdempotencyKey('a'.repeat(7))).toThrow(RangeError);
    expect(() => validateIdempotencyKey('a'.repeat(201))).toThrow(RangeError);
    expect(() => validateIdempotencyKey('')).toThrow(RangeError);
  });
});
