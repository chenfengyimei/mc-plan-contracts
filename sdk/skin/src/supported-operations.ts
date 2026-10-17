/** MCP-F1-CONTRACTS-007: producer-verified Standalone anonymous-window surface; no future methods. */
export const SUPPORTED_CONTRACT_VERSION = '0.1.0-alpha.1' as const;
export const SUPPORTED_CONTRACT_LOCK_COMMIT = '30064022daa61795b9a1945af2d23a0ce88d04dd' as const;
export const SUPPORTED_PRODUCER_COMMIT = '14a8fe3d24ecb68b02cc8ab765f57b6103893e76' as const;
export const SUPPORTED_CONTRACT_FILES = {
  'openapi/skin.yaml': '9e9596f0050c6393a7010bad1723f26d683a585e77d4fca85fe4795ad6f80565',
  'schemas/common/problem.json': '80d6abfca67ccac9e22d83542134755c6126cae2696afbaa4c85efaceec4ba11',
} as const;
export type SupportedContractFile = keyof typeof SUPPORTED_CONTRACT_FILES;
export const SUPPORTED_OPERATIONS = [
  'createConversation',
  'createRender',
  'finalizeSkin',
  'getJob',
  'getConversation',
  'deleteConversation',
  'getCandidatePreview',
  'downloadSkin',
] as const;
export type SupportedOperation = (typeof SUPPORTED_OPERATIONS)[number];
