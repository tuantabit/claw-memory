
import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type { CompactionConfig, CompactionReport } from "./types.js";
import { DEFAULT_COMPACTION_CONFIG } from "./types.js";

export class VeridicCompactor {
  private config: CompactionConfig;
  private report: CompactionReport;

  constructor(
    private db: Database,
    config: Partial<CompactionConfig> = {}
  ) {
    this.config = { ...DEFAULT_COMPACTION_CONFIG, ...config };
    this.report = this.initReport();
  }

  private initReport(): CompactionReport {
    return {
      compactionId: nanoid(),
      startedAt: new Date(),
      completedAt: null,
      retentionDays: this.config.retentionDays,
      claimsArchived: 0,
      evidenceArchived: 0,
      orphansCleaned: 0,
      sizeBefore: 0,
      sizeAfter: 0,
      spaceSaved: 0,
      status: "running",
      errors: [],
    };
  }

  /**
   * Run full compaction
   */
  async compact(): Promise<CompactionReport> {
    this.report = this.initReport();

    try {
      await this.recordCompactionStart();

      this.report.sizeBefore = await this.getDatabaseSize();

      await this.archiveOldClaims();

      await this.archiveOldEvidence();

      await this.createDailySummaries();

      await this.cleanOrphans();

      await this.optimizeDatabase();

      this.report.sizeAfter = await this.getDatabaseSize();
      this.report.spaceSaved = this.report.sizeBefore - this.report.sizeAfter;

      this.report.status = this.report.errors.length > 0 ? "partial" : "success";
      this.report.completedAt = new Date();

      await this.recordCompactionComplete();

      return this.report;
    } catch (error) {
      this.report.status = "failed";
      this.report.errors.push(
        error instanceof Error ? error.message : String(error)
      );
      this.report.completedAt = new Date();
      await this.recordCompactionComplete();
      throw error;
    }
  }

  /**
   * Archive claims older than retention period
   */
  private async archiveOldClaims(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);

    let whereClause = `created_at < ?`;
    const params: unknown[] = [cutoffDate.toISOString()];

    if (this.config.preserveContradicted) {
      whereClause += ` AND claim_id NOT IN (
        SELECT claim_id FROM verifications WHERE status = 'contradicted'
      )`;
    }

    if (this.config.preserveLowTrust) {
      whereClause += ` AND session_id NOT IN (
        SELECT session_id FROM trust_scores WHERE overall_score < 50
      )`;
    }

    const claims = await this.db.query<{
      claim_id: string;
      session_id: string;
      claim_type: string;
      original_text: string;
      confidence: number;
      created_at: string;
    }>(
      `SELECT claim_id, session_id, claim_type, original_text, confidence, created_at
       FROM claims WHERE ${whereClause}`,
      params
    );

