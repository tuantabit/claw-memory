/**
 * VeridicEngine - Main verification engine for Claw Memory
 *
 * This engine orchestrates the entire verification pipeline:
 * 1. Extract claims from agent responses
 * 2. Collect evidence from multiple sources
 * 3. Verify claims against evidence
 * 4. Calculate and track trust scores
 */

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

// v0.2 imports
import {
  LocalEmbeddingService,
  VectorStore,
  createEmbeddingService,
  createVectorStore,
  type EmbeddingService,
  type SimilarityResult,
} from "./memory/index.js";
import {
  GraphService,
  createGraphService,
  type Entity,
  type Relationship,
  type EntityWithRelationships,
  type GraphPath,
  type GraphStats,
} from "./graph/index.js";
import {
  TemporalStore,
  TimelineService,
  createTemporalStore,
  createTimelineService,
  type TemporalEvent,
  type TemporalStats,
  type TimelineSegment,
  type ParsedTimeRange,
} from "./temporal/index.js";

/**
 * Internal state of the engine
 */
interface EngineState {
  initialized: boolean;
  currentSessionId: string | null;
  currentTaskId: string | null;
}

/**
 * Main verification engine class
 *
 * @example
 * ```typescript
 * const db = createDatabase(":memory:");
 * const engine = new VeridicEngine(db);
 * await engine.initialize();
 *
 * engine.setSession("session-123");
 * const result = await engine.processResponse("I created file.ts");
 * console.log(result.claims);
 * console.log(result.trustScore);
 * ```
 */
export class VeridicEngine {
  private db: Database;
  private config: VeridicConfig;
  private stores: VeridicStores;
  private extractor: ClaimExtractor;
  private collector: EvidenceCollector;
  private verifier: ClaimVerifier;
  private state: EngineState;
  private deps: VeridicDependencies | null = null;

  // v0.2 additions: Vector Search, Knowledge Graph, Temporal Memory
  private embeddingService: EmbeddingService;
  private vectorStore: VectorStore;
  private graphService: GraphService;
  private temporalStore: TemporalStore;
  private timelineService: TimelineService;

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

