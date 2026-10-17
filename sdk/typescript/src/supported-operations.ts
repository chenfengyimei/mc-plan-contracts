/**
 * Explicit supported-operation manifest for the Core SDK.
 *
 * The SDK only exposes operations whose contract semantics are locked in
 * `openapi/core.yaml` at 0.1.0-alpha.9 AND whose producer has passed
 * contract, HTTP E2E and real-PostgreSQL integration acceptance. The first
 * twelve operations were producer-verified by MCP-F1-CORE-005, the two
 * consumer-pull event operations by MCP-F1-CORE-008, the alpha.6 public
 * profile operations (getPublicUser, updateCurrentUser) by MCP-F1-CORE-009
 * and the alpha.7 deactivation operation (deactivateCurrentUser) by
 * MCP-F1-CORE-010. The six alpha.9 admin console read-only operations
 * (ADR-0018) are producer-verified by MCP-F4-CORE-001, whose final tree (see
 * SUPPORTED_PRODUCER_COMMIT) carried the admin query producer, the apps/admin
 * web app and the Ops real-stack administrator acceptance.
 */

/** Contract prerelease version the generated types and transport are built from. */
export const SUPPORTED_CONTRACT_VERSION = '0.1.0-alpha.9' as const;

/** Contracts commit that locked the 0.1.0-alpha.9 surface (verify against docs/compatibility.md). */
export const SUPPORTED_CONTRACT_LOCK_COMMIT = '8f917bda76eaccd705a73fd35fe9a23a3903ad73' as const;

/**
 * Producer commit of mc-plan-core verified against the supported operations:
 * the MCP-F4-CORE-001 final tree, which implements the alpha.9 admin console
 * read-only face on top of the full alpha.7 business surface and re-ran the
 * producer gate suite plus the Ops real-stack administrator acceptance.
 */
export const SUPPORTED_PRODUCER_COMMIT = '06de705698f126a8eb462b828c7aaad16e992cbf' as const;

/**
 * sha256 of every contract file consumed by the type generation, relative to
 * the mc-plan-contracts repository root. Mirrors the 0.1.0-alpha.9 lock
 * manifest (the eleven admin field-closed schemas are generation inputs for
 * the exposed admin operations and are pinned here); tests recompute these
 * at run time so any contract edit that is not regenerated fails
 * `generate:check` and `test`.
 */
export const SUPPORTED_CONTRACT_FILES = {
  'openapi/core.yaml': 'fa19cd367b30823f70237b0dbc5c084bbe28c255ac82a4c8a0d2d000fe7f10bd',
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
  'schemas/core/admin-user-page.json':
    'ac69f90bcce41a2d55bc5d51ea22de96933b3e8d9f9bf4b079641f3aca029282',
  'schemas/core/admin-user-summary.json':
    'f34a438bdb39d730e328d02b250b75e2b766b2decc6506c29a1d3b9be22c1d3d',
  'schemas/core/admin-user.json':
    '70ce88bbb8412a8013b529023fbea30392be5acefded691478bec1d5d60573a0',
  'schemas/core/admin-credit-ledger-page.json':
    'ce31f080930fe57435fb2eaebc57049e0e9f3c236f571efac811439a54e26b6a',
  'schemas/core/admin-credit-ledger-entry.json':
    'ec8671f79aa90a0f95d411d2cdc562e8d50f5acc0adbb99b392846138a19bec2',
  'schemas/core/admin-entitlement-record-page.json':
    '48ba2fcd9418462a4e8ef6613aa7880f732bdf86acca28ef498338e18e444520',
  'schemas/core/admin-entitlement-record.json':
    '544a4e8ec280c48b6d5a422833c8332cde66a1f982e6667c548e2d44fa5c4660',
  'schemas/core/admin-audit-record-page.json':
    '833169cbc6487027d9f1473e1b5085e84a2b83e52c05a3b6016585cdce2ce46c',
  'schemas/core/admin-audit-record.json':
    'a7a62e3166bd70ac06a0edf3a0204282b82a3f68347a22fcbc766ede5a49fd54',
  'schemas/core/admin-outbox-record-page.json':
    'c30de8027311fe5ec46cdc89d4ebe37323610866e2b85f4b476fed34c77d8673',
  'schemas/core/admin-outbox-record.json':
    'f76475bcd975a08e6e0b4bad5636cde824bdbd0bfb3a99f9288fa45d0c60f16e',
} as const;

export type SupportedContractFile = keyof typeof SUPPORTED_CONTRACT_FILES;

/** The only operationIds this SDK exposes. getPublicUser and updateCurrentUser are exposed since MCP-F1-CORE-009; deactivateCurrentUser since MCP-F1-CORE-010 producer evidence; the six ADR-0018 admin read-only operations since MCP-F4-CORE-001 producer evidence. */
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
  'getPublicUser',
  'updateCurrentUser',
  'deactivateCurrentUser',
  'listAdminUsers',
  'getAdminUser',
  'listAdminCreditLedger',
  'listAdminEntitlementRecords',
  'listAdminAuditRecords',
  'listAdminOutboxRecords',
] as const;

export type SupportedOperation = (typeof SUPPORTED_OPERATIONS)[number];
