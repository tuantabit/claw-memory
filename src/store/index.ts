/**
 * Store Index - Export all stores
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
 * All stores bundled together (like lossless-claw's store pattern)
 */
export interface VeridicStores {
  claims: ClaimStore;
  evidence: EvidenceStore;
  verifications: VerificationStore;
  trustScores: TrustScoreStore;
}

/**
 * Create all stores
 */
export function createStores(db: Database): VeridicStores {
  return {
    claims: new ClaimStore(db),
    evidence: new EvidenceStore(db),
    verifications: new VerificationStore(db),
    trustScores: new TrustScoreStore(db),
  };
}
