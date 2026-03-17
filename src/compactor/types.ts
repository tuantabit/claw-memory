
export interface CompactionConfig {
  /** Number of days to retain before archiving (default: 30) */
  retentionDays: number;

  /** Preserve contradicted claims (never archive) */
  preserveContradicted: boolean;

  /** Preserve low trust sessions (trust < 50%) */
  preserveLowTrust: boolean;

  /** Run VACUUM after compaction */
  vacuum: boolean;

  /** Rebuild indexes after compaction */
  reindex: boolean;

  /** Run ANALYZE after compaction */
  analyze: boolean;

  /** Enable auto-compaction */
  autoCompact: boolean;

  /** Cron expression for auto-compaction (e.g., "0 2 * * *" for daily at 2am) */
  compactInterval: string;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  retentionDays: 30,
  preserveContradicted: true,
  preserveLowTrust: true,
  vacuum: true,
  reindex: false,
  analyze: true,
  autoCompact: false,
  compactInterval: "0 2 * * *", // Daily at 2am
};

export interface CompactionReport {
  compactionId: string;
  startedAt: Date;
  completedAt: Date | null;

  retentionDays: number;

  claimsArchived: number;
  evidenceArchived: number;
  orphansCleaned: number;

  sizeBefore: number;
  sizeAfter: number;
  spaceSaved: number;

  status: "running" | "success" | "partial" | "failed";
  errors: string[];
}

export interface DailySummary {
  summaryId: string;
  summaryDate: Date;
  sessionId: string | null;
  totalClaims: number;
  verifiedClaims: number;
  contradictedClaims: number;
  unverifiedClaims: number;
  avgConfidence: number;
  avgTrustScore: number;
  claimTypes: Record<string, number>;
  createdAt: Date;
}

export interface ArchivedClaim {
  claimId: string;
  sessionId: string;
  claimType: string;
  originalText: string;
  confidence: number;
  verificationStatus: string | null;
  originalCreatedAt: Date;
  archivedAt: Date;
}

export interface ArchivedEvidence {
  evidenceId: string;
  claimId: string;
  source: string;
  supportsClaim: boolean;
  confidence: number;
  originalCollectedAt: Date;
  archivedAt: Date;
}
