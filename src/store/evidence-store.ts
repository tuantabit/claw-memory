
import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type { Evidence, EvidenceSource } from "../types.js";

export class EvidenceStore {
  constructor(private db: Database) {}

  
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

  
  async getById(evidenceId: string): Promise<Evidence | null> {
    const rows = await this.db.query<Evidence>(
      `SELECT * FROM evidence WHERE evidence_id = ?`,
      [evidenceId]
    );

    if (rows.length === 0) return null;

    return this.hydrate(rows[0]);
  }

  
  async getByClaimId(claimId: string): Promise<Evidence[]> {
    const rows = await this.db.query<Evidence>(
      `SELECT * FROM evidence
       WHERE claim_id = ?
       ORDER BY collected_at DESC`,
      [claimId]
    );

    return rows.map((r) => this.hydrate(r));
  }

  
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

  
  async getSupporting(claimId: string): Promise<Evidence[]> {
    const rows = await this.db.query<Evidence>(
      `SELECT * FROM evidence
       WHERE claim_id = ? AND supports_claim = true
       ORDER BY confidence DESC`,
      [claimId]
    );

    return rows.map((r) => this.hydrate(r));
  }

  
  async getContradicting(claimId: string): Promise<Evidence[]> {
    const rows = await this.db.query<Evidence>(
      `SELECT * FROM evidence
       WHERE claim_id = ? AND supports_claim = false
       ORDER BY confidence DESC`,
      [claimId]
    );

    return rows.map((r) => this.hydrate(r));
  }

  
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

  
  async hasEvidence(claimId: string): Promise<boolean> {
    const rows = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM evidence WHERE claim_id = ?`,
      [claimId]
    );

    return Number(rows[0]?.count ?? 0) > 0;
  }

  
  async getBySourceRef(sourceRef: string): Promise<Evidence[]> {
    const rows = await this.db.query<Evidence>(
      `SELECT * FROM evidence
       WHERE source_ref = ?
       ORDER BY collected_at DESC`,
      [sourceRef]
    );

    return rows.map((r) => this.hydrate(r));
  }

  
  async delete(evidenceId: string): Promise<void> {
    await this.db.execute(`DELETE FROM evidence WHERE evidence_id = ?`, [
      evidenceId,
    ]);
  }

  
  async deleteByClaimId(claimId: string): Promise<void> {
    await this.db.execute(`DELETE FROM evidence WHERE claim_id = ?`, [claimId]);
  }

  
  private hydrate(row: Evidence): Evidence {
    return {
      ...row,
      data: typeof row.data === "string" ? JSON.parse(row.data) : row.data ?? {},
      supports_claim: Boolean(row.supports_claim),
      collected_at: new Date(row.collected_at),
    };
  }
}
