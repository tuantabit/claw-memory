/**
 * Evidence Collector - Orchestrates evidence collection from multiple sources
 *
 * This module coordinates evidence gathering for claim verification:
 * 1. Determines which sources are relevant for each claim type
 * 2. Collects evidence from all relevant sources in parallel
 * 3. Deduplicates and aggregates results
 * 4. Provides utility methods for evidence analysis
 *
 * Each claim type maps to specific evidence sources:
 * - file_created/modified/deleted → file, tool, git sources
 * - command_executed → command, tool sources
 * - test_passed/failed → command, tool sources
 */

import type { Database } from "../core/database.js";
import type { Evidence, Claim, ClaimType } from "../types.js";
import { FileEvidenceSource } from "./sources/file-source.js";
import { CommandEvidenceSource } from "./sources/command-source.js";
import { ToolEvidenceSource } from "./sources/tool-source.js";
import { GitEvidenceSource } from "./sources/git-source.js";
import { ReceiptSource } from "./sources/receipt-source.js";

/**
 * Result of collecting evidence for a claim
 */
export interface CollectionResult {
  /** ID of the claim evidence was collected for */
  claim_id: string;

  /** All collected evidence pieces */
  evidence: Evidence[];

  /** Names of sources that were checked */
  sources_checked: string[];

  /** Time taken to collect evidence in milliseconds */
  collection_time_ms: number;
}

/**
 * Orchestrates evidence collection from multiple sources
 *
 * @example
 * ```typescript
 * const collector = new EvidenceCollector(db);
 *
 * // Collect evidence for a single claim
 * const result = await collector.collectForClaim(claim);
 * console.log(`Found ${result.evidence.length} pieces of evidence`);
 *
 * // Check if evidence is sufficient
 * if (collector.hasSufficientEvidence(result.evidence)) {
 *   const strongest = collector.getStrongestEvidence(result.evidence);
 *   console.log(`Strongest evidence: ${strongest.source_ref}`);
 * }
 * ```
 */
export class EvidenceCollector {
  private fileSource: FileEvidenceSource;
  private commandSource: CommandEvidenceSource;
  private toolSource: ToolEvidenceSource;
  private gitSource: GitEvidenceSource;
  private receiptSource: ReceiptSource;

  /**
   * Create a new evidence collector
   *
   * @param db - Database for querying receipts and tool calls
   * @param cwd - Working directory for file/git operations
   */
  constructor(db: Database, cwd: string = process.cwd()) {
    this.fileSource = new FileEvidenceSource(db);
    this.commandSource = new CommandEvidenceSource(db);
    this.toolSource = new ToolEvidenceSource(db);
    this.gitSource = new GitEvidenceSource(cwd);
    this.receiptSource = new ReceiptSource(db);
  }

  /**
   * Collect evidence for a single claim
   *
   * Determines relevant sources based on claim type and
   * collects evidence from each source in parallel.
   *
   * @param claim - The claim to collect evidence for
   * @returns Collection result with all evidence and metadata
   */
  async collectForClaim(claim: Claim): Promise<CollectionResult> {
    const startTime = Date.now();
    const evidence: Evidence[] = [];
    const sourcesChecked: string[] = [];

    const sources = this.getSourcesForClaimType(claim.claim_type);

    const collectionPromises: Promise<Evidence[]>[] = [];

    if (sources.includes("file")) {
      sourcesChecked.push("file");
      collectionPromises.push(this.fileSource.collectForClaim(claim));
    }

    if (sources.includes("command")) {
      sourcesChecked.push("command");
      collectionPromises.push(this.commandSource.collectForClaim(claim));
    }

    if (sources.includes("tool")) {
      sourcesChecked.push("tool");
      collectionPromises.push(this.toolSource.collectForClaim(claim));
    }

    if (sources.includes("git")) {
      sourcesChecked.push("git");
      collectionPromises.push(this.gitSource.collectForClaim(claim));
    }

    if (sources.includes("receipt")) {
      sourcesChecked.push("receipt");
      collectionPromises.push(this.receiptSource.collect(claim));
    }

    const results = await Promise.all(collectionPromises);

    for (const result of results) {
      evidence.push(...result);
    }

    const deduped = this.deduplicateEvidence(evidence);

    return {
      claim_id: claim.claim_id,
      evidence: deduped,
      sources_checked: sourcesChecked,
      collection_time_ms: Date.now() - startTime,
    };
  }

  /**
   * Collect evidence for multiple claims
   *
   * Processes claims in batches of 5 to avoid overwhelming
   * the system while maintaining parallelism.
   *
   * @param claims - Array of claims to collect evidence for
   * @returns Map of claim IDs to collection results
   */
  async collectForClaims(claims: Claim[]): Promise<Map<string, CollectionResult>> {
    const results = new Map<string, CollectionResult>();

    const batchSize = 5;
    for (let i = 0; i < claims.length; i += batchSize) {
      const batch = claims.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((claim) => this.collectForClaim(claim))
      );

      for (const result of batchResults) {
        results.set(result.claim_id, result);
      }
    }

