/**
 * Explicit supported-operation manifest for the Core SDK.
 *
 * The SDK only exposes operations whose contract semantics are locked in
 * `openapi/core.yaml` at 0.1.0-alpha.4 AND whose producer (mc-plan-core
 * 5508d60, verified by MCP-F1-CORE-005) has passed contract, HTTP E2E and
 * real-PostgreSQL integration acceptance. Operations without producer
 * evidence (for example getPublicUser) must not gain callable client
 * methods, and future surfaces must not be pre-invented here.
 */

/** Contract prerelease version the generated types and transport are built from. */
export const SUPPORTED_CONTRACT_VERSION = '0.1.0-alpha.4' as const;

/** Contracts commit that locked the 0.1.0-alpha.4 surface (verify against docs/compatibility.md). */
export const SUPPORTED_CONTRACT_LOCK_COMMIT = '9a85b989a87dc9e809f956770ebd7a60e1c8e664' as const;

/** Producer commit of mc-plan-core verified against the locked surface. */
export const SUPPORTED_PRODUCER_COMMIT = '5508d607628910a4f72c496e8340e526badcb9df' as const;

/**
 * sha256 of every contract file consumed by the type generation, relative to
 * the mc-plan-contracts repository root. Mirrors the 0.1.0-alpha.4 lock
 * manifest; tests recompute these at run time so any contract edit that is
 * not regenerated fails `generate:check` and `test`.
 */
export const SUPPORTED_CONTRACT_FILES = {
  'openapi/core.yaml': '3c5bb825ad9290279241296e1e1fba78a00f7c6050b497f1b7f0802d31ec6978',
  'schemas/common/actor.json': 'f1b371a741eb374f7bf8364398669a42a3b5e0031679af532320a10b17a04432',
  'schemas/common/problem.json': '80d6abfca67ccac9e22d83542134755c6126cae2696afbaa4c85efaceec4ba11',
  'schemas/core/entitlement.json':
    'a7f36fe5686998e4d9f19adca2b30c91eee4f3faa3e95804fab09ad17acc7e08',
  'schemas/core/credit-balance.json':
    '808b2c0df6edb576db46e00a321526f7eb20a88dbef285e8dda477bb158ea0db',
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

/** The only operationIds this SDK exposes. getPublicUser is intentionally absent. */
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
] as const;

export type SupportedOperation = (typeof SUPPORTED_OPERATIONS)[number];
