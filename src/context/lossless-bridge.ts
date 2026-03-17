import type { TrustContext } from "../types.js";

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
  verificationContext?: string;
  trustWarning?: string;
  metadata: {
    rawMessageCount: number;
    summarizedChunks: number;
    verificationEvents: number;
  };
}

export interface LosslessBridgeConfig {
  maxTokens: number;
  recentMessageCount: number;
  includeVerifications: boolean;
  trustWarningThreshold: number;
}

export const DEFAULT_LOSSLESS_BRIDGE_CONFIG: LosslessBridgeConfig = {
  maxTokens: 8000,
  recentMessageCount: 10,
  includeVerifications: true,
  trustWarningThreshold: 70,
};

export class LosslessBridge {
  private config: LosslessBridgeConfig;
  private messageStore: Map<string, Message[]> = new Map();
  private summaryStore: Map<string, string[]> = new Map();

  constructor(config: Partial<LosslessBridgeConfig> = {}) {
    this.config = { ...DEFAULT_LOSSLESS_BRIDGE_CONFIG, ...config };
  }

  async ingestMessage(sessionId: string, message: Message): Promise<void> {
    const messages = this.messageStore.get(sessionId) ?? [];
    messages.push({
      ...message,
      timestamp: message.timestamp ?? new Date(),
    });
    this.messageStore.set(sessionId, messages);
    await this.maybeSummarize(sessionId);
  }

  async assembleContext(
    sessionId: string,
    trustContext?: TrustContext
  ): Promise<AssembledContext> {
    const messages = this.messageStore.get(sessionId) ?? [];
    const summaries = this.summaryStore.get(sessionId) ?? [];

    const recentMessages = messages.slice(-this.config.recentMessageCount);
    const olderMessages = messages.slice(0, -this.config.recentMessageCount);

    let summary: string | undefined;
    if (olderMessages.length > 0) {
      summary = this.createQuickSummary(olderMessages);
      if (!summaries.includes(summary)) {
        summaries.push(summary);
        this.summaryStore.set(sessionId, summaries);
      }
    }

    const assembledMessages: Message[] = [];

    if (summaries.length > 0) {
      const combinedSummary = summaries.join("\n\n---\n\n");
      assembledMessages.push({
        role: "system",
        content: `## Previous Context Summary\n\n${combinedSummary}`,
      });
    }

    let verificationContext: string | undefined;
    if (this.config.includeVerifications && trustContext) {
      verificationContext = this.formatVerificationContext(trustContext);
      if (verificationContext) {
        assembledMessages.push({
          role: "system",
          content: verificationContext,
        });
      }
    }

    assembledMessages.push(...recentMessages);

    let trustWarning: string | undefined;
    if (trustContext && trustContext.current_score < this.config.trustWarningThreshold) {
      trustWarning = trustContext.warning_message ??
        `Trust Score: ${trustContext.current_score.toFixed(0)}%`;
    }

    const totalChars = assembledMessages
      .map(m => m.content.length)
      .reduce((a, b) => a + b, 0);
    const tokenCount = Math.ceil(totalChars / 4);

    return {
      messages: assembledMessages,
      tokenCount,
      summary: summaries.length > 0 ? summaries[summaries.length - 1] : undefined,
      verificationContext,
      trustWarning,
      metadata: {
        rawMessageCount: recentMessages.length,
        summarizedChunks: summaries.length,
        verificationEvents: trustContext?.recent_issues.length ?? 0,
      },
    };
  }

  async search(sessionId: string, query: string, limit = 10): Promise<Message[]> {
    const messages = this.messageStore.get(sessionId) ?? [];
    const queryLower = query.toLowerCase();
    return messages
      .filter(m => m.content.toLowerCase().includes(queryLower))
      .slice(-limit);
  }

  async describe(sessionId: string, chunkIndex: number): Promise<string | null> {
    const summaries = this.summaryStore.get(sessionId) ?? [];
    return summaries[chunkIndex] ?? null;
  }

  async expand(sessionId: string, query: string): Promise<Message[]> {
    return this.search(sessionId, query);
  }

  async clearSession(sessionId: string): Promise<void> {
    this.messageStore.delete(sessionId);
    this.summaryStore.delete(sessionId);
  }

  getMessageCount(sessionId: string): number {
    return this.messageStore.get(sessionId)?.length ?? 0;
  }

  private async maybeSummarize(sessionId: string): Promise<void> {
    const messages = this.messageStore.get(sessionId) ?? [];
    const summaries = this.summaryStore.get(sessionId) ?? [];
    const summarizationThreshold = this.config.recentMessageCount * 2;

    if (messages.length > summarizationThreshold) {
      const toSummarize = messages.slice(0, -this.config.recentMessageCount);
      const summary = this.createQuickSummary(toSummarize);
      summaries.push(summary);
      this.summaryStore.set(sessionId, summaries);
      this.messageStore.set(
        sessionId,
        messages.slice(-this.config.recentMessageCount)
      );
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

  private formatVerificationContext(trustContext: TrustContext): string | undefined {
    if (trustContext.recent_issues.length === 0) {
      return undefined;
    }

    const issueLines = trustContext.recent_issues.map(issue =>
      `- [${issue.severity.toUpperCase()}] ${issue.claim_type}: "${issue.claim_text}" -> ${issue.status}`
    );

    return `## Verification Status\n\nTrust Score: ${trustContext.current_score.toFixed(0)}%\n\nRecent Issues:\n${issueLines.join("\n")}`.trim();
  }
}

export function createLosslessBridge(config?: Partial<LosslessBridgeConfig>): LosslessBridge {
  return new LosslessBridge(config);
}
