/**
 * Veridic-Claw - Claim verification for AI agents
 *
 * @module veridic-claw
 * @description
 * Unified memory and verification system for AI agents.
 * Solves three critical problems:
 * 1. Forgetting - Agent loses context of what it did
 * 2. False Claims - Agent says "done" but didn't do it
 * 3. Context Bloat - Context fills with irrelevant data
 *
 * v0.2 Features:
 * - Auto Retry: Retries contradicted claims up to 2 times
 * - Vector Search: Semantic memory with 128-dim embeddings
 * - Knowledge Graph: Entity relationships (file, function, test, etc.)
 * - Temporal Memory: Time-based queries ("last week", "3 days ago")
 *
 * @example
 * ```typescript
 * // As OpenClaw extension
 * // In openclaw.json:
 * {
 *   "extensions": ["@openclaw/veridic-claw"]
 * }
 *
 * // Programmatic usage:
 * import { createDatabase, createVeridicEngine } from "@openclaw/veridic-claw";
 *
 * const db = createDatabase("./veridic.db");
 * const engine = createVeridicEngine(db);
 * await engine.initialize();
 *
 * const result = await engine.processResponse("I created src/app.ts");
 * console.log(result.claims, result.trustScore);
 * ```
 */

// Plugin - default export for OpenClaw
export { default } from "./plugin.js";
export { createVeridicPlugin, getPluginEngine } from "./plugin.js";

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

// Configuration
export { resolveConfig, getConfigFromEnv, DEFAULT_CONFIG } from "./config.js";

// Database
export {
  type Database,
  SQLiteDatabase,
  createDatabase,
  getDefaultDbPath,
} from "./core/index.js";

// Schema
export { VERIDIC_SCHEMA, initVeridicSchema } from "./schema.js";

// Main engine
export { VeridicEngine, createVeridicEngine } from "./engine.js";

// Data stores
export {
  ClaimStore,
  EvidenceStore,
  VerificationStore,
  TrustScoreStore,
  createStores,
  type VeridicStores,
} from "./store/index.js";

// Claim extraction
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

// Evidence collection
export {
  EvidenceCollector,
  createEvidenceCollector,
  FileEvidenceSource,
  CommandEvidenceSource,
  ToolEvidenceSource,
  GitEvidenceSource,
  type CollectionResult,
} from "./collector/index.js";

// Claim verification
export {
  ClaimVerifier,
  createClaimVerifier,
  FileVerificationStrategy,
  CommandVerificationStrategy,
  CodeVerificationStrategy,
  CompletionVerificationStrategy,
  type FullVerificationResult,
} from "./verifier/index.js";

// Agent tools
export {
  createVeridicTools,
  createVerifyTool,
  createAuditTool,
  createExpandTool,
  createScoreTool,
  getTool,
  type ToolDefinition,
} from "./tools/index.js";

// Context management (Lossless integration)
export {
  LosslessBridge,
  createLosslessBridge,
  type Message,
  type AssembledContext,
  type LosslessBridgeConfig,
  DEFAULT_LOSSLESS_BRIDGE_CONFIG,
} from "./context/index.js";

// Shared utilities (Memory integration)
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

// v0.2: Auto Retry System
export {
  RetryManager,
  createRetryManager,
  generateRetryPrompt,
  type RetryConfig,
  type RetryResult,
  type RetryPromptContext,
  type RetryExecutor,
  type UserNotifier,
} from "./retry/index.js";

// v0.2: Vector Search (Semantic Memory)
export {
  EmbeddingService,
  createEmbeddingService,
  VectorStore,
  createVectorStore,
  type Embedding,
  type SimilarityResult,
  type VectorSearchOptions,
} from "./memory/index.js";

// v0.2: Knowledge Graph
export {
  EntityStore,
  createEntityStore,
  RelationshipStore,
  createRelationshipStore,
  GraphService,
  createGraphService,
  type Entity,
  type EntityType,
  type Relationship,
  type RelationshipType,
  type GraphPath,
  type GraphStats,
} from "./graph/index.js";

// v0.2: Temporal Memory
export {
  TemporalStore,
  createTemporalStore,
  TimelineService,
  createTimelineService,
  type TemporalEvent,
  type TemporalEventType,
  type TimelineSegment,
  type ParsedTimeRange,
  type TemporalStats,
} from "./temporal/index.js";

// Receipt-based verification
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
