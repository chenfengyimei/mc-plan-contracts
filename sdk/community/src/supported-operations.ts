/**
 * Explicit supported-operation manifest for the Community SDK.
 *
 * The SDK only exposes operations whose contract semantics are locked in
 * `openapi/community.yaml` at 0.1.0-alpha.2 AND whose producer passed the
 * MCP-F2-COMMUNITY-001 acceptance (13 unit, 2 locked-contract and 30
 * integration tests including real PostgreSQL/S3-protocol flows, real
 * Keycloak 26.8 PKCE and the runtime image smoke on
 * mc-plan-community:mcp-f2-community-001-779803e). All ten locked operations
 * carry producer evidence; operations without evidence must not gain
 * callable client methods, and future surfaces must not be pre-invented here.
 */

/** Contract prerelease version the generated types and transport are built from. */
export const SUPPORTED_CONTRACT_VERSION = '0.1.0-alpha.2' as const;

/** Contracts commit that locked the 0.1.0-alpha.2 surface (verify against docs/compatibility.md). */
export const SUPPORTED_CONTRACT_LOCK_COMMIT = '68b3d42065bbfcee30545a02780a7eb8f931bc1f' as const;

/**
 * Producer commit of mc-plan-community verified against the supported
 * operations: the MCP-F2-COMMUNITY-001 final tree, which implements all ten
 * alpha.2 operations and passed the full producer gate suite plus the
 * canonical runtime image acceptance.
 */
export const SUPPORTED_PRODUCER_COMMIT = '70e55a1375e8afe6e26451d861d819996d698c58' as const;

/**
 * sha256 of every contract file consumed by the type generation, relative to
 * the mc-plan-contracts repository root. Mirrors the alpha.2 lock manifest;
 * tests recompute these at run time so any contract edit that is not
 * regenerated fails `generate:check` and `test`.
 */
export const SUPPORTED_CONTRACT_FILES = {
  'openapi/community.yaml': '7ce8961f0563a932a9c85005c9d655633e574c0dc44250beb009d78cbe4fe0db',
  'schemas/common/problem.json': '80d6abfca67ccac9e22d83542134755c6126cae2696afbaa4c85efaceec4ba11',
  'schemas/community/resource.json':
    '81d49f8bc90fcbc210a87784eff48446b81f134b460df91a80ad56876f931cf9',
  'schemas/community/resource-version.json':
    '7ee0349c60c912b75e26f7349d0d924840d127a914f7f05d46d6516167e6dc8a',
  'schemas/community/resource-file.json':
    '03492393b593a50642b2b29bf74f055dda970d0da8495db5c3014aca78003f07',
  'schemas/community/license-snapshot.json':
    '4e138d464f7b728213ed32983e6db4d32f9d78334c88b6042fcd2ea65a4c6d12',
  'schemas/skin/skin-metadata.json':
    'b051b01ae11411e65442f3fbf0d89cb85aa4373915a317d62dfb47cf84bf6f3a',
} as const;

export type SupportedContractFile = keyof typeof SUPPORTED_CONTRACT_FILES;

/**
 * The only operationIds this SDK exposes. Every one of the ten locked alpha.2
 * operations is producer-verified by MCP-F2-COMMUNITY-001 (HTTP integration
 * coverage plus the runtime image smoke); none is excluded.
 */
export const SUPPORTED_OPERATIONS = [
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
] as const;

export type SupportedOperation = (typeof SUPPORTED_OPERATIONS)[number];
