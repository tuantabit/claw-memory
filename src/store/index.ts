/**
 * Store Module - Data persistence layer for Veridic
 *
 * This module provides organized access to all database stores:
 * - ClaimStore: Store and query agent claims
 * - EvidenceStore: Store and query evidence for claims
 * - VerificationStore: Store and query verification results
 * - TrustScoreStore: Store and query trust score history
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
 * ```
 */

export { ClaimStore } from "./claim-store.js";
export { EvidenceStore } from "./evidence-store.js";
export { VerificationStore } from "./verification-store.js";
export { TrustScoreStore } from "./trust-score-store.js";

import type { Database } from "../core/database.js";
import { ClaimStore } from "./claim-store.js";
import { EvidenceStore } from "./evidence-store.js";
import { VerificationStore } from "./verification-store.js";
import { TrustScoreStore } from "./trust-score-store.js";

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
  };
}
