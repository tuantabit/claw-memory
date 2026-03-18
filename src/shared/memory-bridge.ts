import type { Verification, Claim, TrustScore } from "../types.js";
import type { Database } from "../core/database.js";
import { MemoryStore } from "../store/memory-store.js";

export enum DecayLevel {
  FULL = 0,
  SUMMARY = 1,
  ESSENCE = 2,
  HASH = 3,
}

export type MemoryLayerName = "short-term" | "long-term" | "digest";
export type MemoryEntryType = "event" | "task" | "decision" | "summary" | "note" | "verification";

export interface MemoryEntry {
  id: string;
  content: string;
  type: MemoryEntryType;
  layer: MemoryLayerName;
  sessionId?: string;
  taskId?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  accessedAt: Date;
  accessCount: number;
  decayLevel: DecayLevel;
  importance: number;
  hash?: string;
}

export interface MemorySearchOptions {
  limit?: number;
  type?: MemoryEntryType;
  sessionId?: string;
  taskId?: string;
  minImportance?: number;
  maxDecayLevel?: DecayLevel;
}

export interface MemoryBridgeConfig {
  defaultImportance: number;
  contradictionImportance: number;
  verifiedImportance: number;
  unverifiedImportance: number;
  maxEntriesPerSession: number;
}

export const DEFAULT_MEMORY_BRIDGE_CONFIG: MemoryBridgeConfig = {
  defaultImportance: 0.5,
  contradictionImportance: 0.95,
  verifiedImportance: 0.4,
  unverifiedImportance: 0.3,
  maxEntriesPerSession: 1000,
};

export interface MemoryProvider {
  remember(entry: Omit<MemoryEntry, "id" | "createdAt" | "accessedAt" | "accessCount">): Promise<string>;
  recall(query: string, options?: MemorySearchOptions): Promise<MemoryEntry[]>;
  get(id: string): Promise<MemoryEntry | null>;
  forget(id: string): Promise<boolean>;
  touch(id: string): Promise<void>;
}

/**
 * MemoryBridge - 3-layer memory system with persistent storage
 *
 * Manages agent memory with:
 * - Short-term: Recent events (24h, 1000 entries)
 * - Long-term: Important patterns (30d, 10000 entries)
 * - Digest: Permanent compressed summaries
 *
 * Uses MemoryStore for persistence, falling back to in-memory
 * when database is not provided.
 */
export class MemoryBridge {
  private config: MemoryBridgeConfig;
  private db: Database | null = null;
  private store: MemoryStore | null = null;
  private provider: MemoryProvider | null = null;

  // Fallback in-memory store
  private localStore: Map<string, MemoryEntry[]> = new Map();

  constructor(config: Partial<MemoryBridgeConfig> = {}) {
    this.config = { ...DEFAULT_MEMORY_BRIDGE_CONFIG, ...config };
  }

  /**
   * Initialize with database for persistent storage
   */
  setDatabase(db: Database): void {
    this.db = db;
    this.store = new MemoryStore(db);
    // Also set store as provider
    this.provider = this.store;
  }

  /**
   * Set a custom memory provider (overrides database store)
   */
  setProvider(provider: MemoryProvider): void {
    this.provider = provider;
  }

  /**
   * Get the underlying MemoryStore (if database is set)
   */
  getStore(): MemoryStore | null {
    return this.store;
  }

  async storeVerification(
    verification: Verification,
    claim: Claim,
    trustScore?: TrustScore
  ): Promise<string | null> {
    const importance = this.calculateImportance(verification.status);
    const content = this.formatVerificationContent(verification, claim);

    const entry: Omit<MemoryEntry, "id" | "createdAt" | "accessedAt" | "accessCount"> = {
      content,
      type: "verification",
      layer: importance >= 0.8 ? "long-term" : "short-term",
      sessionId: claim.session_id,
      taskId: claim.task_id ?? undefined,
      metadata: {
        verificationId: verification.verification_id,
        claimId: claim.claim_id,
        claimType: claim.claim_type,
        status: verification.status,
        confidence: verification.confidence,
        trustScore: trustScore?.overall_score,
      },
      decayLevel: DecayLevel.FULL,
      importance,
    };

    if (this.provider) {
      return this.provider.remember(entry);
    }

    return this.storeLocal(claim.session_id, entry);
  }

  async recallVerifications(
    sessionId: string,
    options: MemorySearchOptions = {}
  ): Promise<MemoryEntry[]> {
    const searchOptions: MemorySearchOptions = {
      ...options,
      sessionId,
      type: "verification",
    };

    if (this.provider) {
      return this.provider.recall("verification", searchOptions);
    }

    return this.recallLocal(sessionId, searchOptions);
  }

