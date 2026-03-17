
import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type { Verification, VerificationStatus, VerificationFilter } from "../types.js";

export class VerificationStore {
  constructor(private db: Database) {}

  /**
   * Create new verification
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
   * Get verification by ID
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
   * Get verification for a claim
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
   * Get all verifications for a claim (history)
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
   * Get verifications by status
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
   * Get verifications by filter
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
   * Get contradicted verifications for session
   */
  async getContradicted(sessionId: string, limit = 50): Promise<Verification[]> {
    return this.getByStatus(sessionId, "contradicted", limit);
  }

  /**
   * Get verification statistics for session
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
   * Check if claim has been verified
   */
  async isVerified(claimId: string): Promise<boolean> {
    const rows = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM verifications WHERE claim_id = ?`,
      [claimId]
    );

    return Number(rows[0]?.count ?? 0) > 0;
  }

  /**
   * Update verification
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
   * Delete verification
   */
  async delete(verificationId: string): Promise<void> {
    await this.db.execute(`DELETE FROM verifications WHERE verification_id = ?`, [
      verificationId,
    ]);
  }

  /**
   * Hydrate verification from database row
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
