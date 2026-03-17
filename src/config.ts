/**
 * Veridic-Claw Configuration
 * Following lossless-claw pattern for configuration
 */

/**
 * Configuration for veridic-claw
 */
export interface VeridicConfig {
  /** Enable LLM-based claim extraction when regex confidence is low */
  enableLLM: boolean;

  /** Minimum confidence for regex extraction (0-1) */
  extractionThreshold: number;

  /** Minimum confidence to mark claim as verified (0-1) */
  verificationThreshold: number;

  /** Score below which to show warning */
  trustWarningThreshold: number;

  /** Score below which to block actions */
  trustBlockThreshold: number;

  /** Enable real-time verification */
  enableRealtime: boolean;

  /** Maximum claims to track per session */
  maxClaimsPerSession: number;

  /** Enable auto-verification after each response */
  autoVerify: boolean;

  /** Severity weights for trust score calculation */
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
}

/**
 * Default configuration
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
    file_deleted: 1.2,
    code_added: 0.8,
    code_removed: 0.8,
    code_fixed: 1.5,
    command_executed: 0.6,
    test_passed: 2.0,
    test_failed: 0.5,
    error_fixed: 1.5,
    dependency_added: 0.7,
    config_changed: 0.8,
    task_completed: 1.0,
    unknown: 0.3,
  },
};

/**
 * Resolve config with defaults
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
  };
}

/**
 * Get config from environment variables
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

  return config;
}
