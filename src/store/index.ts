/**
 * Store Module - Data persistence layer for ClawMemory
 */

export { ClaimStore } from "./claim-store.js";
export { EvidenceStore } from "./evidence-store.js";
export { VerificationStore } from "./verification-store.js";
export { MessageStore } from "./message-store.js";
export { SummaryStore } from "./summary-store.js";
export { MemoryStore } from "./memory-store.js";
export { ReceiptStore } from "./receipt-store.js";

import type { Database } from "../core/database.js";
import { ClaimStore } from "./claim-store.js";
import { EvidenceStore } from "./evidence-store.js";
import { VerificationStore } from "./verification-store.js";
import { MessageStore } from "./message-store.js";
import { SummaryStore } from "./summary-store.js";
import { MemoryStore } from "./memory-store.js";
import { ReceiptStore } from "./receipt-store.js";

export interface ClawMemoryStores {
  claims: ClaimStore;
  evidence: EvidenceStore;
  verifications: VerificationStore;
  messages: MessageStore;
  summaries: SummaryStore;
  memories: MemoryStore;
  receipts: ReceiptStore;
}

export function createStores(db: Database): ClawMemoryStores {
  return {
    claims: new ClaimStore(db),
    evidence: new EvidenceStore(db),
    verifications: new VerificationStore(db),
    messages: new MessageStore(db),
    summaries: new SummaryStore(db),
    memories: new MemoryStore(db),
    receipts: new ReceiptStore(db),
  };
}
