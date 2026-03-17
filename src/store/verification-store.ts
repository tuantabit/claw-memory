/**
 * Verification Store - Persistence layer for claim verification results
 *
 * This store manages verification outcomes:
 * - Creating verification records from the verification engine
 * - Querying verifications by claim, status, or filter
 * - Tracking verification history (claims can be re-verified)
 * - Calculating verification statistics
 *
 * Verification statuses:
 * - verified: Claim is confirmed by evidence
 * - contradicted: Evidence shows claim is false
 * - unverified: Not enough evidence to determine
 * - insufficient_evidence: Cannot verify due to missing sources
 */

import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type { Verification, VerificationStatus, VerificationFilter } from "../types.js";

/**
 * Store for managing verification results
 *
 * @example
 * ```typescript
 * const store = new VerificationStore(db);
 *
 * // Create a verification result
 * const verification = await store.create(
 *   claimId,
 *   "verified",
 *   [evidenceId1, evidenceId2],
 *   0.95,
 *   "File exists with expected hash"
 * );
 *
 * // Query verifications
 * const result = await store.getByClaimId(claimId);
 * const contradicted = await store.getContradicted(sessionId);
 * ```
 */
export class VerificationStore {
  constructor(private db: Database) {}

  /**
   * Create a new verification result
   *
   * @param claimId - ID of the claim being verified
   * @param status - Verification outcome
   * @param evidenceIds - IDs of evidence used for verification
   * @param confidence - Confidence in the verification (0.0-1.0)
   * @param details - Human-readable explanation
   * @returns The created verification record
   */
  async create(
    claimId: string,
    status: VerificationStatus,
    evidenceIds: string[],
    confidence: number,
    details: string
  ): Promise<Verification> {
    const verification: Verification = {
      verification_id: nanoid(),
      claim_id: claimId,
      status,
      evidence_ids: evidenceIds,
      confidence,
      details,
      verified_at: new Date(),
    };

    await this.db.insert("verifications", {
      verification_id: verification.verification_id,
      claim_id: verification.claim_id,
      status: verification.status,
      evidence_ids: JSON.stringify(verification.evidence_ids),
      confidence: verification.confidence,
      details: verification.details,
    });

    return verification;
  }

  /**
   * Get a verification by its unique ID
   *
   * @param verificationId - The verification ID to look up
   * @returns The verification if found, null otherwise
   */
  async getById(verificationId: string): Promise<Verification | null> {
    const rows = await this.db.query<Verification>(
      `SELECT * FROM verifications WHERE verification_id = ?`,
      [verificationId]
    );

    if (rows.length === 0) return null;

    return this.hydrate(rows[0]);
  }

  /**
   * Get the most recent verification for a claim
   *
   * Claims can be verified multiple times. This returns
   * the latest verification result.
   *
   * @param claimId - Claim ID to query
   * @returns Most recent verification or null if never verified
   */
  async getByClaimId(claimId: string): Promise<Verification | null> {
    const rows = await this.db.query<Verification>(
      `SELECT * FROM verifications
       WHERE claim_id = ?
       ORDER BY verified_at DESC
       LIMIT 1`,
      [claimId]
    );

    if (rows.length === 0) return null;

    return this.hydrate(rows[0]);
  }

