/** MCP-F2-COMMUNITY-002: producer-verified manual review and inline preview; no future methods. */
export const SUPPORTED_CONTRACT_VERSION = '0.1.0-alpha.4' as const;
export const SUPPORTED_CONTRACT_LOCK_COMMIT = 'f52859c16bde93dfa054e307201c6b5c2e778461' as const;
export const SUPPORTED_PRODUCER_COMMIT = 'c1cdab0ee0d76d2f682f178d4f0a5d5e0a2a42e5' as const;
export const SUPPORTED_CONTRACT_FILES = {
  'openapi/community.yaml': 'e1ad262e342c853cd632e889f33357ad2a7438acd01e9fbc2f7acabf21ab044e',
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
  'previewResourceVersion',
  'reviewResourceVersion',
] as const;
export type SupportedOperation = (typeof SUPPORTED_OPERATIONS)[number];
