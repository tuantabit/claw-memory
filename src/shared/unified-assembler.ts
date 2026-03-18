import type { TrustContext, TrustIssue } from "../types.js";
import type { Message, AssembledContext } from "../context/lossless-bridge.js";
import { LosslessBridge } from "../context/lossless-bridge.js";
import { MemoryBridge } from "./memory-bridge.js";

export interface UnifiedAssemblerConfig {
  maxTokens: number;
  recentMessageCount: number;
  includeVerifications: boolean;
  includeMemories: boolean;
  trustWarningThreshold: number;
  memoryTokenBudget: number;
}

export const DEFAULT_UNIFIED_ASSEMBLER_CONFIG: UnifiedAssemblerConfig = {
  maxTokens: 8000,
  recentMessageCount: 10,
  includeVerifications: true,
  includeMemories: true,
  trustWarningThreshold: 70,
  memoryTokenBudget: 1000,
};

export interface UnifiedContext extends AssembledContext {
  memoryContext?: string;
  contradictions?: TrustIssue[];
  contextSources: {
    lossless: boolean;
    memory: boolean;
    verification: boolean;
  };
}

export class UnifiedAssembler {
  private config: UnifiedAssemblerConfig;
  private losslessBridge: LosslessBridge;
  private memoryBridge: MemoryBridge;

  constructor(
    losslessBridge: LosslessBridge,
    memoryBridge: MemoryBridge,
    config: Partial<UnifiedAssemblerConfig> = {}
  ) {
    this.config = { ...DEFAULT_UNIFIED_ASSEMBLER_CONFIG, ...config };
    this.losslessBridge = losslessBridge;
    this.memoryBridge = memoryBridge;
  }

  async assemble(
    sessionId: string,
    trustContext?: TrustContext
  ): Promise<UnifiedContext> {
    const losslessContext = await this.losslessBridge.assembleContext(
      sessionId,
      trustContext
    );

    let memoryContext: string | undefined;
    if (this.config.includeMemories) {
      memoryContext = await this.memoryBridge.buildContextFromMemory(
        sessionId,
        this.config.memoryTokenBudget
      );
    }

    const contradictions = trustContext?.recent_issues.filter(
      issue => issue.status === "contradicted"
    );

    const messages = [...losslessContext.messages];

    if (memoryContext && memoryContext.length > 0) {
      const memorySystemMessage: Message = {
        role: "system",
        content: this.formatMemoryContext(memoryContext),
      };

      const firstUserIndex = messages.findIndex(m => m.role === "user");
      if (firstUserIndex > 0) {
        messages.splice(firstUserIndex, 0, memorySystemMessage);
      } else {
        messages.unshift(memorySystemMessage);
      }
    }

    if (contradictions && contradictions.length > 0) {
      const warningMessage: Message = {
        role: "system",
        content: this.formatContradictionWarning(contradictions),
      };
      messages.unshift(warningMessage);
    }

    const totalChars = messages.map(m => m.content.length).reduce((a, b) => a + b, 0);
    const tokenCount = Math.ceil(totalChars / 4);

    return {
      ...losslessContext,
      messages,
      tokenCount,
      memoryContext,
      contradictions,
      contextSources: {
        lossless: losslessContext.summary !== undefined || losslessContext.metadata.rawMessageCount > 0,
        memory: !!memoryContext && memoryContext.length > 0,
        verification: !!trustContext && trustContext.recent_issues.length > 0,
      },
    };
  }

  async ingestMessage(sessionId: string, message: Message): Promise<void> {
    await this.losslessBridge.ingestMessage(sessionId, message);
  }

  async search(sessionId: string, query: string, limit = 10): Promise<Message[]> {
    return this.losslessBridge.search(sessionId, query, limit);
  }

  async getContextStats(sessionId: string): Promise<{
    messageCount: number;
    memoryStats: {
      total: number;
      byStatus: Record<string, number>;
      averageImportance: number;
    };
  }> {
    const messageCount = await this.losslessBridge.getMessageCount(sessionId);
    const memoryStats = await this.memoryBridge.getStats(sessionId);

    return {
      messageCount,
      memoryStats: {
        total: memoryStats.total,
        byStatus: memoryStats.byStatus,
        averageImportance: memoryStats.averageImportance,
      },
    };
  }

  estimateTokens(context: UnifiedContext): number {
    return context.tokenCount;
  }

  async trimToTokenBudget(
    context: UnifiedContext,
    maxTokens: number
  ): Promise<UnifiedContext> {
    if (context.tokenCount <= maxTokens) {
      return context;
    }

    const messages = [...context.messages];
    let tokenCount = context.tokenCount;

    while (tokenCount > maxTokens && messages.length > 2) {
      const systemMessages = messages.filter(m => m.role === "system");
      const nonSystemMessages = messages.filter(m => m.role !== "system");

      if (nonSystemMessages.length > 2) {
        const removed = nonSystemMessages.shift();
        if (removed) {
          const removedTokens = Math.ceil(removed.content.length / 4);
          tokenCount -= removedTokens;
          messages.length = 0;
          messages.push(...systemMessages, ...nonSystemMessages);
        }
      } else if (systemMessages.length > 1) {
        const sortedSystem = systemMessages.sort((a, b) => a.content.length - b.content.length);
        const removed = sortedSystem.shift();
        if (removed) {
          const removedTokens = Math.ceil(removed.content.length / 4);
          tokenCount -= removedTokens;
          messages.length = 0;
          const remainingSystem = systemMessages.filter(m => m !== removed);
          messages.push(...remainingSystem, ...nonSystemMessages);
        }
      } else {
        break;
      }
    }

    return {
      ...context,
      messages,
      tokenCount,
    };
  }

  private formatMemoryContext(memoryContext: string): string {
    return `## Relevant Memory\n\n${memoryContext}`;
  }

  private formatContradictionWarning(contradictions: TrustIssue[]): string {
    const lines = contradictions.map(c =>
      `- [${c.severity.toUpperCase()}] ${c.claim_type}: "${c.claim_text}"`
    );
    return `## Warning: Previous Contradictions Detected\n\n${lines.join("\n")}`;
  }
}

export function createUnifiedAssembler(
  losslessBridge: LosslessBridge,
  memoryBridge: MemoryBridge,
  config?: Partial<UnifiedAssemblerConfig>
): UnifiedAssembler {
  return new UnifiedAssembler(losslessBridge, memoryBridge, config);
}
