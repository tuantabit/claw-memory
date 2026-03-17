/**
 * Claim Store - Persistence layer for agent claims
 *
 * This store handles all database operations for claims:
 * - Creating new claims from extracted agent responses
 * - Querying claims by session, task, type, or filter
 * - Full-text search across claim text
 * - Statistics and aggregations
 *
 * Claims are the foundation of the verification system - they represent
 * what an agent claims to have done (created files, ran commands, etc.)
 */

import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type {
  Claim,
  ClaimType,
  ClaimEntity,
  ClaimFilter,
  QueryOptions,
} from "../types.js";

/**
 * Store for managing claims in the database
 *
 * @example
 * ```typescript
 * const store = new ClaimStore(db);
 *
 * // Create a new claim
 * const claim = await store.create(
 *   "session-123",
 *   "file_created",
 *   "I created src/index.ts",
 *   [{ type: "file", value: "src/index.ts" }],
 *   0.9
 * );
 *
 * // Query claims
 * const sessionClaims = await store.getBySession("session-123");
 * const unverified = await store.getUnverified("session-123");
 *
 * // Search claims
 * const results = await store.search("session-123", "index.ts");
 * ```
 */
export class ClaimStore {
  constructor(private db: Database) {}

  /**
   * Create a new claim in the database
   *
   * @param sessionId - Session this claim belongs to
   * @param claimType - Type of claim (file_created, command_executed, etc.)
   * @param originalText - The original text from agent response
   * @param entities - Extracted entities (files, commands, etc.)
   * @param confidence - Extraction confidence score (0.0-1.0)
   * @param taskId - Optional task ID
   * @param responseId - Optional response ID for tracking
   * @returns The created claim with generated ID
   */
  async create(
    sessionId: string,
    claimType: ClaimType,
    originalText: string,
    entities: ClaimEntity[],
    confidence: number,
    taskId?: string | null,
    responseId?: string | null
  ): Promise<Claim> {
    const claim: Claim = {
      claim_id: nanoid(),
      session_id: sessionId,
      task_id: taskId ?? null,
      response_id: responseId ?? null,
      claim_type: claimType,
      original_text: originalText,
      entities,
      confidence,
      created_at: new Date(),
    };

    await this.db.insert("claims", {
      claim_id: claim.claim_id,
      session_id: claim.session_id,
      task_id: claim.task_id,
      response_id: claim.response_id,
      claim_type: claim.claim_type,
      original_text: claim.original_text,
      entities: JSON.stringify(claim.entities),
      confidence: claim.confidence,
    });

    return claim;
  }

  /**
   * Get a claim by its unique ID
   *
   * @param claimId - The claim ID to look up
   * @returns The claim if found, null otherwise
   */
  async getById(claimId: string): Promise<Claim | null> {
    const rows = await this.db.query<Claim>(
      `SELECT * FROM claims WHERE claim_id = ?`,
      [claimId]
    );

    if (rows.length === 0) return null;

    return this.hydrate(rows[0]);
  }

