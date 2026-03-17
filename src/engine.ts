
import type { Database } from "./core/database.js";
import type {
  Claim,
  TrustScore,
  TrustContext,
  TrustReport,
  TrustIssue,
  VeridicConfig,
  VeridicDependencies,
  ClaimType,
  LLMApi,
} from "./types.js";
import { resolveConfig, getConfigFromEnv } from "./config.js";
import { initVeridicSchema } from "./schema.js";
import { createStores, VeridicStores } from "./store/index.js";
import { createClaimExtractor, ClaimExtractor } from "./extractor/index.js";
import { createEvidenceCollector, EvidenceCollector } from "./collector/index.js";
import { createClaimVerifier, ClaimVerifier, FullVerificationResult } from "./verifier/index.js";

interface EngineState {
  initialized: boolean;
  currentSessionId: string | null;
  currentTaskId: string | null;
}

export class VeridicEngine {
  private db: Database;
  private config: VeridicConfig;
  private stores: VeridicStores;
  private extractor: ClaimExtractor;
  private collector: EvidenceCollector;
  private verifier: ClaimVerifier;
  private state: EngineState;
  private deps: VeridicDependencies | null = null;

  constructor(db: Database, config?: Partial<VeridicConfig>) {
    this.db = db;
    this.config = resolveConfig({ ...getConfigFromEnv(), ...config });
    this.stores = createStores(db);
    this.extractor = createClaimExtractor(this.config);
    this.collector = createEvidenceCollector(db);
    this.verifier = createClaimVerifier(db, this.config);
    this.state = {
      initialized: false,
      currentSessionId: null,
      currentTaskId: null,
    };
  }

  
  async initialize(deps?: VeridicDependencies): Promise<void> {
    if (this.state.initialized) return;

    await initVeridicSchema(this.db);

    if (deps) {
      this.deps = deps;
    }

    this.state.initialized = true;
    this.log("info", "VeridicEngine initialized");
  }

  
  setSession(sessionId: string, taskId?: string | null): void {
    this.state.currentSessionId = sessionId;
    this.state.currentTaskId = taskId ?? null;
  }

  
  async processResponse(
    response: string,
    responseId?: string | null,
    llmApi?: LLMApi
  ): Promise<{
    claims: Claim[];
    verifications: FullVerificationResult[];
    trustScore: TrustScore | null;
  }> {
    const sessionId = this.state.currentSessionId;
    if (!sessionId) {
      this.log("warn", "No session set, skipping response processing");
      return { claims: [], verifications: [], trustScore: null };
    }

    if (!this.extractor.shouldExtract(response)) {
      this.log("debug", "Response does not contain actionable claims");
      return { claims: [], verifications: [], trustScore: null };
    }

    const extractionResult = await this.extractor.extract(
      response,
      sessionId,
      this.state.currentTaskId,
      responseId ?? null,
      llmApi ?? this.deps?.llmApi
    );

    this.log("info", `Extracted ${extractionResult.claims.length} claims`);

    const storedClaims: Claim[] = [];
    for (const claim of extractionResult.claims) {
      const stored = await this.stores.claims.create(
        claim.session_id,
        claim.claim_type,
        claim.original_text,
        claim.entities,
        claim.confidence,
        claim.task_id,
        claim.response_id
      );
      storedClaims.push(stored);
    }

    let verifications: FullVerificationResult[] = [];
    if (this.config.autoVerify && storedClaims.length > 0) {
      verifications = await this.verifier.verifyAll(storedClaims);
      this.log("info", `Verified ${verifications.length} claims`);
    }

    let trustScore: TrustScore | null = null;
    if (storedClaims.length > 0) {
      trustScore = await this.calculateAndStoreTrustScore(sessionId);
    }

    return {
      claims: storedClaims,
      verifications,
      trustScore,
    };
  }

  
  async getTrustContext(sessionId?: string): Promise<TrustContext> {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) {
      return {
        session_id: "",
        current_score: 100,
        recent_issues: [],
      };
    }

    const latestScore = await this.stores.trustScores.getLatest(sid);
    const score = latestScore?.overall_score ?? 100;

    const contradictions = await this.verifier.getContradictions(sid);
    const recentIssues: TrustIssue[] = contradictions.slice(0, 5).map((c) => ({
      claim_id: c.claim.claim_id,
      claim_type: c.claim.claim_type,
      claim_text: c.claim.original_text,
      status: c.verification.status,
      severity: this.getSeverity(c.claim.claim_type),
      details: c.verification.details,
    }));

    let warningMessage: string | undefined;
    if (score < this.config.trustWarningThreshold) {
      warningMessage = this.generateWarningMessage(score, recentIssues);
    }