  /**
   * Get full verification history for a claim
   *
   * Returns all verifications in reverse chronological order.
   * Useful for seeing how verification status changed over time.
   *
   * @param claimId - Claim ID to query
   * @returns Array of all verifications, newest first
   */
  async getHistoryByClaimId(claimId: string): Promise<Verification[]> {
    const rows = await this.db.query<Verification>(
      `SELECT * FROM verifications
       WHERE claim_id = ?
       ORDER BY verified_at DESC`,
      [claimId]
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Get verifications by status within a session
   *
   * @param sessionId - Session to query
   * @param status - Verification status to filter by
   * @param limit - Maximum results to return
   * @returns Array of verifications with the specified status
   */
  async getByStatus(
    sessionId: string,
    status: VerificationStatus,
    limit = 50
  ): Promise<Verification[]> {
    const rows = await this.db.query<Verification>(
      `SELECT v.* FROM verifications v
       JOIN claims c ON v.claim_id = c.claim_id
       WHERE c.session_id = ? AND v.status = ?
       ORDER BY v.verified_at DESC
       LIMIT ?`,
      [sessionId, status, limit]
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Get verifications matching a flexible filter
   *
   * @param filter - Filter criteria (claim_id, status, min_confidence)
   * @param limit - Maximum results to return
   * @returns Array of matching verifications
   */
  async getByFilter(filter: VerificationFilter, limit = 100): Promise<Verification[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.claim_id) {
      conditions.push("claim_id = ?");
      params.push(filter.claim_id);
    }

    if (filter.status) {
      conditions.push("status = ?");
      params.push(filter.status);
    }

    if (filter.min_confidence !== undefined) {
      conditions.push("confidence >= ?");
      params.push(filter.min_confidence);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    params.push(limit);

    const rows = await this.db.query<Verification>(
      `SELECT * FROM verifications
       ${whereClause}
       ORDER BY verified_at DESC
       LIMIT ?`,
      params
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Get all contradicted verifications in a session
   *
   * Shorthand for getByStatus with "contradicted".
   * These are claims that were proven false.
   *
   * @param sessionId - Session to query
   * @param limit - Maximum results to return
   * @returns Array of contradicted verifications
   */
  async getContradicted(sessionId: string, limit = 50): Promise<Verification[]> {
    return this.getByStatus(sessionId, "contradicted", limit);
  }

  /**
   * Get verification statistics for a session
   *
   * Returns counts by status and average confidence.
   *
   * @param sessionId - Session to analyze
   * @returns Statistics with totals and breakdowns
   */
  async getStats(sessionId: string): Promise<{
    total: number;
    by_status: Record<VerificationStatus, number>;
    average_confidence: number;
  }> {
    const rows = await this.db.query<{ status: string; count: number; avg_conf: number }>(
      `SELECT v.status, COUNT(*) as count, AVG(v.confidence) as avg_conf
       FROM verifications v
       JOIN claims c ON v.claim_id = c.claim_id
       WHERE c.session_id = ?
       GROUP BY v.status`,
      [sessionId]
    );

    const stats: Record<VerificationStatus, number> = {
      verified: 0,
      unverified: 0,
      contradicted: 0,
      insufficient_evidence: 0,
    };

    let total = 0;
    let totalConfidence = 0;

    for (const row of rows) {
      const count = Number(row.count);
      stats[row.status as VerificationStatus] = count;
      total += count;
      totalConfidence += Number(row.avg_conf) * count;
    }

    return {
      total,
      by_status: stats,
      average_confidence: total > 0 ? totalConfidence / total : 0,
    };
  }

  /**
   * Check if a claim has any verification record
   *
   * @param claimId - Claim ID to check
   * @returns true if claim has been verified, false otherwise
   */
  async isVerified(claimId: string): Promise<boolean> {
    const rows = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM verifications WHERE claim_id = ?`,
      [claimId]
    );

    return Number(rows[0]?.count ?? 0) > 0;
  }

  /**
   * Update a verification record
   *
   * Allows partial updates to status, confidence, or details.
   *
   * @param verificationId - ID of verification to update
   * @param updates - Fields to update
   */
  async update(
    verificationId: string,
    updates: Partial<Pick<Verification, "status" | "confidence" | "details">>
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (updates.status !== undefined) {
      sets.push("status = ?");
      params.push(updates.status);
    }

    if (updates.confidence !== undefined) {
      sets.push("confidence = ?");
      params.push(updates.confidence);
    }

    if (updates.details !== undefined) {
      sets.push("details = ?");
      params.push(updates.details);
    }

    if (sets.length === 0) return;

    params.push(verificationId);

    await this.db.execute(
      `UPDATE verifications SET ${sets.join(", ")} WHERE verification_id = ?`,
      params
    );
  }

  /**
   * Delete a verification record
   *
   * @param verificationId - ID of verification to delete
   */
  async delete(verificationId: string): Promise<void> {
    await this.db.execute(`DELETE FROM verifications WHERE verification_id = ?`, [
      verificationId,
    ]);
  }

  /**
   * Hydrate a database row into a Verification object
   *
   * Parses JSON fields and converts timestamps.
   *
   * @param row - Raw database row
   * @returns Properly typed Verification object
   */
  private hydrate(row: Verification): Verification {
    return {
      ...row,
      evidence_ids:
        typeof row.evidence_ids === "string"
          ? JSON.parse(row.evidence_ids)
          : row.evidence_ids ?? [],
      verified_at: new Date(row.verified_at),
    };
  }
}