    for (const claim of claims) {
      try {
        const verifications = await this.db.query<{ status: string }>(
          `SELECT status FROM verifications WHERE claim_id = ? ORDER BY verified_at DESC LIMIT 1`,
          [claim.claim_id]
        );
        const status = verifications.length > 0 ? verifications[0].status : null;

        await this.db.insert("claims_archive", {
          claim_id: claim.claim_id,
          session_id: claim.session_id,
          claim_type: claim.claim_type,
          original_text: claim.original_text,
          confidence: claim.confidence,
          verification_status: status,
          original_created_at: claim.created_at,
        });

        await this.db.execute(`DELETE FROM claims WHERE claim_id = ?`, [
          claim.claim_id,
        ]);

        this.report.claimsArchived++;
      } catch (error) {
        this.report.errors.push(
          `Failed to archive claim ${claim.claim_id}: ${error}`
        );
      }
    }
  }

  /**
   * Archive evidence for archived claims
   */
  private async archiveOldEvidence(): Promise<void> {
    const evidence = await this.db.query<{
      evidence_id: string;
      claim_id: string;
      source: string;
      supports_claim: boolean;
      confidence: number;
      collected_at: string;
    }>(
      `SELECT e.evidence_id, e.claim_id, e.source, e.supports_claim, e.confidence, e.collected_at
       FROM evidence e
       WHERE e.claim_id IN (SELECT claim_id FROM claims_archive)
       AND e.evidence_id NOT IN (SELECT evidence_id FROM evidence_archive)`
    );

    for (const ev of evidence) {
      try {
        await this.db.insert("evidence_archive", {
          evidence_id: ev.evidence_id,
          claim_id: ev.claim_id,
          source: ev.source,
          supports_claim: ev.supports_claim,
          confidence: ev.confidence,
          original_collected_at: ev.collected_at,
        });

        await this.db.execute(`DELETE FROM evidence WHERE evidence_id = ?`, [
          ev.evidence_id,
        ]);

        this.report.evidenceArchived++;
      } catch (error) {
        this.report.errors.push(
          `Failed to archive evidence ${ev.evidence_id}: ${error}`
        );
      }
    }
  }

  /**
   * Create daily summaries from archived data
   */
  private async createDailySummaries(): Promise<void> {
    const dates = await this.db.query<{ summary_date: string }>(
      `SELECT DISTINCT DATE(original_created_at) as summary_date
       FROM claims_archive
       WHERE DATE(original_created_at) NOT IN (
         SELECT summary_date FROM daily_summaries
       )`
    );

    for (const { summary_date } of dates) {
      try {
        const stats = await this.db.query<{
          session_id: string;
          total: number;
          verified: number;
          contradicted: number;
          unverified: number;
          avg_confidence: number;
        }>(
          `SELECT
             session_id,
             COUNT(*) as total,
             SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) as verified,
             SUM(CASE WHEN verification_status = 'contradicted' THEN 1 ELSE 0 END) as contradicted,
             SUM(CASE WHEN verification_status IS NULL OR verification_status = 'unverified' THEN 1 ELSE 0 END) as unverified,
             AVG(confidence) as avg_confidence
           FROM claims_archive
           WHERE DATE(original_created_at) = ?
           GROUP BY session_id`,
          [summary_date]
        );

        for (const stat of stats) {
          const types = await this.db.query<{
            claim_type: string;
            count: number;
          }>(
            `SELECT claim_type, COUNT(*) as count
             FROM claims_archive
             WHERE DATE(original_created_at) = ? AND session_id = ?
             GROUP BY claim_type`,
            [summary_date, stat.session_id]
          );

          const claimTypes: Record<string, number> = {};
          for (const t of types) {
            claimTypes[t.claim_type] = t.count;
          }

          const trustScores = await this.db.query<{ overall_score: number }>(
            `SELECT overall_score FROM trust_scores
             WHERE session_id = ? AND DATE(calculated_at) = ?
             ORDER BY calculated_at DESC LIMIT 1`,
            [stat.session_id, summary_date]
          );

          await this.db.insert("daily_summaries", {
            summary_id: nanoid(),
            summary_date,
            session_id: stat.session_id,
            total_claims: stat.total,
            verified_claims: stat.verified,
            contradicted_claims: stat.contradicted,
            unverified_claims: stat.unverified,
            avg_confidence: stat.avg_confidence,
            avg_trust_score: trustScores.length > 0 ? trustScores[0].overall_score : 0,
            claim_types: JSON.stringify(claimTypes),
          });
        }
      } catch (error) {
        this.report.errors.push(
          `Failed to create summary for ${summary_date}: ${error}`
        );
      }
    }
  }

  /**
   * Clean orphaned data
   */
  private async cleanOrphans(): Promise<void> {
    const orphanedEvidenceCount = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM evidence WHERE claim_id NOT IN (
        SELECT claim_id FROM claims
        UNION SELECT claim_id FROM claims_archive
      )`
    );

    await this.db.execute(
      `DELETE FROM evidence WHERE claim_id NOT IN (
        SELECT claim_id FROM claims
        UNION SELECT claim_id FROM claims_archive
      )`
    );
    this.report.orphansCleaned += orphanedEvidenceCount[0]?.count ?? 0;

    const orphanedVerificationsCount = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM verifications WHERE claim_id NOT IN (
        SELECT claim_id FROM claims
        UNION SELECT claim_id FROM claims_archive
      )`
    );

    await this.db.execute(
      `DELETE FROM verifications WHERE claim_id NOT IN (
        SELECT claim_id FROM claims
        UNION SELECT claim_id FROM claims_archive
      )`
    );
    this.report.orphansCleaned += orphanedVerificationsCount[0]?.count ?? 0;
  }

  /**
   * Optimize database (VACUUM, REINDEX, ANALYZE)
   */
  private async optimizeDatabase(): Promise<void> {
    if (this.config.vacuum) {
      try {
        await this.db.execute("VACUUM");
      } catch (error) {
        this.report.errors.push(`VACUUM failed: ${error}`);
      }
    }

    if (this.config.reindex) {
      try {
        const tables = ["claims", "evidence", "verifications", "trust_scores"];
        for (const table of tables) {
          await this.db.execute(`REINDEX ${table}`);
        }
      } catch (error) {
        this.report.errors.push(`REINDEX failed: ${error}`);
      }
    }

    if (this.config.analyze) {
      try {
        await this.db.execute("ANALYZE");
      } catch (error) {
        this.report.errors.push(`ANALYZE failed: ${error}`);
      }
    }
  }

  /**
   * Get database file size
   */
  private async getDatabaseSize(): Promise<number> {
    try {
      const result = await this.db.query<{ page_count: number; page_size: number }>(
        `SELECT page_count, page_size FROM pragma_page_count(), pragma_page_size()`
      );
      if (result.length > 0) {
        return result[0].page_count * result[0].page_size;
      }
    } catch {
    }
    return 0;
  }

  /**
   * Record compaction start in history
   */
  private async recordCompactionStart(): Promise<void> {
    await this.db.insert("compaction_history", {
      compaction_id: this.report.compactionId,
      started_at: this.report.startedAt.toISOString(),
      retention_days: this.config.retentionDays,
      status: "running",
    });
  }

  /**
   * Record compaction completion in history
   */
  private async recordCompactionComplete(): Promise<void> {
    await this.db.execute(
      `UPDATE compaction_history SET
         completed_at = ?,
         claims_archived = ?,
         evidence_archived = ?,
         orphans_cleaned = ?,
         size_before_bytes = ?,
         size_after_bytes = ?,
         space_saved_bytes = ?,
         status = ?,
         error_message = ?
       WHERE compaction_id = ?`,
      [
        this.report.completedAt?.toISOString() ?? null,
        this.report.claimsArchived,
        this.report.evidenceArchived,
        this.report.orphansCleaned,
        this.report.sizeBefore,
        this.report.sizeAfter,
        this.report.spaceSaved,
        this.report.status,
        this.report.errors.length > 0 ? this.report.errors.join("\n") : null,
        this.report.compactionId,
      ]
    );
  }

  /**
   * Get compaction history
   */
  async getHistory(limit = 10): Promise<CompactionReport[]> {
    const rows = await this.db.query<{
      compaction_id: string;
      started_at: string;
      completed_at: string | null;
      retention_days: number;
      claims_archived: number;
      evidence_archived: number;
      orphans_cleaned: number;
      size_before_bytes: number;
      size_after_bytes: number;
      space_saved_bytes: number;
      status: string;
      error_message: string | null;
    }>(
      `SELECT * FROM compaction_history ORDER BY started_at DESC LIMIT ?`,
      [limit]
    );

    return rows.map((row) => ({
      compactionId: row.compaction_id,
      startedAt: new Date(row.started_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      retentionDays: row.retention_days,
      claimsArchived: row.claims_archived,
      evidenceArchived: row.evidence_archived,
      orphansCleaned: row.orphans_cleaned,
      sizeBefore: row.size_before_bytes,
      sizeAfter: row.size_after_bytes,
      spaceSaved: row.space_saved_bytes,
      status: row.status as CompactionReport["status"],
      errors: row.error_message ? row.error_message.split("\n") : [],
    }));
  }
}
