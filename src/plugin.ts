/**
 * Veridic-Claw Plugin
 *
 * This module provides a plugin interface for integrating Veridic
 * with agent frameworks. The plugin:
 *
 * 1. Hooks into agent lifecycle events
 * 2. Extracts and verifies claims from agent responses
 * 3. Tracks trust scores and blocks untrusted agents
 * 4. Exposes verification tools for agent use
 *
 * @example
 * ```typescript
 * import { createVeridicPlugin } from "veridic-claw";
 * import { createDatabase } from "veridic-claw/database";
 *
 * const db = createDatabase(":memory:");
 * const plugin = createVeridicPlugin(db, { autoVerify: true });
 *
 * // Register with your agent framework
 * agent.use(plugin);
 * ```
 */

import type { Database } from "./core/database.js";
import type { VeridicConfig, LLMApi } from "./types.js";
import { VeridicEngine, createVeridicEngine } from "./engine.js";
import { createVeridicTools } from "./tools/index.js";
import { resolveConfig } from "./config.js";

/**
 * Internal plugin state
 *
 * Maintains the engine instance and initialization status.
 * Singleton pattern ensures consistent state across hooks.
 */
interface PluginState {
  engine: VeridicEngine;
  initialized: boolean;
}

/** Global plugin state singleton */
let state: PluginState | null = null;

/**
 * Initialize the plugin with database and config
 *
 * Creates the VeridicEngine if not already initialized.
 * Safe to call multiple times - returns existing state.
 *
 * @param db - Database for persistence
 * @param config - Optional configuration overrides
 * @returns Plugin state with initialized engine
 */
async function initializePlugin(
  db: Database,
  config?: Partial<VeridicConfig>
): Promise<PluginState> {
  if (state?.initialized) {
    return state;
  }

  const engine = createVeridicEngine(db, config);
  await engine.initialize();

  state = {
    engine,
    initialized: true,
  };

  return state;
}

/**
 * Extract AI response content from context object
 *
 * Handles different context formats from various frameworks.
 */
function extractAIResponse(context: unknown): string | null {
  if (!context || typeof context !== "object") {
    return null;
  }

  const ctx = context as {
    response?: { content?: string };
    assistantMessage?: string;
    output?: string;
  };

  return ctx.response?.content ?? ctx.assistantMessage ?? ctx.output ?? null;
}

/** Extract response ID from context */
function extractResponseId(context: unknown): string | null {
  if (!context || typeof context !== "object") {
    return null;
  }

  const ctx = context as { responseId?: string; response_id?: string };
  return ctx.responseId ?? ctx.response_id ?? null;
}

/** Extract session ID from context */
function extractSessionId(context: unknown): string | null {
  if (!context || typeof context !== "object") {
    return null;
  }

  const ctx = context as { sessionId?: string; session_id?: string };
  return ctx.sessionId ?? ctx.session_id ?? null;
}

/** Extract task ID from context */
function extractTaskId(context: unknown): string | null {
  if (!context || typeof context !== "object") {
    return null;
  }

  const ctx = context as { taskId?: string; task_id?: string };
  return ctx.taskId ?? ctx.task_id ?? null;
}

/** Extract LLM API from context for hybrid extraction */
function extractLLMApi(context: unknown): LLMApi | undefined {
  if (!context || typeof context !== "object") {
    return undefined;
  }

  const ctx = context as { llmApi?: LLMApi };
  return ctx.llmApi;
}

/**
 * Create a Veridic-Claw plugin instance
 *
 * The plugin hooks into agent lifecycle events to:
 * - Check trust score before agent starts (may block low-trust agents)
 * - Extract and verify claims after agent responds
 * - Log warnings for contradicted claims
 *
 * @param db - Database for storing claims and verifications
 * @param config - Optional configuration overrides
 * @returns Plugin object with hooks and methods
 *
 * @example
 * ```typescript
 * const plugin = createVeridicPlugin(db, {
 *   autoVerify: true,
 *   trustWarningThreshold: 70,
 *   trustBlockThreshold: 30,
 * });
 *
 * // Plugin provides:
 * // - plugin.hooks.before_agent_start
 * // - plugin.hooks.agent_end
 * // - plugin.register() for tools
 * // - plugin.getEngine() for direct access
 * ```
 */
