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
 * 5. Captures receipts from tool calls for verification
 * 6. Manages persistent memory across sessions
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
import type { VeridicConfig, LLMApi, Verification, Claim } from "./types.js";
import { VeridicEngine, createVeridicEngine } from "./engine.js";
import { createVeridicTools } from "./tools/index.js";
import { resolveConfig } from "./config.js";
import { ReceiptCollector, createReceiptCollector } from "./collector/receipt-collector.js";
import { MemoryBridge, createPersistentMemoryBridge } from "./shared/memory-bridge.js";
import { LosslessBridge, createPersistentLosslessBridge } from "./context/lossless-bridge.js";
import { RetryManager, createRetryManager, type RetryExecutor, type UserNotifier } from "./retry/index.js";

/**
 * Internal plugin state
 *
 * Maintains all component instances and initialization status.
 * Singleton pattern ensures consistent state across hooks.
 */
interface PluginState {
  engine: VeridicEngine;
  receiptCollector: ReceiptCollector;
  memoryBridge: MemoryBridge;
  losslessBridge: LosslessBridge;
  retryManager: RetryManager;
  initialized: boolean;
}

/** Global plugin state singleton */
let state: PluginState | null = null;

/**
 * Initialize the plugin with database and config
 *
 * Creates all components if not already initialized:
 * - VeridicEngine for claim extraction and verification
 * - ReceiptCollector for capturing tool call evidence
 * - MemoryBridge for persistent 3-layer memory
 * - LosslessBridge for context management
 *
 * Safe to call multiple times - returns existing state.
 *
 * @param db - Database for persistence
 * @param config - Optional configuration overrides
 * @returns Plugin state with all initialized components
 */
