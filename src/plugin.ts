/**
 * @module plugin
 * @description OpenClaw plugin for Veridic-Claw
 *
 * Integrates claim verification into OpenClaw agent framework:
 * - Extracts claims from agent responses
 * - Verifies claims against evidence (file receipts, command outputs)
 * - Auto-retries contradicted claims (max 2 attempts)
 * - Warns user if retries fail
 * - Provides semantic search, knowledge graph, and temporal memory
 *
 * @example
 * ```typescript
 * // In openclaw.json or config
 * {
 *   "extensions": ["@openclaw/veridic-claw"]
 * }
 * ```
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createDatabase, getDefaultDbPath } from "./core/database.js";
import { initVeridicSchema } from "./schema.js";
import { VeridicEngine, createVeridicEngine } from "./engine.js";
import { resolveConfig, type VeridicConfig } from "./config.js";
import { createReceiptCollector } from "./collector/receipt-collector.js";
import { createRetryManager } from "./retry/index.js";

/**
 * Resolve plugin configuration from environment and user config
 */
function resolvePluginConfig(
  env: NodeJS.ProcessEnv,
  pluginConfig?: Record<string, unknown>
): VeridicConfig {
  const config: Partial<VeridicConfig> = {};

  // Environment variables
  if (env.VERIDIC_AUTO_VERIFY === "true") config.autoVerify = true;
  if (env.VERIDIC_AUTO_VERIFY === "false") config.autoVerify = false;
  if (env.VERIDIC_ENABLE_LLM === "true") config.enableLLM = true;

  // Plugin config overrides
  if (pluginConfig) {
    if (typeof pluginConfig.enabled === "boolean") {
      config.autoVerify = pluginConfig.enabled;
    }
    if (typeof pluginConfig.autoVerify === "boolean") {
      config.autoVerify = pluginConfig.autoVerify;
    }
    if (typeof pluginConfig.enableLLM === "boolean") {
      config.enableLLM = pluginConfig.enableLLM;
    }
    if (pluginConfig.retry && typeof pluginConfig.retry === "object") {
      config.retry = pluginConfig.retry as VeridicConfig["retry"];
    }
  }

  return resolveConfig(config);
}

/** Plugin state stored after registration */
let pluginState: {
  engine: VeridicEngine;
  config: VeridicConfig;
} | null = null;

/**
 * Get the plugin engine instance
 * @returns VeridicEngine or null if not initialized
 */
export function getPluginEngine(): VeridicEngine | null {
  return pluginState?.engine ?? null;
}

/**
 * Veridic-Claw OpenClaw Plugin
 *
 * Provides claim verification for AI agents:
 * - Detects when agents lie about their actions
 * - Verifies file creation, modifications, command execution
 * - Auto-retries failed claims up to 2 times
 * - Warns user if all retries fail
 */
const veridicPlugin = {
  id: "veridic-claw",
  name: "Veridic Claw",
  description:
    "Claim verification for AI agents - detect when agents lie about their actions",

  /**
   * Parse and validate plugin configuration
   */
  configSchema: {
    parse(value: unknown): VeridicConfig {
      const raw =
        value && typeof value === "object" && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      return resolvePluginConfig(process.env, raw);
    },
  },

  /**
   * Register plugin with OpenClaw
   *
   * Sets up:
   * - Database connection and schema
   * - Verification engine with v0.2 features
   * - Receipt collector for evidence capture
   * - Retry manager for auto-retry on contradictions
   */
  register(api: OpenClawPluginApi) {
    const pluginConfig =
      api.pluginConfig && typeof api.pluginConfig === "object"
        ? (api.pluginConfig as Record<string, unknown>)
        : undefined;

    const config = resolvePluginConfig(process.env, pluginConfig);

    // Resolve database path
    const dbPath =
      (pluginConfig?.dbPath as string) ||
      process.env.VERIDIC_DB_PATH ||
      getDefaultDbPath();

    // Initialize database
    const db = createDatabase(dbPath);
    initVeridicSchema(db);

    // Create verification engine
    const engine = createVeridicEngine(db, config);
    engine.initialize().catch((err) => {
      api.logger.error(`[veridic-claw] Failed to initialize engine: ${err}`);
    });

    // Create supporting components
    const receiptCollector = createReceiptCollector(db);
    const retryManager = createRetryManager(config.retry);

    // Store state for external access
    pluginState = { engine, config };

    // Log startup
    api.logger.info(
      `[veridic-claw] Plugin v0.2 loaded (enabled=${config.autoVerify}, db=${dbPath})`
    );
    api.logger.info(
      `[veridic-claw] Features: Auto-retry (max ${config.retry.maxRetries}), ` +
        `Vector Search, Knowledge Graph, Temporal Memory`
    );
  },
};

export default veridicPlugin;

// Legacy export for backward compatibility
export { veridicPlugin as createVeridicPlugin };
