/**
 * Evidence Store - Persistence layer for verification evidence
 *
 * This store manages evidence collected to verify agent claims.
 * Evidence comes from multiple sources:
 * - Filesystem: File existence, content hashes, modification times
 * - Git: Commit history, diffs, branch information
 * - Command receipts: Command outputs, exit codes
 * - Tool calls: Recorded tool invocations and results
 *
 * Each piece of evidence either supports or contradicts a claim,
 * with an associated confidence score.
 */

import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type { Evidence, EvidenceSource } from "../types.js";

/**
 * Store for managing verification evidence
 *
 * @example
 * ```typescript
 * const store = new EvidenceStore(db);
 *
 * // Create evidence for a file_created claim
 * const evidence = await store.create(
 *   claimId,
 *   "filesystem",
 *   "src/index.ts",
 *   { exists: true, hash: "abc123" },
 *   true,  // supports the claim
 *   0.95   // high confidence
 * );
 *
 * // Query evidence for a claim
 * const allEvidence = await store.getByClaimId(claimId);
 * const supporting = await store.getSupporting(claimId);
 * const contradicting = await store.getContradicting(claimId);
 * ```
 */
export class EvidenceStore {
  constructor(private db: Database) {}

  /**
   * Create a new evidence record
   *
   * @param claimId - ID of the claim this evidence relates to
   * @param source - Source type (filesystem, git, command_receipt, tool_call)
   * @param sourceRef - Reference identifier (file path, commit hash, etc.)
   * @param data - Source-specific data (file info, command output, etc.)
   * @param supportsClaim - Whether this evidence supports the claim
   * @param confidence - Confidence score (0.0-1.0)
   * @returns The created evidence record
   */
  async create(
    claimId: string,
    source: EvidenceSource,
    sourceRef: string,
    data: Record<string, unknown>,
    supportsClaim: boolean,
    confidence: number
  ): Promise<Evidence> {
    const evidence: Evidence = {
      evidence_id: nanoid(),
      claim_id: claimId,
      source,
      source_ref: sourceRef,
      data,
      supports_claim: supportsClaim,
      confidence,
      collected_at: new Date(),
    };

    await this.db.insert("evidence", {
      evidence_id: evidence.evidence_id,
      claim_id: evidence.claim_id,
      source: evidence.source,
      source_ref: evidence.source_ref,
      data: JSON.stringify(evidence.data),
      supports_claim: evidence.supports_claim ? 1 : 0,
      confidence: evidence.confidence,
    });

    return evidence;
  }

  /**
   * Get an evidence record by its unique ID
   *
   * @param evidenceId - The evidence ID to look up
   * @returns The evidence if found, null otherwise
   */
  async getById(evidenceId: string): Promise<Evidence | null> {
    const rows = await this.db.query<Evidence>(
      `SELECT * FROM evidence WHERE evidence_id = ?`,
      [evidenceId]
    );

    if (rows.length === 0) return null;

    return this.hydrate(rows[0]);
  }

  /**
   * Get all evidence for a specific claim
   *
   * @param claimId - Claim ID to query
   * @returns Array of evidence records, newest first
   */
  async getByClaimId(claimId: string): Promise<Evidence[]> {
    const rows = await this.db.query<Evidence>(
      `SELECT * FROM evidence
       WHERE claim_id = ?
       ORDER BY collected_at DESC`,
      [claimId]
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Get evidence for a claim filtered by source type
   *
   * @param claimId - Claim ID to query
   * @param source - Source type to filter by
   * @returns Array of evidence from the specified source
   */
  async getBySource(
    claimId: string,
    source: EvidenceSource
  ): Promise<Evidence[]> {
    const rows = await this.db.query<Evidence>(
      `SELECT * FROM evidence
       WHERE claim_id = ? AND source = ?
       ORDER BY collected_at DESC`,
      [claimId, source]
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Get evidence that supports a claim
   *
   * @param claimId - Claim ID to query
   * @returns Array of supporting evidence, ordered by confidence
   */
  async getSupporting(claimId: string): Promise<Evidence[]> {
    const rows = await this.db.query<Evidence>(
      `SELECT * FROM evidence
       WHERE claim_id = ? AND supports_claim = true
       ORDER BY confidence DESC`,
      [claimId]
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Get evidence that contradicts a claim
   *
   * @param claimId - Claim ID to query
   * @returns Array of contradicting evidence, ordered by confidence
   */
  async getContradicting(claimId: string): Promise<Evidence[]> {
    const rows = await this.db.query<Evidence>(
      `SELECT * FROM evidence
       WHERE claim_id = ? AND supports_claim = false
       ORDER BY confidence DESC`,
      [claimId]
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Count evidence for a claim by support status
   *
   * @param claimId - Claim ID to count evidence for
   * @returns Object with total, supporting, and contradicting counts
   */
  async countByClaimId(claimId: string): Promise<{
    total: number;
    supporting: number;
    contradicting: number;
  }> {
    const rows = await this.db.query<{ supports_claim: boolean; count: number }>(
      `SELECT supports_claim, COUNT(*) as count
       FROM evidence
       WHERE claim_id = ?
       GROUP BY supports_claim`,
      [claimId]
    );

    let supporting = 0;
    let contradicting = 0;

    for (const row of rows) {
      if (row.supports_claim) {
        supporting = Number(row.count);
      } else {
        contradicting = Number(row.count);
      }
    }

    return {
      total: supporting + contradicting,
      supporting,
      contradicting,
    };
  }

  /**
   * Check if any evidence exists for a claim
   *
   * @param claimId - Claim ID to check
   * @returns true if evidence exists, false otherwise
   */
  async hasEvidence(claimId: string): Promise<boolean> {
    const rows = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM evidence WHERE claim_id = ?`,
      [claimId]
    );

    return Number(rows[0]?.count ?? 0) > 0;
  }

  /**
   * Get all evidence referencing a specific source
   *
   * Useful for finding all evidence related to a file or command.
   *
   * @param sourceRef - Source reference (file path, commit hash, etc.)
   * @returns Array of evidence with this source reference
   */
  async getBySourceRef(sourceRef: string): Promise<Evidence[]> {
    const rows = await this.db.query<Evidence>(
      `SELECT * FROM evidence
       WHERE source_ref = ?
       ORDER BY collected_at DESC`,
      [sourceRef]
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Delete an evidence record by ID
   *
   * @param evidenceId - ID of evidence to delete
   */
  async delete(evidenceId: string): Promise<void> {
    await this.db.execute(`DELETE FROM evidence WHERE evidence_id = ?`, [
      evidenceId,
    ]);
  }

  /**
   * Delete all evidence for a claim
   *
   * Used when re-verifying a claim with fresh evidence.
   *
   * @param claimId - Claim ID to delete evidence for
   */
  async deleteByClaimId(claimId: string): Promise<void> {
    await this.db.execute(`DELETE FROM evidence WHERE claim_id = ?`, [claimId]);
  }

  /**
   * Hydrate a database row into an Evidence object
   *
   * Parses JSON fields and converts timestamps.
   *
   * @param row - Raw database row
   * @returns Properly typed Evidence object
   */
  private hydrate(row: Evidence): Evidence {
    return {
      ...row,
      data: typeof row.data === "string" ? JSON.parse(row.data) : row.data ?? {},
      supports_claim: Boolean(row.supports_claim),
      collected_at: new Date(row.collected_at),
    };
  }
}
