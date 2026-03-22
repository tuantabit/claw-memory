export {
  SharedDatabaseAdapter,
  createSharedDatabaseAdapter,
  type ClawMemoryReceipts,
  INTEGRATION_SCHEMA,
} from "./database-adapter.js";

export {
  MemoryBridge,
  createMemoryBridge,
  DecayLevel,
  type MemoryEntry,
  type MemorySearchOptions,
  type MemoryBridgeConfig,
  type MemoryProvider,
  type MemoryLayerName,
  type MemoryEntryType,
  DEFAULT_MEMORY_BRIDGE_CONFIG,
} from "./memory-bridge.js";

export {
  UnifiedAssembler,
  createUnifiedAssembler,
  type UnifiedAssemblerConfig,
  type UnifiedContext,
  DEFAULT_UNIFIED_ASSEMBLER_CONFIG,
} from "./unified-assembler.js";
