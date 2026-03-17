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
export type { CompactionConfig } from "./compactor/types.js";

/**
 * Main configuration interface for Veridic Engine
 */
export interface VeridicConfig {
  /** Enable LLM-based claim extraction when regex confidence is low */
  enableLLM: boolean;

  /** Minimum regex confidence before falling back to LLM (0.0-1.0) */
  extractionThreshold: number;

  /** Minimum confidence to mark a claim as verified (0.0-1.0) */
  verificationThreshold: number;

  /** Trust score below which to show warnings (0-100) */
  trustWarningThreshold: number;

  /** Trust score below which to block agent actions (0-100) */
  trustBlockThreshold: number;

  /** Enable real-time verification after each response */
  enableRealtime: boolean;

  /** Maximum claims to track per session */
  maxClaimsPerSession: number;

  /** Automatically verify claims after extraction */
  autoVerify: boolean;

  /**
   * Severity weights for each claim type
   * Higher weight = more impact on trust score
   */
  severityWeights: {
    file_created: number;
    file_modified: number;
    file_deleted: number;
    code_added: number;
    code_removed: number;
    code_fixed: number;
    command_executed: number;
    test_passed: number;
    test_failed: number;
    error_fixed: number;
    dependency_added: number;
    config_changed: number;
    task_completed: number;
    unknown: number;
  };

  /** Database compaction settings */
  compaction: CompactionConfig;
}

/**
 * Default configuration values
 *
 * These provide sensible defaults for most use cases:
 * - LLM enabled for better extraction accuracy
 * - 60% extraction threshold (falls back to LLM below this)
 * - 70% verification threshold
 * - Warning at 70 trust score, block at 30
 * - test_passed has highest weight (2.0) - false test claims are critical
 */
export const DEFAULT_CONFIG: VeridicConfig = {
  enableLLM: true,
  extractionThreshold: 0.6,
  verificationThreshold: 0.7,
  trustWarningThreshold: 70,
  trustBlockThreshold: 30,
  enableRealtime: true,
  maxClaimsPerSession: 1000,
  autoVerify: true,
  severityWeights: {
    file_created: 1.0,
    file_modified: 1.0,
    file_deleted: 1.2,      // Deletions are harder to undo
    code_added: 0.8,
    code_removed: 0.8,
    code_fixed: 1.5,        // Bug fix claims are important
    command_executed: 0.6,  // Low impact, easily verified
    test_passed: 2.0,       // CRITICAL - false test claims are dangerous
    test_failed: 0.5,       // Lower weight, agent admitting failure
    error_fixed: 1.5,
    dependency_added: 0.7,
    config_changed: 0.8,
    task_completed: 1.0,
    unknown: 0.3,           // Unknown claims have minimal impact
  },
  compaction: DEFAULT_COMPACTION_CONFIG,
};

/**
 * Merge partial config with defaults
 *
 * @param config - Partial configuration to merge
 * @returns Complete configuration with all fields
 */
export function resolveConfig(config?: Partial<VeridicConfig>): VeridicConfig {
  if (!config) {
    return { ...DEFAULT_CONFIG };
  }

  return {
    ...DEFAULT_CONFIG,
    ...config,
    severityWeights: {
      ...DEFAULT_CONFIG.severityWeights,
      ...config.severityWeights,
    },
    compaction: {
      ...DEFAULT_CONFIG.compaction,
      ...config.compaction,
    },
  };
}

/**
 * Load configuration from environment variables
 *
 * Supported environment variables:
 * - VERIDIC_ENABLE_LLM: "true" or "false"
 * - VERIDIC_EXTRACTION_THRESHOLD: float (0.0-1.0)
 * - VERIDIC_VERIFICATION_THRESHOLD: float (0.0-1.0)
 * - VERIDIC_WARNING_THRESHOLD: int (0-100)
 * - VERIDIC_BLOCK_THRESHOLD: int (0-100)
 * - VERIDIC_REALTIME: "true" or "false"
 * - VERIDIC_AUTO_VERIFY: "true" or "false"
 * - VERIDIC_RETENTION_DAYS: int
 * - VERIDIC_AUTO_COMPACT: "true" or "false"
 * - VERIDIC_COMPACT_INTERVAL: cron expression
 */
export function getConfigFromEnv(): Partial<VeridicConfig> {
  const config: Partial<VeridicConfig> = {};

  if (process.env.VERIDIC_ENABLE_LLM !== undefined) {
    config.enableLLM = process.env.VERIDIC_ENABLE_LLM === "true";
  }

  if (process.env.VERIDIC_EXTRACTION_THRESHOLD) {
    config.extractionThreshold = parseFloat(process.env.VERIDIC_EXTRACTION_THRESHOLD);
  }

  if (process.env.VERIDIC_VERIFICATION_THRESHOLD) {
    config.verificationThreshold = parseFloat(process.env.VERIDIC_VERIFICATION_THRESHOLD);
  }

  if (process.env.VERIDIC_WARNING_THRESHOLD) {
    config.trustWarningThreshold = parseFloat(process.env.VERIDIC_WARNING_THRESHOLD);
  }

  if (process.env.VERIDIC_BLOCK_THRESHOLD) {
    config.trustBlockThreshold = parseFloat(process.env.VERIDIC_BLOCK_THRESHOLD);
  }

  if (process.env.VERIDIC_REALTIME !== undefined) {
    config.enableRealtime = process.env.VERIDIC_REALTIME === "true";
  }

  if (process.env.VERIDIC_AUTO_VERIFY !== undefined) {
    config.autoVerify = process.env.VERIDIC_AUTO_VERIFY === "true";
  }

  // Compaction config from env
  const compaction: Partial<CompactionConfig> = {};

  if (process.env.VERIDIC_RETENTION_DAYS) {
    compaction.retentionDays = parseInt(process.env.VERIDIC_RETENTION_DAYS, 10);
  }

  if (process.env.VERIDIC_AUTO_COMPACT !== undefined) {
    compaction.autoCompact = process.env.VERIDIC_AUTO_COMPACT === "true";
  }

  if (process.env.VERIDIC_COMPACT_INTERVAL) {
    compaction.compactInterval = process.env.VERIDIC_COMPACT_INTERVAL;
  }

  if (Object.keys(compaction).length > 0) {
    config.compaction = { ...DEFAULT_COMPACTION_CONFIG, ...compaction };
  }

  return config;
}
