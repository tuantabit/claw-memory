/**
 * Relationship Store - Stores relationships in the knowledge graph
 *
 * Relationships are edges connecting entities:
 * - CONTAINS: File contains function
 * - IMPORTS: File imports another file
 * - DEPENDS_ON: Package depends on another
 * - CALLS: Function calls another function
 * - TESTS: Test tests a function
 * - FIXES: Fix resolves an error
 */

import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type {
  Relationship,
  RelationshipType,
  CreateRelationshipInput,
  RelationshipQueryOptions,
} from "./types.js";

/**
 * Relationship Store for managing graph edges
 */
export class RelationshipStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Create a new relationship or update if exists
   */
  async create(input: CreateRelationshipInput): Promise<Relationship> {
    const now = new Date();

    // Check if relationship already exists
    const existing = await this.findExisting(
      input.sessionId,
      input.fromEntityId,
      input.toEntityId,
      input.type
    );

    if (existing) {
      // Update existing relationship
      await this.db.execute(
        `UPDATE relationships
         SET last_observed_at = ?, observation_count = observation_count + 1,
             confidence = MAX(confidence, ?)
         WHERE relationship_id = ?`,
        [now.toISOString(), input.confidence ?? 1.0, existing.relationshipId]
      );

      return {
        ...existing,
        lastObservedAt: now,
        observationCount: existing.observationCount + 1,
        confidence: Math.max(existing.confidence, input.confidence ?? 1.0),
      };
    }

    // Create new relationship
    const relationshipId = nanoid();

    await this.db.execute(
      `INSERT INTO relationships (relationship_id, session_id, from_entity_id, to_entity_id, type, source_claim_id, confidence, first_observed_at, last_observed_at, observation_count, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        relationshipId,
        input.sessionId,
        input.fromEntityId,
        input.toEntityId,
        input.type,
        input.sourceClaimId ?? null,
        input.confidence ?? 1.0,
        now.toISOString(),
        now.toISOString(),
        1,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ]
    );

    return {
      relationshipId,
      sessionId: input.sessionId,
      fromEntityId: input.fromEntityId,
      toEntityId: input.toEntityId,
      type: input.type,
      sourceClaimId: input.sourceClaimId,
      confidence: input.confidence ?? 1.0,
      firstObservedAt: now,
      lastObservedAt: now,
      observationCount: 1,
      metadata: input.metadata,
    };
  }

  /**
   * Find existing relationship
   */
  async findExisting(
    sessionId: string,
    fromEntityId: string,
    toEntityId: string,
    type: RelationshipType
  ): Promise<Relationship | null> {
    const rows = await this.db.query<{
      relationship_id: string;
      session_id: string;
      from_entity_id: string;
      to_entity_id: string;
      type: RelationshipType;
      source_claim_id: string | null;
      confidence: number;
      first_observed_at: string;
      last_observed_at: string;
      observation_count: number;
      metadata: string | null;
    }>(
      `SELECT * FROM relationships
       WHERE session_id = ? AND from_entity_id = ? AND to_entity_id = ? AND type = ?`,
      [sessionId, fromEntityId, toEntityId, type]
    );

    if (rows.length === 0) return null;

    return this.hydrate(rows[0]);
  }

  /**
   * Get relationship by ID
   */
  async getById(relationshipId: string): Promise<Relationship | null> {
    const rows = await this.db.query<{
      relationship_id: string;
      session_id: string;
      from_entity_id: string;
      to_entity_id: string;
      type: RelationshipType;
      source_claim_id: string | null;
      confidence: number;
      first_observed_at: string;
      last_observed_at: string;
      observation_count: number;
      metadata: string | null;
    }>(
      `SELECT * FROM relationships WHERE relationship_id = ?`,
      [relationshipId]
    );

    if (rows.length === 0) return null;

    return this.hydrate(rows[0]);
  }

  /**
   * Get all relationships matching query options
   */
  async query(options: RelationshipQueryOptions = {}): Promise<Relationship[]> {
    let sql = `SELECT * FROM relationships WHERE 1=1`;
    const params: unknown[] = [];

    if (options.sessionId) {
      sql += ` AND session_id = ?`;
      params.push(options.sessionId);
    }

    if (options.type) {
      sql += ` AND type = ?`;
      params.push(options.type);
    }

    if (options.fromEntityId) {
      sql += ` AND from_entity_id = ?`;
      params.push(options.fromEntityId);
    }

    if (options.toEntityId) {
      sql += ` AND to_entity_id = ?`;
      params.push(options.toEntityId);
    }

    sql += ` ORDER BY last_observed_at DESC`;

    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    const rows = await this.db.query<{
      relationship_id: string;
      session_id: string;
      from_entity_id: string;
      to_entity_id: string;
      type: RelationshipType;
      source_claim_id: string | null;
      confidence: number;
      first_observed_at: string;
      last_observed_at: string;
      observation_count: number;
      metadata: string | null;
    }>(sql, params);

    return rows.map((row) => this.hydrate(row));
  }

  /**
   * Get outgoing relationships from an entity
   */
  async getOutgoing(entityId: string): Promise<Relationship[]> {
    return this.query({ fromEntityId: entityId });
  }

  /**
   * Get incoming relationships to an entity
   */
  async getIncoming(entityId: string): Promise<Relationship[]> {
    return this.query({ toEntityId: entityId });
  }

  /**
   * Get all relationships for an entity (both directions)
   */
  async getForEntity(entityId: string): Promise<{
    outgoing: Relationship[];
    incoming: Relationship[];
  }> {
    const [outgoing, incoming] = await Promise.all([
      this.getOutgoing(entityId),
      this.getIncoming(entityId),
    ]);

    return { outgoing, incoming };
  }

  /**
   * Get relationships by type
   */
  async getByType(sessionId: string, type: RelationshipType): Promise<Relationship[]> {
    return this.query({ sessionId, type });
  }

  /**
   * Get relationships by session
   */
  async getBySession(sessionId: string): Promise<Relationship[]> {
    return this.query({ sessionId });
  }

  /**
   * Delete relationship by ID
   */
  async delete(relationshipId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM relationships WHERE relationship_id = ?`,
      [relationshipId]
    );
  }

  /**
   * Delete all relationships for a session
   */
  async deleteBySession(sessionId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM relationships WHERE session_id = ?`,
      [sessionId]
    );
  }

  /**
   * Delete all relationships involving an entity
   */
  async deleteForEntity(entityId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM relationships WHERE from_entity_id = ? OR to_entity_id = ?`,
      [entityId, entityId]
    );
  }

  /**
   * Count relationships
   */
  async count(sessionId?: string): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM relationships`;
    const params: unknown[] = [];

    if (sessionId) {
      sql += ` WHERE session_id = ?`;
      params.push(sessionId);
    }

    const result = await this.db.query<{ count: number }>(sql, params);
    return result[0]?.count ?? 0;
  }

  /**
   * Count relationships by type
   */
  async countByType(sessionId: string): Promise<Record<RelationshipType, number>> {
    const rows = await this.db.query<{
      type: RelationshipType;
      count: number;
    }>(
      `SELECT type, COUNT(*) as count FROM relationships WHERE session_id = ? GROUP BY type`,
      [sessionId]
    );

    const counts: Partial<Record<RelationshipType, number>> = {};
    for (const row of rows) {
      counts[row.type] = row.count;
    }

    return counts as Record<RelationshipType, number>;
  }

  /**
   * Hydrate a database row into a Relationship
   */
  private hydrate(row: {
    relationship_id: string;
    session_id: string;
    from_entity_id: string;
    to_entity_id: string;
    type: RelationshipType;
    source_claim_id: string | null;
    confidence: number;
    first_observed_at: string;
    last_observed_at: string;
    observation_count: number;
    metadata: string | null;
  }): Relationship {
    return {
      relationshipId: row.relationship_id,
      sessionId: row.session_id,
      fromEntityId: row.from_entity_id,
      toEntityId: row.to_entity_id,
      type: row.type,
      sourceClaimId: row.source_claim_id ?? undefined,
      confidence: row.confidence,
      firstObservedAt: new Date(row.first_observed_at),
      lastObservedAt: new Date(row.last_observed_at),
      observationCount: row.observation_count,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}

/**
 * Factory function to create a RelationshipStore
 */
export function createRelationshipStore(db: Database): RelationshipStore {
  return new RelationshipStore(db);
}