    return {
      session_id: sid,
      current_score: score,
      recent_issues: recentIssues,
      warning_message: warningMessage,
    };
  }

  
  async generateReport(sessionId?: string): Promise<TrustReport> {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) {
      throw new Error("No session specified");
    }

    const stats = await this.verifier.getStats(sid);
    const latestScore = await this.stores.trustScores.getLatest(sid);
    const contradictions = await this.verifier.getContradictions(sid);

    const claimStats = await this.stores.claims.getStats(sid);

    const categoryBreakdown: Record<ClaimType, { total: number; verified: number; contradicted: number }> = {} as Record<ClaimType, { total: number; verified: number; contradicted: number }>;

    for (const [type, count] of Object.entries(claimStats.by_type)) {
      const typeClaims = await this.stores.claims.getByType(sid, type as ClaimType);
      let verified = 0;
      let contradicted = 0;

      for (const claim of typeClaims) {
        const verification = await this.stores.verifications.getByClaimId(claim.claim_id);
        if (verification?.status === "verified") verified++;
        else if (verification?.status === "contradicted") contradicted++;
      }

      categoryBreakdown[type as ClaimType] = {
        total: count,
        verified,
        contradicted,
      };
    }

    const issues: TrustIssue[] = contradictions.map((c) => ({
      claim_id: c.claim.claim_id,
      claim_type: c.claim.claim_type,
      claim_text: c.claim.original_text,
      status: c.verification.status,
      severity: this.getSeverity(c.claim.claim_type),
      details: c.verification.details,
    }));

    const recommendations = this.generateRecommendations(stats, issues);

    return {
      session_id: sid,
      generated_at: new Date(),
      summary: {
        overall_score: latestScore?.overall_score ?? 100,
        total_claims: stats.total_claims,
        verified: stats.verified,
        contradicted: stats.contradicted,
        unverified: stats.unverified,
        accuracy_rate: stats.accuracy_rate,
      },
      category_breakdown: categoryBreakdown,
      issues,
      recommendations,
    };
  }

  
  async verifyClaim(claimId: string): Promise<FullVerificationResult | null> {
    return this.verifier.reverify(claimId);
  }

  
  async searchClaims(query: string, sessionId?: string) {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) return [];

    return this.verifier.search(sid, query);
  }

  
  async getCurrentScore(sessionId?: string): Promise<number> {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) return 100;

    const latest = await this.stores.trustScores.getLatest(sid);
    return latest?.overall_score ?? 100;
  }

  
  async shouldBlock(sessionId?: string): Promise<boolean> {
    const score = await this.getCurrentScore(sessionId);
    return score < this.config.trustBlockThreshold;
  }

  
  private async calculateAndStoreTrustScore(sessionId: string): Promise<TrustScore> {
    const stats = await this.verifier.getStats(sessionId);

    let overallScore = 100;

    if (stats.total_claims > 0) {
      const contradictionPenalty = (stats.contradicted / stats.total_claims) * 50;

      const unverifiedPenalty = (stats.unverified / stats.total_claims) * 20;

      const verifiedBonus = (stats.verified / stats.total_claims) * 10;

      overallScore = Math.max(0, Math.min(100, 100 - contradictionPenalty - unverifiedPenalty + verifiedBonus));
    }

    const categoryScores: Record<string, number> = {};
    const claimStats = await this.stores.claims.getStats(sessionId);

    for (const [type, count] of Object.entries(claimStats.by_type)) {
      if (count > 0) {
        const weight = this.config.severityWeights[type as keyof typeof this.config.severityWeights] ?? 1;
        categoryScores[type] = overallScore * weight;
      }
    }

    const trustScore = await this.stores.trustScores.create(
      sessionId,
      overallScore,
      categoryScores,
      stats.total_claims,
      stats.verified,
      stats.contradicted,
      stats.unverified
    );

    this.log("info", `Trust score calculated: ${overallScore.toFixed(1)}`);

    return trustScore;
  }

  
  private getSeverity(claimType: ClaimType): "low" | "medium" | "high" | "critical" {
    const severityMap: Record<ClaimType, "low" | "medium" | "high" | "critical"> = {
      file_created: "high",
      file_modified: "high",
      file_deleted: "critical",
      code_added: "medium",
      code_removed: "medium",
      code_fixed: "high",
      command_executed: "low",
      test_passed: "critical",
      test_failed: "medium",
      error_fixed: "high",
      dependency_added: "medium",
      config_changed: "medium",
      task_completed: "high",
      unknown: "low",
    };

    return severityMap[claimType] ?? "low";
  }

  
  private generateWarningMessage(score: number, issues: TrustIssue[]): string {
    const criticalIssues = issues.filter((i) => i.severity === "critical").length;
    const highIssues = issues.filter((i) => i.severity === "high").length;

    let message = `[TRUST WARNING] Score: ${score.toFixed(0)}/100.`;

    if (criticalIssues > 0) {
      message += ` ${criticalIssues} critical false claims detected.`;
    }
    if (highIssues > 0) {
      message += ` ${highIssues} high-severity issues.`;
    }

    message += " Verify agent actions carefully.";

    return message;
  }

  
  private generateRecommendations(
    stats: { accuracy_rate: number; contradicted: number },
    issues: TrustIssue[]
  ): string[] {
    const recommendations: string[] = [];

    if (stats.contradicted > 0) {
      recommendations.push("Review contradicted claims and verify actual state of files/commands");
    }

    if (stats.accuracy_rate < 0.8) {
      recommendations.push("Consider enabling more detailed verification for future sessions");
    }

    const testIssues = issues.filter((i) => i.claim_type === "test_passed");
    if (testIssues.length > 0) {
      recommendations.push("CRITICAL: Agent falsely claimed tests passed. Run tests manually to verify.");
    }

    const fileIssues = issues.filter(
      (i) => i.claim_type === "file_created" || i.claim_type === "file_modified"
    );
    if (fileIssues.length > 0) {
      recommendations.push("Check file system for claimed file operations.");
    }

    if (recommendations.length === 0) {
      recommendations.push("No significant issues detected. Continue monitoring.");
    }

    return recommendations;
  }

  
  private log(level: "debug" | "info" | "warn" | "error", message: string, data?: unknown): void {
    if (this.deps?.log) {
      this.deps.log(level, `[veridic-claw] ${message}`, data);
    } else {
      const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      fn(`[veridic-claw] ${message}`, data ?? "");
    }
  }

  
  getStores(): VeridicStores {
    return this.stores;
  }

  
  getConfig(): VeridicConfig {
    return this.config;
  }
}

export function createVeridicEngine(
  db: Database,
  config?: Partial<VeridicConfig>
): VeridicEngine {
  return new VeridicEngine(db, config);
}