    return results;
  }

  /**
   * Determine which evidence sources are relevant for a claim type
   *
   * Each claim type maps to specific sources that can provide
   * meaningful evidence. For example, file claims check file/git/tool
   * sources, while command claims check command/tool sources.
   *
   * @param claimType - The type of claim
   * @returns Array of source names to check
   */
  /**
   * Determine which evidence sources are relevant for a claim type
   *
   * Each claim type maps to specific sources that can provide
   * meaningful evidence. Receipt source is included for all
   * file and command related claims for verification against
   * actual action records.
   *
   * @param claimType - The type of claim
   * @returns Array of source names to check
   */
  private getSourcesForClaimType(
    claimType: ClaimType
  ): Array<"file" | "command" | "tool" | "git" | "receipt"> {
    const sourceMap: Record<ClaimType, Array<"file" | "command" | "tool" | "git" | "receipt">> = {
      file_created: ["file", "tool", "git", "receipt"],
      file_modified: ["file", "tool", "git", "receipt"],
      file_deleted: ["file", "tool", "git", "receipt"],
      code_added: ["file", "tool", "git", "receipt"],
      code_removed: ["file", "tool", "git", "receipt"],
      code_fixed: ["file", "tool", "git", "receipt"],
      command_executed: ["command", "tool", "receipt"],
      test_passed: ["command", "tool", "receipt"],
      test_failed: ["command", "tool", "receipt"],
      error_fixed: ["file", "command", "tool", "receipt"],
      dependency_added: ["command", "tool", "file", "receipt"],
      config_changed: ["file", "tool", "git", "receipt"],
      task_completed: ["tool", "receipt"],
      unknown: ["tool"],
    };

    return sourceMap[claimType] ?? ["tool"];
  }

  /**
   * Remove duplicate evidence, keeping highest confidence per source+ref
   *
   * Evidence is considered duplicate if it has the same source
   * and source_ref. When duplicates exist, keeps the one with
   * highest confidence.
   *
   * @param evidence - Array of evidence to deduplicate
   * @returns Deduplicated evidence array
   */
  private deduplicateEvidence(evidence: Evidence[]): Evidence[] {
    const seen = new Map<string, Evidence>();

    for (const e of evidence) {
      const key = `${e.source}:${e.source_ref}`;
      const existing = seen.get(key);

      if (!existing || e.confidence > existing.confidence) {
        seen.set(key, e);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Generate a summary of collected evidence
   *
   * Provides counts and breakdowns useful for understanding
   * the overall evidence picture.
   *
   * @param evidence - Array of evidence to summarize
   * @returns Summary with counts by support status and source
   */
  summarizeEvidence(evidence: Evidence[]): {
    total: number;
    supporting: number;
    contradicting: number;
    by_source: Record<string, number>;
    average_confidence: number;
  } {
    const supporting = evidence.filter((e) => e.supports_claim).length;
    const contradicting = evidence.filter((e) => !e.supports_claim).length;

    const bySource: Record<string, number> = {};
    for (const e of evidence) {
      bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    }

    const avgConfidence =
      evidence.length > 0
        ? evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length
        : 0;

    return {
      total: evidence.length,
      supporting,
      contradicting,
      by_source: bySource,
      average_confidence: avgConfidence,
    };
  }

  /**
   * Check if evidence is sufficient for verification
   *
   * Returns true if at least one piece of evidence has
   * confidence >= 0.7. Used to determine if verification
   * can proceed.
   *
   * @param evidence - Array of evidence to check
   * @returns true if sufficient evidence exists
   */
  hasSufficientEvidence(evidence: Evidence[]): boolean {
    if (evidence.length === 0) return false;

    return evidence.some((e) => e.confidence >= 0.7);
  }

  /**
   * Get the strongest supporting evidence
   *
   * Returns the supporting evidence piece with highest confidence.
   * Useful for reporting the main reason a claim was verified.
   *
   * @param evidence - Array of evidence to search
   * @returns Strongest supporting evidence or null if none
   */
  getStrongestEvidence(evidence: Evidence[]): Evidence | null {
    const supporting = evidence.filter((e) => e.supports_claim);
    if (supporting.length === 0) return null;

    return supporting.reduce((best, e) =>
      e.confidence > best.confidence ? e : best
    );
  }

  /**
   * Get the strongest contradicting evidence
   *
   * Returns the contradicting evidence piece with highest confidence.
   * Useful for reporting the main reason a claim was contradicted.
   *
   * @param evidence - Array of evidence to search
   * @returns Strongest contradicting evidence or null if none
   */
  getStrongestContradiction(evidence: Evidence[]): Evidence | null {
    const contradicting = evidence.filter((e) => !e.supports_claim);
    if (contradicting.length === 0) return null;

    return contradicting.reduce((best, e) =>
      e.confidence > best.confidence ? e : best
    );
  }
}

/**
 * Factory function to create an EvidenceCollector
 *
 * @param db - Database instance for source queries
 * @param cwd - Optional working directory (defaults to process.cwd())
 * @returns Configured EvidenceCollector instance
 */
export function createEvidenceCollector(
  db: Database,
  cwd?: string
): EvidenceCollector {
  return new EvidenceCollector(db, cwd);
}
