
import type { VeridicEngine } from "../engine.js";
import { VeridicCompactor, type CompactionConfig } from "../compactor/index.js";

export interface CompactInput {
  retention_days?: number;
  dry_run?: boolean;
  history?: boolean;
}

export interface CompactOutput {
  success: boolean;
  summary: string;
  report?: {
    compaction_id: string;
    claims_archived: number;
    evidence_archived: number;
    orphans_cleaned: number;
    space_saved_mb: number;
    duration_seconds: number;
    status: string;
    errors: string[];
  };
  history?: Array<{
    compaction_id: string;
    started_at: string;
    claims_archived: number;
    space_saved_mb: number;
    status: string;
  }>;
}

export function createCompactTool(engine: VeridicEngine) {
  return {
    name: "veridic_compact",
    description:
      "Run database compaction to archive old claims/evidence and optimize storage. " +
      "Archives data older than retention period, creates daily summaries, cleans orphans, and runs VACUUM.",
    parameters: {
      type: "object",
      properties: {
        retention_days: {
          type: "number",
          description: "Number of days to retain before archiving (default: 30)",
        },
        dry_run: {
          type: "boolean",
          description: "Only show what would be compacted without making changes",
        },
        history: {
          type: "boolean",
          description: "Show compaction history instead of running compaction",
        },
      },
    },

    async execute(input: CompactInput): Promise<CompactOutput> {
      try {
        const stores = engine.getStores();
        const db = stores.claims["db"];

        if (input.history) {
          const compactor = new VeridicCompactor(db);
          const historyItems = await compactor.getHistory(10);

          return {
            success: true,
            summary: `Found ${historyItems.length} compaction runs in history.`,
            history: historyItems.map((h) => ({
              compaction_id: h.compactionId,
              started_at: h.startedAt.toISOString(),
              claims_archived: h.claimsArchived,
              space_saved_mb: Math.round(h.spaceSaved / 1024 / 1024 * 100) / 100,
              status: h.status,
            })),
          };
        }

        if (input.dry_run) {
          const config = engine.getConfig();
          const retentionDays = input.retention_days ?? config.compaction.retentionDays;

          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

          const claimCount = await db.query<{ count: number }>(
            `SELECT COUNT(*) as count FROM claims WHERE created_at < ?`,
            [cutoffDate.toISOString()]
          );

          const evidenceCount = await db.query<{ count: number }>(
            `SELECT COUNT(*) as count FROM evidence e
             JOIN claims c ON e.claim_id = c.claim_id
             WHERE c.created_at < ?`,
            [cutoffDate.toISOString()]
          );

          const claims = claimCount[0]?.count ?? 0;
          const evidence = evidenceCount[0]?.count ?? 0;

          return {
            success: true,
            summary:
              `Dry run: Would archive ${claims} claims and ${evidence} evidence items ` +
              `older than ${retentionDays} days (before ${cutoffDate.toISOString().split("T")[0]}).`,
          };
        }

        const config = engine.getConfig();
        const compactionConfig: Partial<CompactionConfig> = {
          ...config.compaction,
        };

        if (input.retention_days) {
          compactionConfig.retentionDays = input.retention_days;
        }

        const compactor = new VeridicCompactor(db, compactionConfig);
        const startTime = Date.now();
        const report = await compactor.compact();
        const duration = (Date.now() - startTime) / 1000;

        const spaceSavedMB = Math.round(report.spaceSaved / 1024 / 1024 * 100) / 100;

        let summary = `Compaction ${report.status}. `;
        summary += `Archived ${report.claimsArchived} claims and ${report.evidenceArchived} evidence. `;
        summary += `Cleaned ${report.orphansCleaned} orphans. `;
        summary += `Saved ${spaceSavedMB}MB in ${duration.toFixed(1)}s.`;

        if (report.errors.length > 0) {
          summary += ` ${report.errors.length} errors occurred.`;
        }

        return {
          success: report.status !== "failed",
          summary,
          report: {
            compaction_id: report.compactionId,
            claims_archived: report.claimsArchived,
            evidence_archived: report.evidenceArchived,
            orphans_cleaned: report.orphansCleaned,
            space_saved_mb: spaceSavedMB,
            duration_seconds: duration,
            status: report.status,
            errors: report.errors,
          },
        };
      } catch (error) {
        return {
          success: false,
          summary: `Compaction failed: ${error}`,
        };
      }
    },
  };
}