  async recallContradictions(sessionId: string, limit = 10): Promise<MemoryEntry[]> {
    const verifications = await this.recallVerifications(sessionId, {
      minImportance: 0.8,
      limit: limit * 2,
    });

    return verifications
      .filter(e => (e.metadata.status as string) === "contradicted")
      .slice(0, limit);
  }

  async buildContextFromMemory(
    sessionId: string,
    maxTokens = 2000
  ): Promise<string> {
    const memories = await this.recallVerifications(sessionId, {
      minImportance: 0.3,
      limit: 50,
    });

    if (memories.length === 0) {
      return "";
    }

    const lines: string[] = [];
    let tokenEstimate = 0;
    const tokensPerChar = 0.25;

    const sorted = memories.sort((a, b) => b.importance - a.importance);

    for (const memory of sorted) {
      const line = this.formatMemoryLine(memory);
      const lineTokens = Math.ceil(line.length * tokensPerChar);

      if (tokenEstimate + lineTokens > maxTokens) {
        break;
      }

      lines.push(line);
      tokenEstimate += lineTokens;
    }

    return lines.join("\n");
  }

  async getStats(sessionId: string): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byLayer: Record<string, number>;
    averageImportance: number;
  }> {
    const entries = this.provider
      ? await this.provider.recall("", { sessionId, limit: 1000 })
      : this.localStore.get(sessionId) ?? [];

    const verifications = entries.filter(e => e.type === "verification");

    const byStatus: Record<string, number> = {};
    const byLayer: Record<string, number> = {};
    let totalImportance = 0;

    for (const entry of verifications) {
      const status = (entry.metadata.status as string) ?? "unknown";
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      byLayer[entry.layer] = (byLayer[entry.layer] ?? 0) + 1;
      totalImportance += entry.importance;
    }

    return {
      total: verifications.length,
      byStatus,
      byLayer,
      averageImportance: verifications.length > 0 ? totalImportance / verifications.length : 0,
    };
  }

  private calculateImportance(status: string): number {
    switch (status) {
      case "contradicted":
        return this.config.contradictionImportance;
      case "verified":
        return this.config.verifiedImportance;
      case "unverified":
        return this.config.unverifiedImportance;
      default:
        return this.config.defaultImportance;
    }
  }

  private formatVerificationContent(verification: Verification, claim: Claim): string {
    const statusIcon = verification.status === "verified" ? "[OK]" :
                       verification.status === "contradicted" ? "[FAIL]" : "[?]";
    return `${statusIcon} ${claim.claim_type}: "${claim.original_text}" - ${verification.details}`;
  }

  private formatMemoryLine(memory: MemoryEntry): string {
    const status = memory.metadata.status as string;
    const importance = memory.importance.toFixed(2);
    return `[${status}|${importance}] ${memory.content}`;
  }

  private storeLocal(
    sessionId: string,
    entry: Omit<MemoryEntry, "id" | "createdAt" | "accessedAt" | "accessCount">
  ): string {
    const entries = this.localStore.get(sessionId) ?? [];
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const fullEntry: MemoryEntry = {
      ...entry,
      id,
      createdAt: new Date(),
      accessedAt: new Date(),
      accessCount: 0,
    };

    entries.push(fullEntry);

    if (entries.length > this.config.maxEntriesPerSession) {
      entries.sort((a, b) => a.importance - b.importance);
      entries.splice(0, entries.length - this.config.maxEntriesPerSession);
    }

    this.localStore.set(sessionId, entries);
    return id;
  }

  private recallLocal(sessionId: string, options: MemorySearchOptions): MemoryEntry[] {
    let entries = this.localStore.get(sessionId) ?? [];

    if (options.type) {
      entries = entries.filter(e => e.type === options.type);
    }

    if (options.minImportance !== undefined) {
      entries = entries.filter(e => e.importance >= options.minImportance!);
    }

    if (options.maxDecayLevel !== undefined) {
      entries = entries.filter(e => e.decayLevel <= options.maxDecayLevel!);
    }

    entries.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return entries.slice(0, options.limit ?? 20);
  }
}

/**
 * Create a MemoryBridge instance
 *
 * @param config - Optional configuration
 * @returns MemoryBridge instance (call setDatabase() for persistence)
 */
export function createMemoryBridge(config?: Partial<MemoryBridgeConfig>): MemoryBridge {
  return new MemoryBridge(config);
}

/**
 * Create a MemoryBridge with database for persistent storage
 *
 * @param db - Database instance
 * @param config - Optional configuration
 * @returns MemoryBridge instance with persistence enabled
 */
export function createPersistentMemoryBridge(
  db: Database,
  config?: Partial<MemoryBridgeConfig>
): MemoryBridge {
  const bridge = new MemoryBridge(config);
  bridge.setDatabase(db);
  return bridge;
}
