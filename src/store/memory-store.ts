/**
 * Memory Store - Persistence layer for 3-layer memory system
 *
 * This store implements the MemoryProvider interface for the MemoryBridge:
 * - Creating memory entries with importance and decay tracking
 * - Querying memories with filtering and full-text search
 * - Supporting decay levels for context compression
 *
 * Memory entries represent verifications, decisions, events, and other
 * information that needs to persist across sessions.
 */

import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type {
  MemoryProvider,
  MemoryEntry,
  MemorySearchOptions,
  MemoryEntryType,
  MemoryLayerName,
  DecayLevel,
} from "../shared/memory-bridge.js";

/**
 * Store for managing memory entries in the database
 *
 * Implements MemoryProvider to integrate with MemoryBridge.
 * Supports 3-layer memory system with decay tracking.
 *
 * @example
 * ```typescript
 * const store = new MemoryStore(db);
 *
 * // Store a memory
 * const id = await store.remember({
 *   content: "User prefers TypeScript",
 *   type: "decision",
 *   layer: "long-term",
 *   importance: 0.8,
 *   decayLevel: 0,
 *   metadata: { category: "preference" }
 * });
 *
 * // Recall memories
 * const memories = await store.recall("TypeScript", { limit: 10 });
 * ```
 */
export class MemoryStore implements MemoryProvider {
  constructor(private db: Database) {}

