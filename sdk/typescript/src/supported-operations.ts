/**
 * Explicit supported-operation manifest for the Core SDK.
 *
 * The SDK only exposes operations whose contract semantics are locked in
 * `openapi/core.yaml` at 0.1.0-alpha.6 AND whose producer has passed
 * contract, HTTP E2E and real-PostgreSQL integration acceptance. The first
 * twelve operations were producer-verified by MCP-F1-CORE-005, the two
 * consumer-pull event operations by MCP-F1-CORE-008, and the alpha.6
 * additions (getPublicUser, updateCurrentUser) are locked but carry no
 * producer evidence yet, so they must not gain callable client methods
 * until the producing slice closes. Future surfaces must not be
 * pre-invented here.
 */

/** Contract prerelease version the generated types and transport are built from. */
export const SUPPORTED_CONTRACT_VERSION = '0.1.0-alpha.6' as const;

/** Contracts commit that locked the 0.1.0-alpha.6 surface (verify against docs/compatibility.md). */
export const SUPPORTED_CONTRACT_LOCK_COMMIT = '6b80c4cf78053fb953452f50cb08c15272176759' as const;

/** Producer commit of mc-plan-core verified against the supported operations. */
export const SUPPORTED_PRODUCER_COMMIT = '87ddd66f24a9044ebcebd2d4043511fd5796029d' as const;

/**
 * sha256 of every contract file consumed by the type generation, relative to
 * the mc-plan-contracts repository root. Mirrors the 0.1.0-alpha.6 lock
 * manifest; tests recompute these at run time so any contract edit that is
 * not regenerated fails `generate:check` and `test`.
 */
export const SUPPORTED_CONTRACT_FILES = {
  'openapi/core.yaml': 'e45f258a91487ac046b8516436b6dab0e7dffeb5c1646491c15b5685505a71a1',
  'schemas/common/actor.json': 'f1b371a741eb374f7bf8364398669a42a3b5e0031679af532320a10b17a04432',
  'schemas/common/problem.json': '80d6abfca67ccac9e22d83542134755c6126cae2696afbaa4c85efaceec4ba11',
  'schemas/common/event-envelope.json':
    '1896b881aced04a885748b085d590e6cca1391cc7d2b40140b9366f174e18ff2',
  'schemas/core/entitlement.json':
    'a7f36fe5686998e4d9f19adca2b30c91eee4f3faa3e95804fab09ad17acc7e08',
  'schemas/core/credit-balance.json':
    '808b2c0df6edb576db46e00a321526f7eb20a88dbef285e8dda477bb158ea0db',
  'schemas/core/event-page.json':
    '3ce2378e230153d1a18e3fb92ca530f32bb2dd4170332cfb3ab1560f56ae3f5d',
  'schemas/core/event-acknowledgment.json':
    'af06fc1221a4120117c6be9987024190f30edf05e0e6b99bf02eb0fb7f397249',
  'schemas/core/developer-app.json':
    '4c304b5d470e343184335b069a23980b21ef5b6f80ca8bdfb9cb7b9be0534da1',
  'schemas/core/developer-app-created.json':
    '9d9e3eabce9b46009a37620e884b37c51db60103bb5992387368ae0eaf2f0e24',
  'schemas/core/personal-access-token.json':
    'a00791a0c802b5937a537d8a6f016bbe74c6118fe28c71a8e56957a858d5b3d9',
  'schemas/core/personal-access-token-created.json':
    'd8195b025c2db0f2c09fd6105f67957c1e7a19bfb28de5cd13acfe8becdd8259',
} as const;

export type SupportedContractFile = keyof typeof SUPPORTED_CONTRACT_FILES;

/** The only operationIds this SDK exposes. getPublicUser/updateCurrentUser are intentionally absent (no producer evidence yet). */
export const SUPPORTED_OPERATIONS = [
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
] as const;

export type SupportedOperation = (typeof SUPPORTED_OPERATIONS)[number];