export function createVeridicPlugin(db: Database, config?: Partial<VeridicConfig>) {
  const resolvedConfig = resolveConfig(config);

  return {
    id: "veridic-claw",
    name: "Veridic Claw",
    description: "Verify agent claims - detect when agents lie about their actions",

    /**
     * Lifecycle hooks for agent frameworks
     */
    hooks: {
      /**
       * Called before agent starts processing
       *
       * Checks trust score and may block or warn based on thresholds.
       * Returns systemMessage for warnings and blocked flag to stop execution.
       */
      before_agent_start: async (context: unknown) => {
        const pluginState = await initializePlugin(db, resolvedConfig);
        const { engine } = pluginState;

        const sessionId = extractSessionId(context);
        const taskId = extractTaskId(context);

        if (sessionId) {
          engine.setSession(sessionId, taskId);
        }

        const trustContext = await engine.getTrustContext();

        if (await engine.shouldBlock()) {
          return {
            systemMessage: `[VERIDIC-CLAW] BLOCKED: Trust score (${trustContext.current_score.toFixed(0)}) is below threshold. Agent has made too many false claims.`,
            blocked: true,
          };
        }

        if (trustContext.warning_message) {
          return {
            systemMessage: trustContext.warning_message,
          };
        }

        return {};
      },

      /**
       * Called after agent finishes responding
       *
       * Extracts claims from response, verifies them against evidence,
       * and updates trust score. Logs warnings for contradicted claims.
       */
      agent_end: async (context: unknown) => {
        if (!state?.initialized) {
          return;
        }

        const { engine } = state;

        const response = extractAIResponse(context);
        if (!response) {
          return;
        }

        const sessionId = extractSessionId(context);
        const taskId = extractTaskId(context);

        if (sessionId) {
          engine.setSession(sessionId, taskId);
        }

        const responseId = extractResponseId(context);
        const llmApi = extractLLMApi(context);

        try {
          const result = await engine.processResponse(response, responseId, llmApi);

          if (result.claims.length > 0) {
            console.log(
              `[veridic-claw] Processed ${result.claims.length} claims, ` +
                `${result.verifications.filter((v) => v.verification.status === "verified").length} verified, ` +
                `${result.verifications.filter((v) => v.verification.status === "contradicted").length} contradicted`
            );
          }

          const contradicted = result.verifications.filter(
            (v) => v.verification.status === "contradicted"
          );

          if (contradicted.length > 0) {
            console.warn(
              `[veridic-claw] WARNING: ${contradicted.length} false claims detected!`
            );
            for (const c of contradicted) {
              console.warn(`  - ${c.claim.claim_type}: "${c.claim.original_text.slice(0, 60)}..."`);
            }
          }
        } catch (error) {
          console.error("[veridic-claw] Error processing response:", error);
        }
      },
    },

    /**
     * Register verification tools with the agent framework
     *
     * Exposes tools like veridic_audit, veridic_verify, veridic_score
     * for agent use.
     *
     * @param api - Framework API object
     * @param context - Registration context
     * @returns Map of tool names to tool definitions
     */
    register(api: unknown, context: unknown) {
      if (!state?.initialized) {
        return {};
      }

      const tools = createVeridicTools(state.engine);

      const toolMap: Record<string, unknown> = {};
      for (const tool of tools) {
        toolMap[tool.name] = {
          description: tool.description,
          parameters: tool.parameters,
          execute: tool.execute,
        };
      }

      return toolMap;
    },

    /**
     * Get direct access to the VeridicEngine
     *
     * Allows advanced usage like manual verification or report generation.
     *
     * @returns Engine instance or null if not initialized
     */
    getEngine(): VeridicEngine | null {
      return state?.engine ?? null;
    },

    /**
     * Shut down the plugin and clear state
     *
     * Call when the agent framework is shutting down.
     */
    async shutdown() {
      state = null;
    },
  };
}

export default createVeridicPlugin;
