import type { LLMApi } from "../types.js";
import type { Database } from "../core/database.js";
import { MessageStore } from "../store/message-store.js";
import { SummaryStore } from "../store/summary-store.js";

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  id?: string;
  timestamp?: Date;
}

export interface AssembledContext {
  messages: Message[];
  tokenCount: number;
  summary?: string;
  metadata: {
    rawMessageCount: number;
    summarizedChunks: number;
  };
}

export interface LosslessBridgeConfig {
  maxTokens: number;
  recentMessageCount: number;
}

export const DEFAULT_LOSSLESS_BRIDGE_CONFIG: LosslessBridgeConfig = {
  maxTokens: 8000,
  recentMessageCount: 10,
};

/**
 * LosslessBridge - Context management with persistent storage
 *
 * Manages conversation context with:
 * - Persistent message storage (survives restarts)
 * - DAG summarization for old messages
 * - Token-aware context assembly
 * - Verification context integration
 */
export class LosslessBridge {
  private config: LosslessBridgeConfig;
  private db: Database | null = null;
  private messageStore: MessageStore | null = null;
  private summaryStore: SummaryStore | null = null;
  private llmApi: LLMApi | null = null;

  // Fallback in-memory cache (used when db not provided)
  private memoryMessageStore: Map<string, Message[]> = new Map();
  private memorySummaryStore: Map<string, string[]> = new Map();

  constructor(config: Partial<LosslessBridgeConfig> = {}) {
    this.config = { ...DEFAULT_LOSSLESS_BRIDGE_CONFIG, ...config };
  }

  /**
   * Initialize with database for persistent storage
   */
  setDatabase(db: Database): void {
    this.db = db;
    this.messageStore = new MessageStore(db);
    this.summaryStore = new SummaryStore(db);
  }

  /**
   * Set LLM API for better summarization
   */
  setLLMApi(api: LLMApi): void {
    this.llmApi = api;
  }

  async ingestMessage(sessionId: string, message: Message): Promise<void> {
    if (this.messageStore && this.db) {
      // Persistent storage
      await this.messageStore.create(
        sessionId,
        message.role,
        message.content,
        message.id
      );
      await this.maybeSummarize(sessionId);
    } else {
      // Fallback to in-memory
      const messages = this.memoryMessageStore.get(sessionId) ?? [];
      messages.push({
        ...message,
        timestamp: message.timestamp ?? new Date(),
      });
      this.memoryMessageStore.set(sessionId, messages);
      await this.maybeSummarizeInMemory(sessionId);
    }
  }

  async assembleContext(sessionId: string): Promise<AssembledContext> {
    let messages: Message[];
    let summaries: string[];

    if (this.messageStore && this.summaryStore) {
      // Load from persistent storage
      const storedMessages = await this.messageStore.getBySession(sessionId);
      messages = storedMessages.map(m => ({
        role: m.role,
        content: m.content,
        id: m.message_id,
        timestamp: m.created_at,
      }));

      const storedSummaries = await this.summaryStore.getBySession(sessionId);
      summaries = storedSummaries.map(s => s.content);
    } else {
      // Fallback to in-memory
      messages = this.memoryMessageStore.get(sessionId) ?? [];
      summaries = this.memorySummaryStore.get(sessionId) ?? [];
    }

    const recentMessages = messages.slice(-this.config.recentMessageCount);
    const olderMessages = messages.slice(0, -this.config.recentMessageCount);

    let summary: string | undefined;
    if (olderMessages.length > 0 && summaries.length === 0) {
      summary = await this.createSummary(olderMessages);
    }

    const assembledMessages: Message[] = [];

    if (summaries.length > 0) {
      const combinedSummary = summaries.join("\n\n---\n\n");
      assembledMessages.push({
        role: "system",
        content: `## Previous Context Summary\n\n${combinedSummary}`,
      });
    }

    assembledMessages.push(...recentMessages);

    const totalChars = assembledMessages
      .map(m => m.content.length)
      .reduce((a, b) => a + b, 0);
    const tokenCount = Math.ceil(totalChars / 4);

    return {
      messages: assembledMessages,
      tokenCount,
      summary: summaries.length > 0 ? summaries[summaries.length - 1] : summary,
      metadata: {
        rawMessageCount: recentMessages.length,
        summarizedChunks: summaries.length,
      },
    };
  }

  async search(sessionId: string, query: string, limit = 10): Promise<Message[]> {
    if (this.messageStore) {
      const results = await this.messageStore.search(sessionId, query, limit);
      return results.map(m => ({
        role: m.role,
        content: m.content,
        id: m.message_id,
        timestamp: m.created_at,
      }));
    }

    // Fallback to in-memory
    const messages = this.memoryMessageStore.get(sessionId) ?? [];
    const queryLower = query.toLowerCase();
    return messages
      .filter(m => m.content.toLowerCase().includes(queryLower))
      .slice(-limit);
  }

  async describe(sessionId: string, chunkIndex: number): Promise<string | null> {
    if (this.summaryStore) {
      const summary = await this.summaryStore.getByChunkIndex(sessionId, chunkIndex);
      return summary?.content ?? null;
    }

    // Fallback to in-memory
    const summaries = this.memorySummaryStore.get(sessionId) ?? [];
    return summaries[chunkIndex] ?? null;
  }