    // v0.2: Initialize Vector Search, Knowledge Graph, Temporal Memory
    this.embeddingService = createEmbeddingService();
    this.vectorStore = createVectorStore(db);
    this.graphService = createGraphService(db);
    this.temporalStore = createTemporalStore(db);
    this.timelineService = createTimelineService(db);
  }

  /**
   * Initialize the engine and database schema
   * Must be called before processing responses
   */
  async initialize(deps?: VeridicDependencies): Promise<void> {
    if (this.state.initialized) return;

    await initVeridicSchema(this.db);

    if (deps) {
      this.deps = deps;
    }

    this.state.initialized = true;
    this.log("info", "VeridicEngine initialized");
  }

  /**
   * Set the current session and task context
   * All subsequent operations will use this context
   */
  setSession(sessionId: string, taskId?: string | null): void {
    this.state.currentSessionId = sessionId;
    this.state.currentTaskId = taskId ?? null;
  }

  /**
   * Process an agent response to extract, verify claims, and update trust score
   *
   * @param response - The agent's response text
   * @param responseId - Optional ID for the response
   * @param llmApi - Optional LLM API for hybrid extraction
   * @returns Claims, verifications, and updated trust score
   */
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

    // Check if response contains actionable claims
    if (!this.extractor.shouldExtract(response)) {
      this.log("debug", "Response does not contain actionable claims");
      return { claims: [], verifications: [], trustScore: null };
    }

    // Extract claims using regex and optionally LLM
    const extractionResult = await this.extractor.extract(
      response,
      sessionId,
      this.state.currentTaskId,
      responseId ?? null,
      llmApi ?? this.deps?.llmApi
    );

    this.log("info", `Extracted ${extractionResult.claims.length} claims`);

    // Store extracted claims
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

    // Auto-verify if enabled
    let verifications: FullVerificationResult[] = [];
    if (this.config.autoVerify && storedClaims.length > 0) {
      verifications = await this.verifier.verifyAll(storedClaims);
      this.log("info", `Verified ${verifications.length} claims`);
    }

    // Calculate and store trust score
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

  /**
   * Get current trust context including score and recent issues
   */
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

    // Get recent contradictions as issues
    const contradictions = await this.verifier.getContradictions(sid);
    const recentIssues: TrustIssue[] = contradictions.slice(0, 5).map((c) => ({
      claim_id: c.claim.claim_id,
      claim_type: c.claim.claim_type,
      claim_text: c.claim.original_text,
      status: c.verification.status,
      severity: this.getSeverity(c.claim.claim_type),
      details: c.verification.details,
    }));

    // Generate warning if score is below threshold
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

  /**
   * Generate a full trust report for a session
   */
  async generateReport(sessionId?: string): Promise<TrustReport> {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) {
      throw new Error("No session specified");
    }

    const stats = await this.verifier.getStats(sid);
    const latestScore = await this.stores.trustScores.getLatest(sid);
    const contradictions = await this.verifier.getContradictions(sid);

    const claimStats = await this.stores.claims.getStats(sid);

    // Build category breakdown
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

    // Build issues list
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

  /**
   * Manually verify or re-verify a specific claim
   */
  async verifyClaim(claimId: string): Promise<FullVerificationResult | null> {
    return this.verifier.reverify(claimId);
  }

  /**
   * Search claims by query string
   */
  async searchClaims(query: string, sessionId?: string) {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) return [];

    return this.verifier.search(sid, query);
  }

  /**
   * Get the current trust score (0-100)
   */
  async getCurrentScore(sessionId?: string): Promise<number> {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) return 100;

    const latest = await this.stores.trustScores.getLatest(sid);
    return latest?.overall_score ?? 100;
  }

  /**
   * Check if the agent should be blocked due to low trust
   */
  async shouldBlock(sessionId?: string): Promise<boolean> {
    const score = await this.getCurrentScore(sessionId);
    return score < this.config.trustBlockThreshold;
  }

  /**
   * Calculate trust score based on verification statistics
   * Score = 100 - contradiction_penalty - unverified_penalty + verified_bonus
   */
  private async calculateAndStoreTrustScore(sessionId: string): Promise<TrustScore> {
    const stats = await this.verifier.getStats(sessionId);

    let overallScore = 100;

    if (stats.total_claims > 0) {
      // Penalty for contradictions (up to 50 points)
      const contradictionPenalty = (stats.contradicted / stats.total_claims) * 50;

      // Penalty for unverified claims (up to 20 points)
      const unverifiedPenalty = (stats.unverified / stats.total_claims) * 20;

      // Bonus for verified claims (up to 10 points)
      const verifiedBonus = (stats.verified / stats.total_claims) * 10;

      overallScore = Math.max(0, Math.min(100, 100 - contradictionPenalty - unverifiedPenalty + verifiedBonus));
    }

    // Calculate category-weighted scores
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

  /**
   * Map claim type to severity level
   */
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

  /**
   * Generate warning message for low trust score
   */
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

  /**
   * Generate actionable recommendations based on issues
   */
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

  /**
   * Internal logging helper
   */
  private log(level: "debug" | "info" | "warn" | "error", message: string, data?: unknown): void {
    if (this.deps?.log) {
      this.deps.log(level, `[veridic-claw] ${message}`, data);
    } else {
      const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      fn(`[veridic-claw] ${message}`, data ?? "");
    }
  }

  /**
   * Get access to internal stores for advanced usage
   */
  getStores(): VeridicStores {
    return this.stores;
  }

  /**
   * Get current configuration
   */
  getConfig(): VeridicConfig {
    return this.config;
  }

  // ============================================
  // v0.2 Methods: Vector Search, Knowledge Graph, Temporal Memory
  // ============================================

  /**
   * Search memory semantically using embeddings
   * Finds similar memories even without exact keyword match
   *
   * @param query - Search query text
   * @param sessionId - Optional session ID (uses current if not provided)
   * @param limit - Maximum results to return
   * @returns Similar memory entries with similarity scores
   */
  async searchSemantic(
    query: string,
    sessionId?: string,
    limit = 10
  ): Promise<SimilarityResult[]> {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) return [];

    const queryEmbedding = await this.embeddingService.embed(query);
    return this.vectorStore.search(queryEmbedding, { sessionId: sid, limit });
  }

  /**
   * Store an embedding for a memory entry
   *
   * @param memoryId - ID of the memory entry
   * @param sessionId - Session ID
   * @param text - Text to embed
   * @returns Vector ID
   */
  async storeEmbedding(
    memoryId: string,
    sessionId: string,
    text: string
  ): Promise<string> {
    const embedding = await this.embeddingService.embed(text);
    return this.vectorStore.store(memoryId, sessionId, embedding, "local");
  }

  /**
   * Process a claim to build knowledge graph
   * Extracts entities and relationships from the claim
   *
   * @param claim - The claim to process
   * @returns Extracted entities and relationships
   */
  async processClaimForGraph(
    claim: Claim
  ): Promise<{ entities: Entity[]; relationships: Relationship[] }> {
    return this.graphService.processClaim(claim);
  }

  /**
   * Get entity with all relationships
   *
   * @param entityId - Entity ID
   * @returns Entity with outgoing and incoming relationships
   */
  async getEntityWithRelationships(
    entityId: string
  ): Promise<EntityWithRelationships | null> {
    return this.graphService.getEntityWithRelationships(entityId);
  }

  /**
   * Find path between two entities in the knowledge graph
   *
   * @param fromEntityId - Starting entity ID
   * @param toEntityId - Target entity ID
   * @param maxDepth - Maximum path depth
   * @returns Graph path or null if not found
   */
  async findGraphPath(
    fromEntityId: string,
    toEntityId: string,
    maxDepth = 5
  ): Promise<GraphPath | null> {
    return this.graphService.findPath(fromEntityId, toEntityId, maxDepth);
  }

  /**
   * Search entities by name pattern
   *
   * @param pattern - Search pattern
   * @param sessionId - Optional session ID
   * @returns Matching entities
   */
  async searchEntities(pattern: string, sessionId?: string): Promise<Entity[]> {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) return [];
    return this.graphService.searchEntities(sid, pattern);
  }

  /**
   * Get graph statistics
   *
   * @param sessionId - Optional session ID
   * @returns Graph statistics
   */
  async getGraphStats(sessionId?: string): Promise<GraphStats | null> {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) return null;
    return this.graphService.getStats(sid);
  }

  /**
   * Record a temporal event
   *
   * @param eventType - Type of event
   * @param sessionId - Session ID
   * @param options - Additional options
   * @returns Created temporal event
   */
  async recordTemporalEvent(
    eventType: TemporalEvent["eventType"],
    sessionId?: string,
    options?: {
      entityId?: string;
      claimId?: string;
      relationshipId?: string;
      eventData?: Record<string, unknown>;
      occurredAt?: Date;
    }
  ): Promise<TemporalEvent> {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) throw new Error("No session specified");

    return this.temporalStore.create({
      sessionId: sid,
      eventType,
      entityId: options?.entityId,
      claimId: options?.claimId,
      relationshipId: options?.relationshipId,
      eventData: options?.eventData,
      occurredAt: options?.occurredAt,
    });
  }

  /**
   * Query events by natural language time expression
   * Examples: "last week", "3 days ago", "today"
   *
   * @param expression - Natural language time expression
   * @param sessionId - Optional session ID
   * @returns Events in the time range
   */
  async queryByTime(
    expression: string,
    sessionId?: string
  ): Promise<TemporalEvent[]> {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) return [];

    return this.timelineService.queryByTimeExpression(sid, expression);
  }

  /**
   * Get timeline of events
   *
   * @param options - Timeline options
   * @returns Events in chronological order
   */
  async getTimeline(
    options?: {
      sessionId?: string;
      startTime?: Date;
      endTime?: Date;
      limit?: number;
    }
  ): Promise<TemporalEvent[]> {
    const sid = options?.sessionId ?? this.state.currentSessionId;
    if (!sid) return [];

    return this.timelineService.getTimeline(sid, {
      startTime: options?.startTime,
      endTime: options?.endTime,
      limit: options?.limit,
    });
  }

  /**
   * Get timeline segmented by time period
   *
   * @param segmentDuration - Segment duration (hour, day, week, month)
   * @param sessionId - Optional session ID
   * @returns Timeline segments
   */
  async getTimelineSegments(
    segmentDuration: "hour" | "day" | "week" | "month",
    sessionId?: string
  ): Promise<TimelineSegment[]> {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) return [];

    return this.timelineService.getTimelineSegments(sid, segmentDuration);
  }

  /**
   * Get activity summary for a time period
   *
   * @param expression - Natural language time expression
   * @param sessionId - Optional session ID
   * @returns Activity summary
   */
  async getActivitySummary(
    expression: string,
    sessionId?: string
  ): Promise<{
    timeRange: ParsedTimeRange;
    totalEvents: number;
    byType: Partial<Record<TemporalEvent["eventType"], number>>;
    peakHour?: number;
  } | null> {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) return null;

    return this.timelineService.getActivitySummary(sid, expression);
  }

  /**
   * Get temporal statistics
   *
   * @param sessionId - Optional session ID
   * @returns Temporal statistics
   */
  async getTemporalStats(sessionId?: string): Promise<TemporalStats | null> {
    const sid = sessionId ?? this.state.currentSessionId;
    if (!sid) return null;

    return this.temporalStore.getStats(sid);
  }

  /**
   * Get direct access to v0.2 services
   */
  getEmbeddingService(): EmbeddingService {
    return this.embeddingService;
  }

  getVectorStore(): VectorStore {
    return this.vectorStore;
  }

  getGraphService(): GraphService {
    return this.graphService;
  }

  getTemporalStore(): TemporalStore {
    return this.temporalStore;
  }

  getTimelineService(): TimelineService {
    return this.timelineService;
  }
}

/**
 * Factory function to create a VeridicEngine instance
 */
export function createVeridicEngine(
  db: Database,
  config?: Partial<VeridicConfig>
): VeridicEngine {
  return new VeridicEngine(db, config);
}
