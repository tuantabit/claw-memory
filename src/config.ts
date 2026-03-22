/**
 * Configuration for Claw Memory
 *
 * This module defines all configuration options and provides
 * functions to resolve config from defaults and environment variables.
 */

import {
  type CompactionConfig,
  DEFAULT_COMPACTION_CONFIG,
} from "./compactor/types.js";
import {
  type RetryConfig,
  DEFAULT_RETRY_CONFIG,
} from "./retry/types.js";
export type { CompactionConfig } from "./compactor/types.js";
export type { RetryConfig } from "./retry/types.js";

/**
 * Main configuration interface for ClawMemory Engine
 */
export interface ClawMemoryConfig {
  /** Enable LLM-based claim extraction when regex confidence is low */
  enableLLM: boolean;

  /** Minimum regex confidence before falling back to LLM (0.0-1.0) */
  extractionThreshold: number;

  /** Minimum confidence to mark a claim as verified (0.0-1.0) */
  verificationThreshold: number;

  /** Enable real-time verification after each response */
  enableRealtime: boolean;

  /** Maximum claims to track per session */
  maxClaimsPerSession: number;

  /** Automatically verify claims after extraction */
  autoVerify: boolean;

  /** Database compaction settings */
  compaction: CompactionConfig;

  /** Auto retry settings for contradicted claims (max 2 retries) */
  retry: RetryConfig;
}

/**
 * Default configuration values
 *
 * These provide sensible defaults for most use cases:
 * - LLM enabled for better extraction accuracy
 * - 60% extraction threshold (falls back to LLM below this)
 * - 70% verification threshold
 * - Retry max 2 times for contradicted claims
 */
export const DEFAULT_CONFIG: ClawMemoryConfig = {
  enableLLM: true,
  extractionThreshold: 0.6,
  verificationThreshold: 0.7,
  enableRealtime: true,
  maxClaimsPerSession: 1000,
  autoVerify: true,
  compaction: DEFAULT_COMPACTION_CONFIG,
  retry: DEFAULT_RETRY_CONFIG,
};

/**
 * Merge partial config with defaults
 *
 * @param config - Partial configuration to merge
 * @returns Complete configuration with all fields
 */
export function resolveConfig(config?: Partial<ClawMemoryConfig>): ClawMemoryConfig {
  if (!config) {
    return { ...DEFAULT_CONFIG };
  }

  return {
    ...DEFAULT_CONFIG,
    ...config,
    compaction: {
      ...DEFAULT_CONFIG.compaction,
      ...config.compaction,
    },
    retry: {
      ...DEFAULT_CONFIG.retry,
      ...config.retry,
    },
  };
}

/**
 * Load configuration from environment variables
 *
 * Supported environment variables:
 * - CLAW_MEMORY_ENABLE_LLM: "true" or "false"
 * - CLAW_MEMORY_EXTRACTION_THRESHOLD: float (0.0-1.0)
 * - CLAW_MEMORY_VERIFICATION_THRESHOLD: float (0.0-1.0)
 * - CLAW_MEMORY_REALTIME: "true" or "false"
 * - CLAW_MEMORY_AUTO_VERIFY: "true" or "false"
 * - CLAW_MEMORY_RETENTION_DAYS: int
 * - CLAW_MEMORY_AUTO_COMPACT: "true" or "false"
 * - CLAW_MEMORY_COMPACT_INTERVAL: cron expression
 */
export function getConfigFromEnv(): Partial<ClawMemoryConfig> {
  const config: Partial<ClawMemoryConfig> = {};

  if (process.env.CLAW_MEMORY_ENABLE_LLM !== undefined) {
    config.enableLLM = process.env.CLAW_MEMORY_ENABLE_LLM === "true";
  }

  if (process.env.CLAW_MEMORY_EXTRACTION_THRESHOLD) {
    config.extractionThreshold = parseFloat(process.env.CLAW_MEMORY_EXTRACTION_THRESHOLD);
  }

  if (process.env.CLAW_MEMORY_VERIFICATION_THRESHOLD) {
    config.verificationThreshold = parseFloat(process.env.CLAW_MEMORY_VERIFICATION_THRESHOLD);
  }

  if (process.env.CLAW_MEMORY_REALTIME !== undefined) {
    config.enableRealtime = process.env.CLAW_MEMORY_REALTIME === "true";
  }

  if (process.env.CLAW_MEMORY_AUTO_VERIFY !== undefined) {
    config.autoVerify = process.env.CLAW_MEMORY_AUTO_VERIFY === "true";
  }

  // Compaction config from env
  const compaction: Partial<CompactionConfig> = {};

  if (process.env.CLAW_MEMORY_RETENTION_DAYS) {
    compaction.retentionDays = parseInt(process.env.CLAW_MEMORY_RETENTION_DAYS, 10);
  }

  if (process.env.CLAW_MEMORY_AUTO_COMPACT !== undefined) {
    compaction.autoCompact = process.env.CLAW_MEMORY_AUTO_COMPACT === "true";
  }

  if (process.env.CLAW_MEMORY_COMPACT_INTERVAL) {
    compaction.compactInterval = process.env.CLAW_MEMORY_COMPACT_INTERVAL;
  }

  if (Object.keys(compaction).length > 0) {
    config.compaction = { ...DEFAULT_COMPACTION_CONFIG, ...compaction };
  }

  // Retry config from env
  const retry: Partial<RetryConfig> = {};

  if (process.env.CLAW_MEMORY_RETRY_ENABLED !== undefined) {
    retry.enabled = process.env.CLAW_MEMORY_RETRY_ENABLED === "true";
  }

  if (process.env.CLAW_MEMORY_MAX_RETRIES) {
    retry.maxRetries = parseInt(process.env.CLAW_MEMORY_MAX_RETRIES, 10);
  }

  if (process.env.CLAW_MEMORY_RETRY_NOTIFY_USER !== undefined) {
    retry.notifyUser = process.env.CLAW_MEMORY_RETRY_NOTIFY_USER === "true";
  }

  if (Object.keys(retry).length > 0) {
    config.retry = { ...DEFAULT_RETRY_CONFIG, ...retry };
  }

  return config;
}
