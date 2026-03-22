export interface CompactionConfig {
  retentionDays: number;
  preserveContradicted: boolean;
  vacuum: boolean;
  reindex: boolean;
  analyze: boolean;
  autoCompact: boolean;
  compactInterval: string;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  retentionDays: 30,
  preserveContradicted: true,
  vacuum: true,
  reindex: false,
  analyze: true,
  autoCompact: false,
  compactInterval: "0 2 * * *",
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
