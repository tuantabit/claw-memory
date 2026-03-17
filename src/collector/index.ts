/**
 * Evidence Collector Module
 *
 * This module provides evidence collection from multiple sources
 * to verify agent claims. Each source specializes in a type of evidence:
 *
 * - FileEvidenceSource: File existence, content hashes, modification times
 * - CommandEvidenceSource: Command outputs, exit codes, duration
 * - ToolEvidenceSource: Recorded tool calls and results
 * - GitEvidenceSource: Git history, diffs, and commit information
 * - ReceiptSource: Integration with ClawMemory receipts
 *
 * The EvidenceCollector orchestrates collection from appropriate sources
 * based on claim type and aggregates results.
 *
 * @example
 * ```typescript
 * import { createEvidenceCollector } from "./collector/index.js";
 *
 * const collector = createEvidenceCollector(db);
 * const result = await collector.collectForClaim(claim);
 * console.log(result.evidence);
 * ```
 */

export {
  EvidenceCollector,
  createEvidenceCollector,
  type CollectionResult,
} from "./evidence-collector.js";

export { FileEvidenceSource, type FileEvidence } from "./sources/file-source.js";
export { CommandEvidenceSource, type CommandEvidence } from "./sources/command-source.js";
export { ToolEvidenceSource } from "./sources/tool-source.js";
export { GitEvidenceSource, type GitDiff, type GitStatus } from "./sources/git-source.js";
export { ReceiptSource, createReceiptSource, type ReceiptSourceConfig } from "./sources/receipt-source.js";
