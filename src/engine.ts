/**
 * ClawMemoryEngine - Main verification engine for Claw Memory
 *
 * Pipeline:
 * 1. Extract claims from agent responses
 * 2. Collect evidence from multiple sources
 * 3. Verify claims against evidence (retry max 2 times)
 * 4. Warn user on success/failure
 */

import type { Database } from "./core/database.js";
import type {
  Claim,
  ClawMemoryConfig,
  ClawMemoryDependencies,
  ClaimType,
  LLMApi,
} from "./types.js";
import { resolveConfig, getConfigFromEnv } from "./config.js";
import { initClawMemorySchema } from "./schema.js";
import { createStores, ClawMemoryStores } from "./store/index.js";
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
 * const engine = new ClawMemoryEngine(db);
 * await engine.initialize();
 *
 * engine.setSession("session-123");
 * const result = await engine.processResponse("I created file.ts");
 * console.log(result.claims);
 * console.log(result.warnings);
 * ```
 */
export class ClawMemoryEngine {
  private db: Database;
  private config: ClawMemoryConfig;
  private stores: ClawMemoryStores;
  private extractor: ClaimExtractor;
  private collector: EvidenceCollector;
  private verifier: ClaimVerifier;
  private state: EngineState;
  private deps: ClawMemoryDependencies | null = null;

  // v0.2 additions: Vector Search, Knowledge Graph, Temporal Memory
  private embeddingService: EmbeddingService;
  private vectorStore: VectorStore;
  private graphService: GraphService;
  private temporalStore: TemporalStore;
  private timelineService: TimelineService;

  constructor(db: Database, config?: Partial<ClawMemoryConfig>) {
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
  async initialize(deps?: ClawMemoryDependencies): Promise<void> {
    if (this.state.initialized) return;

    await initClawMemorySchema(this.db);

    if (deps) {
      this.deps = deps;
    }

    this.state.initialized = true;
    this.log("info", "ClawMemoryEngine initialized");
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
   * Get the current session ID
   * @returns Current session ID or null if not set
   */
  getSession(): string | null {
    return this.state.currentSessionId;
  }

  /**
   * Process an agent response to extract and verify claims
   * Retry max 2 times on contradiction, warn user on result
   */
  async processResponse(
    response: string,
    responseId?: string | null,
    llmApi?: LLMApi
  ): Promise<{
    claims: Claim[];
    verifications: FullVerificationResult[];
    warnings: string[];
  }> {
    const sessionId = this.state.currentSessionId;
    if (!sessionId) {
      this.log("warn", "No session set, skipping response processing");
      return { claims: [], verifications: [], warnings: [] };
    }

    if (!this.extractor.shouldExtract(response)) {
      this.log("debug", "Response does not contain actionable claims");
      return { claims: [], verifications: [], warnings: [] };
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
    const warnings: string[] = [];

    if (this.config.autoVerify && storedClaims.length > 0) {
      verifications = await this.verifier.verifyAll(storedClaims);

      for (const v of verifications) {
        if (v.verification.status === "verified") {
          warnings.push(`[OK] Verified: ${v.claim.original_text}`);
        } else if (v.verification.status === "contradicted") {
          warnings.push(`[FAIL] Contradicted: ${v.claim.original_text} - ${v.verification.details}`);
        }
      }

      this.log("info", `Verified ${verifications.length} claims`);
    }

    return { claims: storedClaims, verifications, warnings };
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
   * Internal logging helper
   */
  private log(level: "debug" | "info" | "warn" | "error", message: string, data?: unknown): void {
    if (this.deps?.log) {
      this.deps.log(level, `[claw-memory] ${message}`, data);
    } else {
      const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
      fn(`[claw-memory] ${message}`, data ?? "");
    }
  }

  /**
   * Get access to internal stores for advanced usage
   */
  getStores(): ClawMemoryStores {
    return this.stores;
  }

  /**
   * Get direct access to the database instance
   * Used by compaction and other advanced operations
   */
  getDatabase(): Database {
    return this.db;
  }

  /**
   * Get current configuration
   */
  getConfig(): ClawMemoryConfig {
    return this.config;
  }

  /**
   * Close the engine and release resources
   */
  async close(): Promise<void> {
    this.state.initialized = false;
    this.state.currentSessionId = null;
    this.state.currentTaskId = null;
    await this.db.close();
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
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    // Extract entities from claim's entity list
    if (claim.entities && Array.isArray(claim.entities)) {
      const entityStore = this.graphService.getEntityStore();
      const relationshipStore = this.graphService.getRelationshipStore();

      for (const entityData of claim.entities) {
        // Determine entity type from claim type
        const entityType = this.getEntityTypeFromClaim(claim.claim_type, entityData);
        const entityName = typeof entityData === "string" ? entityData : String(entityData);

        // Check if entity already exists
        let entity = await this.graphService.findEntity(
          claim.session_id,
          entityType,
          entityName
        );

        if (!entity) {
          // Create new entity
          entity = await entityStore.create({
            sessionId: claim.session_id,
            type: entityType,
            name: entityName,
            metadata: {
              claimId: claim.claim_id,
              claimType: claim.claim_type,
            },
          });
        }

        entities.push(entity);
      }

      // Create relationships between entities if multiple exist
      if (entities.length >= 2) {
        const relType = this.getRelationshipTypeFromClaim(claim.claim_type);
        const relationship = await relationshipStore.create({
          sessionId: claim.session_id,
          fromEntityId: entities[0].entityId,
          toEntityId: entities[1].entityId,
          type: relType,
          sourceId: claim.claim_id,
          confidence: claim.confidence,
        });
        relationships.push(relationship);
      }
    }

    return { entities, relationships };
  }

  /**
   * Map claim type to entity type
   */
  private getEntityTypeFromClaim(claimType: ClaimType, _entityData: unknown): string {
    const typeMap: Partial<Record<ClaimType, string>> = {
      file_created: "file",
      file_modified: "file",
      file_deleted: "file",
      code_added: "function",
      code_removed: "function",
      code_fixed: "function",
      command_executed: "command",
      test_passed: "test",
      test_failed: "test",
      error_fixed: "error",
      dependency_added: "package",
      config_changed: "file",
      task_completed: "file",
    };
    return typeMap[claimType] ?? "file";
  }

  /**
   * Map claim type to relationship type
   */
  private getRelationshipTypeFromClaim(claimType: ClaimType): string {
    const typeMap: Partial<Record<ClaimType, string>> = {
      file_created: "CREATED_BY",
      file_modified: "MODIFIED_BY",
      code_added: "CONTAINS",
      code_fixed: "FIXES",
      test_passed: "TESTS",
      test_failed: "TESTS",
      dependency_added: "DEPENDS_ON",
    };
    return typeMap[claimType] ?? "RELATED_TO";
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
      sourceId?: string;
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
      sourceId: options?.sourceId,
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
 * Factory function to create a ClawMemoryEngine instance
 */
export function createClawMemoryEngine(
  db: Database,
  config?: Partial<ClawMemoryConfig>
): ClawMemoryEngine {
  return new ClawMemoryEngine(db, config);
}
