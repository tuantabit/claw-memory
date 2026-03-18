/**
 * Store Module - Data persistence layer for Veridic
 *
 * This module provides organized access to all database stores:
 * - ClaimStore: Store and query agent claims
 * - EvidenceStore: Store and query evidence for claims
 * - VerificationStore: Store and query verification results
 * - TrustScoreStore: Store and query trust score history
 * - MessageStore: Store and query conversation messages
 * - SummaryStore: Store and query DAG summaries
 * - MemoryStore: Store and query memory entries
 * - ReceiptStore: Store and query action receipts
 *
 * @example
 * ```typescript
 * import { createStores } from "./store/index.js";
 *
 * const stores = createStores(db);
 *
 * // Create and query claims
 * const claim = await stores.claims.create(sessionId, "file_created", ...);
 * const claims = await stores.claims.getBySession(sessionId);
 *
 * // Get trust score
 * const score = await stores.trustScores.getLatest(sessionId);
 *
 * // Store and recall memories
 * await stores.memories.remember({ content: "...", type: "decision", ... });
 * const memories = await stores.memories.recall("search term");
 *
 * // Track actions and receipts
 * const actionId = await stores.receipts.createAction(sessionId, "Edit", input);
 * await stores.receipts.createFileReceipt(actionId, filePath, "modify", ...);
 * ```
 */

export { ClaimStore } from "./claim-store.js";
export { EvidenceStore } from "./evidence-store.js";
export { VerificationStore } from "./verification-store.js";
export { TrustScoreStore } from "./trust-score-store.js";
export { MessageStore } from "./message-store.js";
export { SummaryStore } from "./summary-store.js";
export { MemoryStore } from "./memory-store.js";
export { ReceiptStore } from "./receipt-store.js";

import type { Database } from "../core/database.js";
import { ClaimStore } from "./claim-store.js";
import { EvidenceStore } from "./evidence-store.js";
import { VerificationStore } from "./verification-store.js";
import { TrustScoreStore } from "./trust-score-store.js";
import { MessageStore } from "./message-store.js";
import { SummaryStore } from "./summary-store.js";
import { MemoryStore } from "./memory-store.js";
import { ReceiptStore } from "./receipt-store.js";

/**
 * Collection of all Veridic data stores
 *
 * Provides unified access to all persistence operations.
 * Each store handles a specific entity type and provides
 * CRUD operations plus specialized queries.
 */
export interface VeridicStores {
  /** Store for agent claims (what the agent says it did) */
  claims: ClaimStore;

  /** Store for evidence collected to verify claims */
  evidence: EvidenceStore;

  /** Store for verification results (verified/contradicted) */
  verifications: VerificationStore;

  /** Store for trust score history and trends */
  trustScores: TrustScoreStore;

  /** Store for conversation messages (LosslessBridge) */
  messages: MessageStore;

  /** Store for DAG summaries (LosslessBridge) */
  summaries: SummaryStore;

  /** Store for memory entries (MemoryBridge) */
  memories: MemoryStore;

  /** Store for action receipts (verification evidence) */
  receipts: ReceiptStore;
}

/**
 * Create all Veridic stores with a shared database connection
 *
 * @param db - Database instance to use for all stores
 * @returns Object containing all initialized stores
 *
 * @example
 * ```typescript
 * const db = createDatabase(":memory:");
 * const stores = createStores(db);
 * ```
 */
export function createStores(db: Database): VeridicStores {
  return {
    claims: new ClaimStore(db),
    evidence: new EvidenceStore(db),
    verifications: new VerificationStore(db),
    trustScores: new TrustScoreStore(db),
    messages: new MessageStore(db),
    summaries: new SummaryStore(db),
    memories: new MemoryStore(db),
    receipts: new ReceiptStore(db),
  };
}
