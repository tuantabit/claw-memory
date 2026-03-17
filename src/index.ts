export type {
  Claim,
  ClaimType,
  ClaimEntity,
  Evidence,
  EvidenceSource,
  Verification,
  VerificationStatus,
  TrustScore,
  TrustContext,
  TrustReport,
  TrustIssue,
  VeridicConfig,
  VeridicDependencies,
  LLMApi,
  ClaimPattern,
  ExtractionResult,
  VerificationInput,
  VerificationOutput,
  QueryOptions,
  ClaimFilter,
  VerificationFilter,
} from "./types.js";

export { resolveConfig, getConfigFromEnv, DEFAULT_CONFIG } from "./config.js";

export {
  type Database,
  SQLiteDatabase,
  createDatabase,
  getDefaultDbPath,
} from "./core/index.js";

export { VERIDIC_SCHEMA, initVeridicSchema } from "./schema.js";

export { VeridicEngine, createVeridicEngine } from "./engine.js";

export {
  ClaimStore,
  EvidenceStore,
  VerificationStore,
  TrustScoreStore,
  createStores,
  type VeridicStores,
} from "./store/index.js";

export {
  ClaimExtractor,
  createClaimExtractor,
  extractClaimsWithLLM,
  ALL_PATTERNS,
  FILE_PATTERNS,
  CODE_PATTERNS,
  COMMAND_PATTERNS,
  TEST_PATTERNS,
} from "./extractor/index.js";

export {
  EvidenceCollector,
  createEvidenceCollector,
  FileEvidenceSource,
  CommandEvidenceSource,
  ToolEvidenceSource,
  GitEvidenceSource,
  type CollectionResult,
} from "./collector/index.js";

export {
  ClaimVerifier,
  createClaimVerifier,
  FileVerificationStrategy,
  CommandVerificationStrategy,
  CodeVerificationStrategy,
  CompletionVerificationStrategy,
  type FullVerificationResult,
} from "./verifier/index.js";

export {
  createVeridicTools,
  createVerifyTool,
  createAuditTool,
  createExpandTool,
  createScoreTool,
  getTool,
  type ToolDefinition,
} from "./tools/index.js";

export { createVeridicPlugin } from "./plugin.js";

export {
  LosslessBridge,
  createLosslessBridge,
  type Message,
  type AssembledContext,
  type LosslessBridgeConfig,
  DEFAULT_LOSSLESS_BRIDGE_CONFIG,
} from "./context/index.js";

export {
  SharedDatabaseAdapter,
  createSharedDatabaseAdapter,
  MemoryBridge,
  createMemoryBridge,
  UnifiedAssembler,
  createUnifiedAssembler,
  DecayLevel,
  type ClawMemoryReceipts,
  type MemoryEntry,
  type MemorySearchOptions,
  type MemoryBridgeConfig,
  type MemoryProvider,
  type UnifiedAssemblerConfig,
  type UnifiedContext,
} from "./shared/index.js";

export {
  ReceiptSource,
  createReceiptSource,
  type ReceiptSourceConfig,
} from "./collector/sources/receipt-source.js";

export {
  ReceiptStrategy,
  createReceiptStrategy,
  type ReceiptStrategyConfig,
} from "./verifier/strategies/receipt-strategy.js";

import { createVeridicPlugin } from "./plugin.js";
export default createVeridicPlugin;
