/**
 * Veridic-Claw
 * Verify agent claims - "Don't trust. Verify."
 *
 * A plugin for detecting when AI agents make false claims about their actions.
 * Extracts claims from responses, collects evidence, and verifies truthfulness.
 */

// Core types
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

// Config
export { resolveConfig, getConfigFromEnv, DEFAULT_CONFIG } from "./config.js";

// Database (core)
export {
  type Database,
  SQLiteDatabase,
  createDatabase,
  getDefaultDbPath,
} from "./core/index.js";

// Schema
export { VERIDIC_SCHEMA, initVeridicSchema } from "./schema.js";

// Engine
export { VeridicEngine, createVeridicEngine } from "./engine.js";

// Stores
export {
  ClaimStore,
  EvidenceStore,
  VerificationStore,
  TrustScoreStore,
  createStores,
  type VeridicStores,
} from "./store/index.js";

// Extractor
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

// Collector
export {
  EvidenceCollector,
  createEvidenceCollector,
  FileEvidenceSource,
  CommandEvidenceSource,
  ToolEvidenceSource,
  GitEvidenceSource,
  type CollectionResult,
} from "./collector/index.js";

// Verifier
export {
  ClaimVerifier,
  createClaimVerifier,
  FileVerificationStrategy,
  CommandVerificationStrategy,
  CodeVerificationStrategy,
  CompletionVerificationStrategy,
  type FullVerificationResult,
} from "./verifier/index.js";

// Tools
export {
  createVeridicTools,
  createVerifyTool,
  createAuditTool,
  createExpandTool,
  createScoreTool,
  getTool,
  type ToolDefinition,
} from "./tools/index.js";

// Plugin
export { createVeridicPlugin } from "./plugin.js";

// Default export - plugin factory
import { createVeridicPlugin } from "./plugin.js";
export default createVeridicPlugin;