  async expand(sessionId: string, query: string): Promise<Message[]> {
    return this.search(sessionId, query);
  }

  async clearSession(sessionId: string): Promise<void> {
    if (this.messageStore && this.summaryStore) {
      await this.messageStore.clearSession(sessionId);
      await this.summaryStore.clearSession(sessionId);
    }

    // Also clear in-memory
    this.memoryMessageStore.delete(sessionId);
    this.memorySummaryStore.delete(sessionId);
  }

  async getMessageCount(sessionId: string): Promise<number> {
    if (this.messageStore) {
      return this.messageStore.count(sessionId);
    }
    return this.memoryMessageStore.get(sessionId)?.length ?? 0;
  }

  /**
   * Check if summarization is needed and perform it (persistent storage)
   */
  private async maybeSummarize(sessionId: string): Promise<void> {
    if (!this.messageStore || !this.summaryStore) {
      return;
    }

    const messageCount = await this.messageStore.count(sessionId);
    const summarizationThreshold = this.config.recentMessageCount * 2;

    if (messageCount > summarizationThreshold) {
      // Get messages to summarize
      const allMessages = await this.messageStore.getBySession(sessionId);
      const toSummarize = allMessages.slice(0, -this.config.recentMessageCount);

      if (toSummarize.length === 0) return;

      // Convert to Message format
      const messagesToSummarize: Message[] = toSummarize.map(m => ({
        role: m.role,
        content: m.content,
        id: m.message_id,
        timestamp: m.created_at,
      }));

      // Create summary
      const summaryContent = await this.createSummary(messagesToSummarize);
      const chunkIndex = await this.summaryStore.getLatestChunkIndex(sessionId) + 1;

      // Store summary
      await this.summaryStore.create(
        sessionId,
        chunkIndex,
        summaryContent,
        toSummarize.length,
        toSummarize[0]?.message_id,
        toSummarize[toSummarize.length - 1]?.message_id
      );

      // Delete old messages (keep recent only)
      await this.messageStore.deleteOld(sessionId, this.config.recentMessageCount);
    }
  }

  /**
   * Check if summarization is needed (in-memory fallback)
   */
  private async maybeSummarizeInMemory(sessionId: string): Promise<void> {
    const messages = this.memoryMessageStore.get(sessionId) ?? [];
    const summaries = this.memorySummaryStore.get(sessionId) ?? [];
    const summarizationThreshold = this.config.recentMessageCount * 2;

    if (messages.length > summarizationThreshold) {
      const toSummarize = messages.slice(0, -this.config.recentMessageCount);
      const summary = await this.createSummary(toSummarize);
      summaries.push(summary);
      this.memorySummaryStore.set(sessionId, summaries);
      this.memoryMessageStore.set(
        sessionId,
        messages.slice(-this.config.recentMessageCount)
      );
    }
  }

  /**
   * Create a summary using LLM if available, otherwise quick summary
   */
  private async createSummary(messages: Message[]): Promise<string> {
    if (this.llmApi) {
      return this.createLLMSummary(messages);
    }
    return this.createQuickSummary(messages);
  }

  /**
   * Create summary using LLM
   */
  private async createLLMSummary(messages: Message[]): Promise<string> {
    const prompt = `Summarize this conversation concisely (keep: decisions, actions, files, commands):

${messages.map(m => `[${m.role}]: ${m.content.slice(0, 500)}`).join('\n\n')}

Summary:`;

    try {
      const response = await this.llmApi!.complete({
        messages: [{ role: "user", content: prompt }],
        maxTokens: 500,
      });
      return response.content;
    } catch {
      return this.createQuickSummary(messages);
    }
  }

  private createQuickSummary(messages: Message[]): string {
    const userMessages = messages.filter(m => m.role === "user");
    const assistantMessages = messages.filter(m => m.role === "assistant");

    const userSnippets = userMessages
      .slice(-3)
      .map(m => `- User: ${m.content.slice(0, 100)}...`)
      .join("\n");

    const assistantSnippets = assistantMessages
      .slice(-3)
      .map(m => `- Assistant: ${m.content.slice(0, 100)}...`)
      .join("\n");

    return `[Chunk of ${messages.length} messages]\n\nUser requests:\n${userSnippets}\n\nAssistant responses:\n${assistantSnippets}`;
  }

}

/**
 * Create a LosslessBridge instance
 *
 * @param config - Optional configuration
 * @returns LosslessBridge instance (call setDatabase() for persistence)
 */
export function createLosslessBridge(config?: Partial<LosslessBridgeConfig>): LosslessBridge {
  return new LosslessBridge(config);
}

/**
 * Create a LosslessBridge with database for persistent storage
 *
 * @param db - Database instance
 * @param config - Optional configuration
 * @returns LosslessBridge instance with persistence enabled
 */
export function createPersistentLosslessBridge(
  db: Database,
  config?: Partial<LosslessBridgeConfig>
): LosslessBridge {
  const bridge = new LosslessBridge(config);
  bridge.setDatabase(db);
  return bridge;
}
