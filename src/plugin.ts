
import type { Database } from "./core/database.js";
import type { VeridicConfig, LLMApi } from "./types.js";
import { VeridicEngine, createVeridicEngine } from "./engine.js";
import { createVeridicTools } from "./tools/index.js";
import { resolveConfig } from "./config.js";

interface PluginState {
  engine: VeridicEngine;
  initialized: boolean;
}

let state: PluginState | null = null;

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

function extractResponseId(context: unknown): string | null {
  if (!context || typeof context !== "object") {
    return null;
  }

  const ctx = context as { responseId?: string; response_id?: string };
  return ctx.responseId ?? ctx.response_id ?? null;
}

function extractSessionId(context: unknown): string | null {
  if (!context || typeof context !== "object") {
    return null;
  }

  const ctx = context as { sessionId?: string; session_id?: string };
  return ctx.sessionId ?? ctx.session_id ?? null;
}

function extractTaskId(context: unknown): string | null {
  if (!context || typeof context !== "object") {
    return null;
  }

  const ctx = context as { taskId?: string; task_id?: string };
  return ctx.taskId ?? ctx.task_id ?? null;
}

function extractLLMApi(context: unknown): LLMApi | undefined {
  if (!context || typeof context !== "object") {
    return undefined;
  }

  const ctx = context as { llmApi?: LLMApi };
  return ctx.llmApi;
}

export function createVeridicPlugin(db: Database, config?: Partial<VeridicConfig>) {
  const resolvedConfig = resolveConfig(config);

  return {
    id: "veridic-claw",
    name: "Veridic Claw",
    description: "Verify agent claims - detect when agents lie about their actions",

    
    hooks: {
      
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

    
    getEngine(): VeridicEngine | null {
      return state?.engine ?? null;
    },

    
    async shutdown() {
      state = null;
    },
  };
}

export default createVeridicPlugin;