  /**
   * Store a new memory entry
   *
   * @param entry - Memory entry to store (without auto-generated fields)
   * @returns The generated memory ID
   */
  async remember(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "accessedAt" | "accessCount">
  ): Promise<string> {
    const memoryId = `mem_${nanoid()}`;
    const now = new Date();

    await this.db.execute(
      `INSERT INTO memory_entries
       (memory_id, session_id, task_id, type, layer, content, metadata, importance, decay_level, access_count, hash, created_at, accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        memoryId,
        entry.sessionId ?? null,
        entry.taskId ?? null,
        entry.type,
        entry.layer,
        entry.content,
        JSON.stringify(entry.metadata),
        entry.importance,
        entry.decayLevel,
        0,
        entry.hash ?? null,
        now.toISOString(),
        now.toISOString(),
      ]
    );

    return memoryId;
  }

  /**
   * Recall memories matching a query with optional filters
   *
   * @param query - Search query (searches in content)
   * @param options - Search filters and limits
   * @returns Array of matching memory entries
   */
  async recall(query: string, options: MemorySearchOptions = {}): Promise<MemoryEntry[]> {
    let sql = `SELECT * FROM memory_entries WHERE 1=1`;
    const params: unknown[] = [];

    if (options.sessionId) {
      sql += ` AND session_id = ?`;
      params.push(options.sessionId);
    }

    if (options.taskId) {
      sql += ` AND task_id = ?`;
      params.push(options.taskId);
    }

    if (options.type) {
      sql += ` AND type = ?`;
      params.push(options.type);
    }

    if (options.minImportance !== undefined) {
      sql += ` AND importance >= ?`;
      params.push(options.minImportance);
    }

    if (options.maxDecayLevel !== undefined) {
      sql += ` AND decay_level <= ?`;
      params.push(options.maxDecayLevel);
    }

    // Search by content if query is provided
    if (query && query.length > 0) {
      sql += ` AND content LIKE ?`;
      params.push(`%${query}%`);
    }

    sql += ` ORDER BY importance DESC, accessed_at DESC`;

    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    const rows = await this.db.query<MemoryRow>(sql, params);
    return rows.map(row => this.rowToEntry(row));
  }

  /**
   * Get a memory entry by ID
   *
   * @param id - Memory ID
   * @returns Memory entry or null if not found
   */
  async get(id: string): Promise<MemoryEntry | null> {
    const rows = await this.db.query<MemoryRow>(
      `SELECT * FROM memory_entries WHERE memory_id = ?`,
      [id]
    );

    if (rows.length === 0) return null;
    return this.rowToEntry(rows[0]);
  }

  /**
   * Delete a memory entry
   *
   * @param id - Memory ID to delete
   * @returns True if deleted, false if not found
   */
  async forget(id: string): Promise<boolean> {
    const before = await this.get(id);
    if (!before) return false;

    await this.db.execute(
      `DELETE FROM memory_entries WHERE memory_id = ?`,
      [id]
    );
    return true;
  }

  /**
   * Update access time and increment access count
   *
   * @param id - Memory ID to touch
   */
  async touch(id: string): Promise<void> {
    await this.db.execute(
      `UPDATE memory_entries SET accessed_at = ?, access_count = access_count + 1 WHERE memory_id = ?`,
      [new Date().toISOString(), id]
    );
  }

  /**
   * Search memories using full-text search (FTS5)
   *
   * Falls back to LIKE search if FTS is unavailable.
   *
   * @param query - Search query
   * @param sessionId - Optional session filter
   * @param limit - Maximum results
   * @returns Matching memory entries
   */
  async searchFTS(query: string, sessionId?: string, limit = 20): Promise<MemoryEntry[]> {
    try {
      let sql = `
        SELECT m.* FROM memory_entries m
        JOIN memory_fts f ON m.memory_id = f.memory_id
        WHERE memory_fts MATCH ?
      `;
      const params: unknown[] = [query];

      if (sessionId) {
        sql += ` AND m.session_id = ?`;
        params.push(sessionId);
      }

      sql += ` ORDER BY rank LIMIT ?`;
      params.push(limit);

      const rows = await this.db.query<MemoryRow>(sql, params);
      return rows.map(row => this.rowToEntry(row));
    } catch {
      // FTS not available, fallback to LIKE search
      return this.recall(query, { sessionId, limit });
    }
  }

  /**
   * Update decay level for a memory entry
   *
   * @param id - Memory ID
   * @param decayLevel - New decay level
   */
  async updateDecayLevel(id: string, decayLevel: DecayLevel): Promise<void> {
    await this.db.execute(
      `UPDATE memory_entries SET decay_level = ? WHERE memory_id = ?`,
      [decayLevel, id]
    );
  }

  /**
   * Update content (for summarization during decay)
   *
   * @param id - Memory ID
   * @param content - New content
   * @param decayLevel - New decay level
   */
  async updateContent(id: string, content: string, decayLevel?: DecayLevel): Promise<void> {
    if (decayLevel !== undefined) {
      await this.db.execute(
        `UPDATE memory_entries SET content = ?, decay_level = ? WHERE memory_id = ?`,
        [content, decayLevel, id]
      );
    } else {
      await this.db.execute(
        `UPDATE memory_entries SET content = ? WHERE memory_id = ?`,
        [content, id]
      );
    }
  }

  /**
   * Get entries that should be decayed based on age and importance
   *
   * @param maxAgeMs - Maximum age in milliseconds
   * @param maxImportance - Only decay entries below this importance
   * @param currentDecayLevel - Only get entries at this decay level
   * @returns Entries eligible for decay
   */
  async getEntriesForDecay(
    maxAgeMs: number,
    maxImportance: number,
    currentDecayLevel: DecayLevel
  ): Promise<MemoryEntry[]> {
    const cutoffDate = new Date(Date.now() - maxAgeMs);

    const rows = await this.db.query<MemoryRow>(
      `SELECT * FROM memory_entries
       WHERE accessed_at < ? AND importance < ? AND decay_level = ?`,
      [cutoffDate.toISOString(), maxImportance, currentDecayLevel]
    );

    return rows.map(row => this.rowToEntry(row));
  }

  /**
   * Get memory statistics for a session
   *
   * @param sessionId - Optional session filter
   * @returns Statistics including counts by layer and type
   */
  async getStats(sessionId?: string): Promise<{
    total: number;
    byLayer: Record<string, number>;
    byType: Record<string, number>;
    averageImportance: number;
  }> {
    const whereClause = sessionId ? `WHERE session_id = ?` : `WHERE 1=1`;
    const params = sessionId ? [sessionId] : [];

    const totalRows = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM memory_entries ${whereClause}`,
      params
    );

    const layerRows = await this.db.query<{ layer: string; cnt: number }>(
      `SELECT layer, COUNT(*) as cnt FROM memory_entries ${whereClause} GROUP BY layer`,
      params
    );

    const typeRows = await this.db.query<{ type: string; cnt: number }>(
      `SELECT type, COUNT(*) as cnt FROM memory_entries ${whereClause} GROUP BY type`,
      params
    );

    const avgRows = await this.db.query<{ avg_imp: number | null }>(
      `SELECT AVG(importance) as avg_imp FROM memory_entries ${whereClause}`,
      params
    );

    const byLayer: Record<string, number> = {};
    for (const row of layerRows) {
      byLayer[row.layer] = row.cnt;
    }

    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.type] = row.cnt;
    }

    return {
      total: totalRows[0]?.cnt ?? 0,
      byLayer,
      byType,
      averageImportance: avgRows[0]?.avg_imp ?? 0,
    };
  }

  /**
   * Count memories by session
   */
  async count(sessionId?: string): Promise<number> {
    if (sessionId) {
      const rows = await this.db.query<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM memory_entries WHERE session_id = ?`,
        [sessionId]
      );
      return rows[0]?.cnt ?? 0;
    }
    const rows = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM memory_entries`
    );
    return rows[0]?.cnt ?? 0;
  }

  /**
   * Clear all memories for a session
   */
  async clearSession(sessionId: string): Promise<void> {
    await this.db.execute(`DELETE FROM memory_entries WHERE session_id = ?`, [sessionId]);
  }

  /**
   * Convert database row to MemoryEntry
   */
  private rowToEntry(row: MemoryRow): MemoryEntry {
    return {
      id: row.memory_id,
      sessionId: row.session_id ?? undefined,
      taskId: row.task_id ?? undefined,
      type: row.type as MemoryEntryType,
      layer: row.layer as MemoryLayerName,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      importance: row.importance,
      decayLevel: row.decay_level as DecayLevel,
      accessCount: row.access_count,
      hash: row.hash ?? undefined,
      createdAt: new Date(row.created_at),
      accessedAt: new Date(row.accessed_at),
    };
  }
}

/**
 * Database row type for memory entries
 */
interface MemoryRow {
  memory_id: string;
  session_id: string | null;
  task_id: string | null;
  type: string;
  layer: string;
  content: string;
  metadata: string | null;
  importance: number;
  decay_level: number;
  access_count: number;
  hash: string | null;
  created_at: string;
  accessed_at: string;
}

/**
 * Factory function to create a MemoryStore instance
 */
export function createMemoryStore(db: Database): MemoryStore {
  return new MemoryStore(db);
}