  /**
   * Get all claims for a session with pagination
   *
   * @param sessionId - Session ID to query
   * @param options - Pagination and sorting options
   * @returns Array of claims for the session
   */
  async getBySession(
    sessionId: string,
    options?: QueryOptions
  ): Promise<Claim[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const orderBy = options?.orderBy ?? "created_at";
    const orderDir = options?.orderDir ?? "desc";

    const rows = await this.db.query<Claim>(
      `SELECT * FROM claims
       WHERE session_id = ?
       ORDER BY ${orderBy} ${orderDir}
       LIMIT ? OFFSET ?`,
      [sessionId, limit, offset]
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Get all claims for a specific task
   *
   * @param taskId - Task ID to query
   * @param options - Pagination options
   * @returns Array of claims for the task
   */
  async getByTask(taskId: string, options?: QueryOptions): Promise<Claim[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const rows = await this.db.query<Claim>(
      `SELECT * FROM claims
       WHERE task_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [taskId, limit, offset]
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Get claims matching a flexible filter
   *
   * Supports filtering by session, task, claim type, and minimum confidence.
   * All filters are ANDed together.
   *
   * @param filter - Filter criteria
   * @param options - Pagination and sorting options
   * @returns Array of matching claims
   */
  async getByFilter(
    filter: ClaimFilter,
    options?: QueryOptions
  ): Promise<Claim[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.session_id) {
      conditions.push("session_id = ?");
      params.push(filter.session_id);
    }

    if (filter.task_id) {
      conditions.push("task_id = ?");
      params.push(filter.task_id);
    }

    if (filter.claim_type) {
      conditions.push("claim_type = ?");
      params.push(filter.claim_type);
    }

    if (filter.min_confidence !== undefined) {
      conditions.push("confidence >= ?");
      params.push(filter.min_confidence);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const orderBy = options?.orderBy ?? "created_at";
    const orderDir = options?.orderDir ?? "desc";

    params.push(limit, offset);

    const rows = await this.db.query<Claim>(
      `SELECT * FROM claims
       ${whereClause}
       ORDER BY ${orderBy} ${orderDir}
       LIMIT ? OFFSET ?`,
      params
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Get claims that have not been verified yet
   *
   * Finds claims that have no corresponding verification record.
   * Useful for batch verification or showing pending items.
   *
   * @param sessionId - Session to query
   * @param limit - Maximum number of claims to return
   * @returns Array of unverified claims
   */
  async getUnverified(sessionId: string, limit = 50): Promise<Claim[]> {
    const rows = await this.db.query<Claim>(
      `SELECT c.* FROM claims c
       LEFT JOIN verifications v ON c.claim_id = v.claim_id
       WHERE c.session_id = ? AND v.verification_id IS NULL
       ORDER BY c.created_at DESC
       LIMIT ?`,
      [sessionId, limit]
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Get claims of a specific type within a session
   *
   * @param sessionId - Session to query
   * @param claimType - Type of claims to retrieve
   * @param limit - Maximum number to return
   * @returns Array of claims matching the type
   */
  async getByType(
    sessionId: string,
    claimType: ClaimType,
    limit = 50
  ): Promise<Claim[]> {
    const rows = await this.db.query<Claim>(
      `SELECT * FROM claims
       WHERE session_id = ? AND claim_type = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [sessionId, claimType, limit]
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Count total claims in a session
   *
   * @param sessionId - Session to count
   * @returns Total number of claims
   */
  async countBySession(sessionId: string): Promise<number> {
    const rows = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM claims WHERE session_id = ?`,
      [sessionId]
    );

    return Number(rows[0]?.count ?? 0);
  }

  /**
   * Get claim statistics for a session
   *
   * Returns breakdown by claim type and confidence level.
   *
   * @param sessionId - Session to analyze
   * @returns Statistics object with totals and breakdowns
   */
  async getStats(sessionId: string): Promise<{
    total: number;
    by_type: Record<string, number>;
    by_confidence: { high: number; medium: number; low: number };
  }> {
    const total = await this.countBySession(sessionId);

    const byType = await this.db.query<{ claim_type: string; count: number }>(
      `SELECT claim_type, COUNT(*) as count
       FROM claims
       WHERE session_id = ?
       GROUP BY claim_type`,
      [sessionId]
    );

    const byConfidence = await this.db.query<{
      level: string;
      count: number;
    }>(
      `SELECT
         CASE
           WHEN confidence >= 0.8 THEN 'high'
           WHEN confidence >= 0.5 THEN 'medium'
           ELSE 'low'
         END as level,
         COUNT(*) as count
       FROM claims
       WHERE session_id = ?
       GROUP BY level`,
      [sessionId]
    );

    const confMap = { high: 0, medium: 0, low: 0 };
    for (const row of byConfidence) {
      confMap[row.level as keyof typeof confMap] = Number(row.count);
    }

    return {
      total,
      by_type: Object.fromEntries(
        byType.map((r) => [r.claim_type, Number(r.count)])
      ),
      by_confidence: confMap,
    };
  }

  /**
   * Search claims by text using LIKE pattern matching
   *
   * @param sessionId - Session to search within
   * @param query - Text to search for
   * @param limit - Maximum results to return
   * @returns Array of matching claims
   */
  async search(sessionId: string, query: string, limit = 20): Promise<Claim[]> {
    const rows = await this.db.query<Claim>(
      `SELECT * FROM claims
       WHERE session_id = ? AND original_text LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [sessionId, `%${query}%`, limit]
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Full-text search across claims with optional filters
   *
   * More flexible than search() - allows cross-session search
   * and filtering by claim type.
   *
   * @param query - Text to search for
   * @param options - Optional filters and pagination
   * @returns Array of matching claims
   */
  async searchFTS(
    query: string,
    options?: {
      sessionId?: string;
      claimType?: ClaimType;
      limit?: number;
      offset?: number;
    }
  ): Promise<Claim[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.sessionId) {
      conditions.push("session_id = ?");
      params.push(options.sessionId);
    }

    if (options?.claimType) {
      conditions.push("claim_type = ?");
      params.push(options.claimType);
    }

    conditions.push("original_text LIKE ?");
    params.push(`%${query}%`);

    const whereClause = conditions.join(" AND ");
    params.push(limit, offset);

    const rows = await this.db.query<Claim>(
      `SELECT * FROM claims
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Get autocomplete suggestions for search
   *
   * Returns claim texts that start with the given prefix,
   * ordered by frequency.
   *
   * @param prefix - Text prefix to match
   * @param limit - Maximum suggestions to return
   * @returns Array of suggestions with occurrence counts
   */
  async getSearchSuggestions(
    prefix: string,
    limit = 10
  ): Promise<{ text: string; count: number }[]> {
    const rows = await this.db.query<{ text: string; count: number }>(
      `SELECT original_text as text, COUNT(*) as count
       FROM claims
       WHERE original_text LIKE ?
       GROUP BY original_text
       ORDER BY count DESC
       LIMIT ?`,
      [`${prefix}%`, limit]
    );

    return rows;
  }

  /**
   * Delete a claim by ID
   *
   * Note: This does not cascade to evidence or verifications.
   * Use with caution.
   *
   * @param claimId - ID of claim to delete
   */
  async delete(claimId: string): Promise<void> {
    await this.db.execute(`DELETE FROM claims WHERE claim_id = ?`, [claimId]);
  }

  /**
   * Hydrate a database row into a Claim object
   *
   * Parses JSON fields and converts timestamps.
   *
   * @param row - Raw database row
   * @returns Properly typed Claim object
   */
  private hydrate(row: Claim): Claim {
    return {
      ...row,
      entities:
        typeof row.entities === "string"
          ? JSON.parse(row.entities)
          : row.entities ?? [],
      created_at: new Date(row.created_at),
    };
  }
}