async function initializePlugin(
  db: Database,
  config?: Partial<VeridicConfig>
): Promise<PluginState> {
  if (state?.initialized) {
    return state;
  }

  // Create verification engine
  const engine = createVeridicEngine(db, config);
  await engine.initialize();

  // Create receipt collector for tool call evidence
  const receiptCollector = createReceiptCollector(db);

  // Create persistent memory bridge
  const memoryBridge = createPersistentMemoryBridge(db, {
    contradictionImportance: 0.95,
    verifiedImportance: 0.4,
    unverifiedImportance: 0.3,
  });

  // Create persistent context bridge
  const losslessBridge = createPersistentLosslessBridge(db, {
    maxTokens: 8000,
    recentMessageCount: 10,
    includeVerifications: true,
    trustWarningThreshold: config?.trustWarningThreshold ?? 70,
  });

  // Create retry manager for auto-retry on contradictions
  const resolvedCfg = resolveConfig(config);
  const retryManager = createRetryManager(resolvedCfg.retry);

  state = {
    engine,
    receiptCollector,
    memoryBridge,
    losslessBridge,
    retryManager,
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
 * Extract tool call context from hook payload
 *
 * Handles different context formats from various frameworks.
 * Returns a normalized object with session, task, tool, and input info.
 */
function extractToolContext(context: unknown): {
  sessionId: string | null;
  taskId: string | null;
  toolName: string | null;
  input: unknown;
} {
  if (!context || typeof context !== "object") {
    return { sessionId: null, taskId: null, toolName: null, input: null };
  }

  const ctx = context as {
    sessionId?: string;
    session_id?: string;
    taskId?: string;
    task_id?: string;
    toolName?: string;
    tool_name?: string;
    name?: string;
    input?: unknown;
    toolInput?: unknown;
    tool_input?: unknown;
    parameters?: unknown;
  };

  return {
    sessionId: ctx.sessionId ?? ctx.session_id ?? null,
    taskId: ctx.taskId ?? ctx.task_id ?? null,
    toolName: ctx.toolName ?? ctx.tool_name ?? ctx.name ?? null,
    input: ctx.input ?? ctx.toolInput ?? ctx.tool_input ?? ctx.parameters ?? null,
  };
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
       * and updates trust score. Handles auto-retry for contradicted claims.
       */
      agent_end: async (context: unknown) => {
        if (!state?.initialized) {
          return;
        }

        const { engine, retryManager } = state;

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

            // Auto-retry for contradictions
            const retryResults = await retryManager.handleContradictions(
              contradicted.map((c) => ({
                claim: c.claim,
                verification: c.verification,
              })),
              async (claim: Claim): Promise<Verification> => {
                // Re-verify the claim
                const verifyResult = await engine.verifyClaim(claim.claim_id);
                if (verifyResult) {
                  return verifyResult.verification;
                }
                // Return a default unverified result if reverification fails
                return {
                  verification_id: "",
                  claim_id: claim.claim_id,
                  status: "unverified",
                  evidence_ids: [],
                  confidence: 0,
                  details: "Re-verification failed",
                  verified_at: new Date(),
                };
              }
            );

            // Log retry results
            for (const retryResult of retryResults) {
              if (retryResult.success) {
                console.log(
                  `[veridic-claw] Retry SUCCESS: ${retryResult.originalClaim.claim_type} ` +
                    `verified after ${retryResult.retriesAttempted} attempt(s)`
                );
              } else if (retryResult.finalStatus === "max_retries_exceeded") {
                console.warn(
                  `[veridic-claw] Retry FAILED: ${retryResult.originalClaim.claim_type} ` +
                    `- ${retryResult.userNotification || "Max retries exceeded"}`
                );
              }
            }
          }
        } catch (error) {
          console.error("[veridic-claw] Error processing response:", error);
        }
      },

      /**
       * Called when a tool call starts
       *
       * Creates an action record to track the tool call.
       * Returns actionId for use in subsequent hooks.
       */
      on_tool_call: async (context: unknown) => {
        if (!state?.initialized) return {};

        const ctx = extractToolContext(context);
        if (!ctx.sessionId || !ctx.toolName) return {};

        try {
          const actionId = await state.receiptCollector.startAction(
            ctx.sessionId,
            ctx.toolName,
            ctx.input,
            ctx.taskId ?? undefined
          );

          return { actionId };
        } catch (error) {
          console.error("[veridic-claw] Error starting action:", error);
          return {};
        }
      },

      /**
       * Called when a tool call completes
       *
       * Creates receipts based on tool type:
       * - File operations → file_receipts
       * - Command executions → command_receipts
       */
      on_tool_result: async (context: unknown) => {
        if (!state?.initialized) return;

        const ctx = context as {
          actionId?: string;
          toolName?: string;
          result?: unknown;
          durationMs?: number;
          error?: string;
          // File tool specific
          filePath?: string;
          operation?: string;
          beforeHash?: string;
          afterHash?: string;
          // Command tool specific
          command?: string;
          exitCode?: number;
          stdout?: string;
          stderr?: string;
          workingDir?: string;
        };

        if (!ctx.actionId) return;

        try {
          // Complete the action
          await state.receiptCollector.completeAction(
            ctx.actionId,
            ctx.result,
            ctx.durationMs ?? 0,
            ctx.error
          );

          // Create file receipt if applicable
          if (ctx.filePath && ctx.operation) {
            await state.receiptCollector.createFileReceipt({
              actionId: ctx.actionId,
              filePath: ctx.filePath,
              operation: ctx.operation as "create" | "modify" | "delete" | "read",
              beforeHash: ctx.beforeHash,
              afterHash: ctx.afterHash,
            });
          }

          // Create command receipt if applicable
          if (ctx.command !== undefined) {
            await state.receiptCollector.createCommandReceipt({
              actionId: ctx.actionId,
              command: ctx.command,
              exitCode: ctx.exitCode ?? null,
              stdout: ctx.stdout ?? "",
              stderr: ctx.stderr ?? "",
              durationMs: ctx.durationMs ?? 0,
              workingDir: ctx.workingDir,
            });
          }
        } catch (error) {
          console.error("[veridic-claw] Error completing action:", error);
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
     * Get direct access to the MemoryBridge
     *
     * Allows reading/writing to the 3-layer memory system.
     *
     * @returns MemoryBridge instance or null if not initialized
     */
    getMemoryBridge(): MemoryBridge | null {
      return state?.memoryBridge ?? null;
    },

    /**
     * Get direct access to the LosslessBridge
     *
     * Allows reading/writing messages and context assembly.
     *
     * @returns LosslessBridge instance or null if not initialized
     */
    getLosslessBridge(): LosslessBridge | null {
      return state?.losslessBridge ?? null;
    },

    /**
     * Get direct access to the ReceiptCollector
     *
     * Allows manual receipt creation and querying.
     *
     * @returns ReceiptCollector instance or null if not initialized
     */
    getReceiptCollector(): ReceiptCollector | null {
      return state?.receiptCollector ?? null;
    },

    /**
     * Get direct access to the RetryManager
     *
     * Allows configuring retry behavior and setting callbacks.
     *
     * @returns RetryManager instance or null if not initialized
     */
    getRetryManager(): RetryManager | null {
      return state?.retryManager ?? null;
    },

    /**
     * Set the retry executor callback
     *
     * This callback is called when a contradiction is detected and retry is needed.
     * The callback should send the retry prompt to the agent and return the response.
     *
     * @param executor - Callback function that executes retry
     */
    setRetryExecutor(executor: RetryExecutor): void {
      if (state?.retryManager) {
        state.retryManager.setRetryExecutor(executor);
      }
    },

    /**
     * Set the user notifier callback
     *
     * This callback is called when retry fails and user needs to be notified.
     *
     * @param notifier - Callback function that notifies user
     */
    setUserNotifier(notifier: UserNotifier): void {
      if (state?.retryManager) {
        state.retryManager.setUserNotifier(notifier);
      }
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
