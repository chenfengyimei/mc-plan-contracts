import { randomUUID } from 'node:crypto';

/**
 * Idempotency-Key helpers. The contract locks the header at 8..200 characters
 * for the mutations that declare it. Keys are caller-owned: the SDK never
 * rotates a key on retry and never persists keys.
 */

export const IDEMPOTENCY_KEY_MIN_LENGTH = 8 as const;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 200 as const;

export function validateIdempotencyKey(key: string): string {
  if (key.length < IDEMPOTENCY_KEY_MIN_LENGTH || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    throw new RangeError(
      `Idempotency-Key must be ${IDEMPOTENCY_KEY_MIN_LENGTH}..${IDEMPOTENCY_KEY_MAX_LENGTH} characters (got ${key.length})`,
    );
  }
  return key;
}

/**
 * Generate a fresh opaque idempotency key (UUID-based, 49 characters). The
 * caller decides scope and lifetime; the SDK neither stores it nor reuses it
 * across different logical commands.
 */
export function generateIdempotencyKey(): string {
  const key = `mcp_sdk_${randomUUID()}`;
  return validateIdempotencyKey(key);
}
