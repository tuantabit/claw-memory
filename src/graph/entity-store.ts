/**
 * Entity Store - Stores entities in the knowledge graph
 *
 * Entities are nodes in the graph representing:
 * - Files, functions, classes, components
 * - Commands, packages, tests, errors
 */

import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type {
  Entity,
  EntityType,
  CreateEntityInput,
  EntityQueryOptions,
} from "./types.js";

/**
 * Normalize an entity name for consistent lookup
 */
function normalizeEntityName(name: string, type: EntityType): string {
  // Remove leading/trailing whitespace
  let normalized = name.trim();

  // For files, normalize path separators
  if (type === "file") {
    normalized = normalized.replace(/\\/g, "/");
    // Remove leading ./
    if (normalized.startsWith("./")) {
      normalized = normalized.slice(2);
    }
  }

  // For functions/classes, remove parentheses and parameters
  if (type === "function" || type === "class") {
    const parenIndex = normalized.indexOf("(");
    if (parenIndex > 0) {
      normalized = normalized.slice(0, parenIndex);
    }
  }

  // Lowercase for case-insensitive matching
  return normalized.toLowerCase();
}

/**
 * Entity Store for managing graph nodes
 */
export class EntityStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Create a new entity or update if exists
   */
  async create(input: CreateEntityInput): Promise<Entity> {
    const normalizedName = normalizeEntityName(input.name, input.type);
    const now = new Date();

    // Check if entity already exists
    const existing = await this.findByNormalizedName(
      input.sessionId,
      input.type,
      normalizedName
    );

    if (existing) {
      // Update existing entity
      await this.db.execute(
        `UPDATE entities
         SET last_seen_at = ?, occurrence_count = occurrence_count + 1
         WHERE entity_id = ?`,
        [now.toISOString(), existing.entityId]
      );

      return {
        ...existing,
        lastSeenAt: now,
        occurrenceCount: existing.occurrenceCount + 1,
      };
    }

    // Create new entity
    const entityId = nanoid();

    await this.db.execute(
      `INSERT INTO entities (entity_id, session_id, type, name, normalized_name, first_seen_at, last_seen_at, occurrence_count, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entityId,
        input.sessionId,
        input.type,
        input.name,
        normalizedName,
        now.toISOString(),
        now.toISOString(),
        1,
        input.metadata ? JSON.stringify(input.metadata) : null,
      ]
    );

    return {
      entityId,
      sessionId: input.sessionId,
      type: input.type,
      name: input.name,
      normalizedName,
      firstSeenAt: now,
      lastSeenAt: now,
      occurrenceCount: 1,
      metadata: input.metadata,
    };
  }

  /**
   * Get entity by ID
   */
  async getById(entityId: string): Promise<Entity | null> {
    const rows = await this.db.query<{
      entity_id: string;
      session_id: string;
      type: EntityType;
      name: string;
      normalized_name: string;
      first_seen_at: string;
      last_seen_at: string;
      occurrence_count: number;
      metadata: string | null;
    }>(
      `SELECT * FROM entities WHERE entity_id = ?`,
      [entityId]
    );

    if (rows.length === 0) return null;

    return this.hydrate(rows[0]);
  }

  /**
   * Find entity by normalized name
   */
  async findByNormalizedName(
    sessionId: string,
    type: EntityType,
    normalizedName: string
  ): Promise<Entity | null> {
    const rows = await this.db.query<{
      entity_id: string;
      session_id: string;
      type: EntityType;
      name: string;
      normalized_name: string;
      first_seen_at: string;
      last_seen_at: string;
      occurrence_count: number;
      metadata: string | null;
    }>(
      `SELECT * FROM entities WHERE session_id = ? AND type = ? AND normalized_name = ?`,
      [sessionId, type, normalizedName]
    );

    if (rows.length === 0) return null;

    return this.hydrate(rows[0]);
  }

  /**
   * Find entity by name (exact or normalized match)
   */
  async findByName(
    sessionId: string,
    type: EntityType,
    name: string
  ): Promise<Entity | null> {
    const normalizedName = normalizeEntityName(name, type);
    return this.findByNormalizedName(sessionId, type, normalizedName);
  }

  /**
   * Get all entities matching query options
   */
  async query(options: EntityQueryOptions = {}): Promise<Entity[]> {
    let sql = `SELECT * FROM entities WHERE 1=1`;
    const params: unknown[] = [];

    if (options.sessionId) {
      sql += ` AND session_id = ?`;
      params.push(options.sessionId);
    }

    if (options.type) {
      sql += ` AND type = ?`;
      params.push(options.type);
    }

    // Order
    const orderCol = options.orderBy || "last_seen_at";
    const orderMap: Record<string, string> = {
      first_seen: "first_seen_at",
      last_seen: "last_seen_at",
      occurrence_count: "occurrence_count",
      name: "normalized_name",
    };
    sql += ` ORDER BY ${orderMap[orderCol] || "last_seen_at"} ${options.orderDir === "asc" ? "ASC" : "DESC"}`;

    // Limit and offset
    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    if (options.offset) {
      sql += ` OFFSET ?`;
      params.push(options.offset);
    }

    const rows = await this.db.query<{
      entity_id: string;
      session_id: string;
      type: EntityType;
      name: string;
      normalized_name: string;
      first_seen_at: string;
      last_seen_at: string;
      occurrence_count: number;
      metadata: string | null;
    }>(sql, params);

    return rows.map((row) => this.hydrate(row));
  }

  /**
   * Get entities by session
   */
  async getBySession(sessionId: string): Promise<Entity[]> {
    return this.query({ sessionId });
  }

  /**
   * Get entities by type
   */
  async getByType(sessionId: string, type: EntityType): Promise<Entity[]> {
    return this.query({ sessionId, type });
  }

  /**
   * Search entities by name pattern
   */
  async search(sessionId: string, pattern: string): Promise<Entity[]> {
    const rows = await this.db.query<{
      entity_id: string;
      session_id: string;
      type: EntityType;
      name: string;
      normalized_name: string;
      first_seen_at: string;
      last_seen_at: string;
      occurrence_count: number;
      metadata: string | null;
    }>(
      `SELECT * FROM entities WHERE session_id = ? AND (name LIKE ? OR normalized_name LIKE ?)`,
      [sessionId, `%${pattern}%`, `%${pattern.toLowerCase()}%`]
    );

    return rows.map((row) => this.hydrate(row));
  }

  /**
   * Delete entity by ID
   */
  async delete(entityId: string): Promise<void> {
    await this.db.execute(`DELETE FROM entities WHERE entity_id = ?`, [entityId]);
  }

  /**
   * Delete all entities for a session
   */
  async deleteBySession(sessionId: string): Promise<void> {
    await this.db.execute(`DELETE FROM entities WHERE session_id = ?`, [sessionId]);
  }

  /**
   * Count entities
   */
  async count(sessionId?: string): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM entities`;
    const params: unknown[] = [];

    if (sessionId) {
      sql += ` WHERE session_id = ?`;
      params.push(sessionId);
    }

    const result = await this.db.query<{ count: number }>(sql, params);
    return result[0]?.count ?? 0;
  }

  /**
   * Get most frequent entities
   */
  async getMostFrequent(sessionId: string, limit = 10): Promise<Entity[]> {
    return this.query({
      sessionId,
      orderBy: "occurrence_count",
      orderDir: "desc",
      limit,
    });
  }

  /**
   * Get recently seen entities
   */
  async getRecent(sessionId: string, limit = 10): Promise<Entity[]> {
    return this.query({
      sessionId,
      orderBy: "last_seen",
      orderDir: "desc",
      limit,
    });
  }

  /**
   * Hydrate a database row into an Entity
   */
  private hydrate(row: {
    entity_id: string;
    session_id: string;
    type: EntityType;
    name: string;
    normalized_name: string;
    first_seen_at: string;
    last_seen_at: string;
    occurrence_count: number;
    metadata: string | null;
  }): Entity {
    return {
      entityId: row.entity_id,
      sessionId: row.session_id,
      type: row.type,
      name: row.name,
      normalizedName: row.normalized_name,
      firstSeenAt: new Date(row.first_seen_at),
      lastSeenAt: new Date(row.last_seen_at),
      occurrenceCount: row.occurrence_count,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}

/**
 * Factory function to create an EntityStore
 */
export function createEntityStore(db: Database): EntityStore {
  return new EntityStore(db);
}
