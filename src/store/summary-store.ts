/**
 * Summary Store - Persistence layer for DAG summaries
 *
 * This store handles all database operations for summaries:
 * - Creating summaries from message chunks
 * - Querying summaries by session and chunk index
 * - Supporting the LosslessBridge DAG summarization
 *
 * Summaries are compressed representations of older messages,
 * enabling efficient context management across long conversations.
 */

import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";

/**
 * Stored summary representation in the database
 */
export interface StoredSummary {
  summary_id: string;
  session_id: string;
  chunk_index: number;
  content: string;
  message_count: number;
  start_message_id?: string;
  end_message_id?: string;
  created_at: Date;
}

/**
 * Store for managing summaries in the database
 *
 * Provides persistence for LosslessBridge DAG summaries,
 * enabling context compression to survive across restarts.
 *
 * @example
 * ```typescript
 * const store = new SummaryStore(db);
 *
 * // Create a new summary
 * const summary = await store.create(
 *   "session-123",
 *   0, // chunk_index
 *   "User asked to create files, assistant created index.ts",
 *   5, // message_count
 *   "msg_abc",
 *   "msg_xyz"
 * );
 *
 * // Get all session summaries
 * const summaries = await store.getBySession("session-123");
 * ```
 */
export class SummaryStore {
  constructor(private db: Database) {}

  /**
   * Create a new summary in the database
   *
   * @param sessionId - Session this summary belongs to
   * @param chunkIndex - Index of the message chunk this summarizes
   * @param content - Summary content text
   * @param messageCount - Number of messages in this chunk
   * @param startMessageId - First message ID in the chunk
   * @param endMessageId - Last message ID in the chunk
   * @returns The created summary with generated ID
   */
  async create(
    sessionId: string,
    chunkIndex: number,
    content: string,
    messageCount: number,
    startMessageId?: string,
    endMessageId?: string
  ): Promise<StoredSummary> {
    const summaryId = `sum_${nanoid()}`;
    const now = new Date();

    await this.db.execute(
      `INSERT INTO summaries
       (summary_id, session_id, chunk_index, content, message_count, start_message_id, end_message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [summaryId, sessionId, chunkIndex, content, messageCount, startMessageId ?? null, endMessageId ?? null, now.toISOString()]
    );

    return {
      summary_id: summaryId,
      session_id: sessionId,
      chunk_index: chunkIndex,
      content,
      message_count: messageCount,
      start_message_id: startMessageId,
      end_message_id: endMessageId,
      created_at: now,
    };
  }

  /**
   * Get all summaries for a session, sorted by chunk index
   *
   * @param sessionId - Session ID to query
   * @returns Array of summaries sorted by chunk_index
   */
  async getBySession(sessionId: string): Promise<StoredSummary[]> {
    const rows = await this.db.query<{
      summary_id: string;
      session_id: string;
      chunk_index: number;
      content: string;
      message_count: number;
      start_message_id: string | null;
      end_message_id: string | null;
      created_at: string;
    }>(
      `SELECT * FROM summaries WHERE session_id = ? ORDER BY chunk_index ASC`,
      [sessionId]
    );

    return rows.map(row => ({
      summary_id: row.summary_id,
      session_id: row.session_id,
      chunk_index: row.chunk_index,
      content: row.content,
      message_count: row.message_count,
      start_message_id: row.start_message_id ?? undefined,
      end_message_id: row.end_message_id ?? undefined,
      created_at: new Date(row.created_at),
    }));
  }

  /**
   * Get a specific summary by session and chunk index
   *
   * @param sessionId - Session ID
   * @param chunkIndex - Chunk index to retrieve
   * @returns Summary or null if not found
   */
  async getByChunkIndex(sessionId: string, chunkIndex: number): Promise<StoredSummary | null> {
    const rows = await this.db.query<{
      summary_id: string;
      session_id: string;
      chunk_index: number;
      content: string;
      message_count: number;
      start_message_id: string | null;
      end_message_id: string | null;
      created_at: string;
    }>(
      `SELECT * FROM summaries WHERE session_id = ? AND chunk_index = ?`,
      [sessionId, chunkIndex]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      summary_id: row.summary_id,
      session_id: row.session_id,
      chunk_index: row.chunk_index,
      content: row.content,
      message_count: row.message_count,
      start_message_id: row.start_message_id ?? undefined,
      end_message_id: row.end_message_id ?? undefined,
      created_at: new Date(row.created_at),
    };
  }

  /**
   * Get the latest chunk index for a session
   *
   * @param sessionId - Session ID to query
   * @returns Latest chunk index or -1 if no summaries exist
   */
  async getLatestChunkIndex(sessionId: string): Promise<number> {
    const rows = await this.db.query<{ max_idx: number | null }>(
      `SELECT MAX(chunk_index) as max_idx FROM summaries WHERE session_id = ?`,
      [sessionId]
    );
    return rows[0]?.max_idx ?? -1;
  }

  /**
   * Count summaries in a session
   *
   * @param sessionId - Session ID to count
   * @returns Number of summaries in the session
   */
  async count(sessionId: string): Promise<number> {
    const rows = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM summaries WHERE session_id = ?`,
      [sessionId]
    );
    return rows[0]?.cnt ?? 0;
  }

  /**
   * Clear all summaries from a session
   *
   * @param sessionId - Session ID to clear
   */
  async clearSession(sessionId: string): Promise<void> {
    await this.db.execute(`DELETE FROM summaries WHERE session_id = ?`, [sessionId]);
  }

  /**
   * Update an existing summary
   *
   * @param summaryId - Summary ID to update
   * @param content - New content
   * @param messageCount - New message count
   */
  async update(summaryId: string, content: string, messageCount?: number): Promise<void> {
    if (messageCount !== undefined) {
      await this.db.execute(
        `UPDATE summaries SET content = ?, message_count = ? WHERE summary_id = ?`,
        [content, messageCount, summaryId]
      );
    } else {
      await this.db.execute(
        `UPDATE summaries SET content = ? WHERE summary_id = ?`,
        [content, summaryId]
      );
    }
  }

  /**
   * Get summary by ID
   *
   * @param summaryId - Summary ID to retrieve
   * @returns Summary or null if not found
   */
  async getById(summaryId: string): Promise<StoredSummary | null> {
    const rows = await this.db.query<{
      summary_id: string;
      session_id: string;
      chunk_index: number;
      content: string;
      message_count: number;
      start_message_id: string | null;
      end_message_id: string | null;
      created_at: string;
    }>(
      `SELECT * FROM summaries WHERE summary_id = ?`,
      [summaryId]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      summary_id: row.summary_id,
      session_id: row.session_id,
      chunk_index: row.chunk_index,
      content: row.content,
      message_count: row.message_count,
      start_message_id: row.start_message_id ?? undefined,
      end_message_id: row.end_message_id ?? undefined,
      created_at: new Date(row.created_at),
    };
  }

  /**
   * Get total summarized message count for a session
   *
   * @param sessionId - Session ID to query
   * @returns Total number of messages that have been summarized
   */
  async getTotalMessageCount(sessionId: string): Promise<number> {
    const rows = await this.db.query<{ total: number | null }>(
      `SELECT SUM(message_count) as total FROM summaries WHERE session_id = ?`,
      [sessionId]
    );
    return rows[0]?.total ?? 0;
  }
}

/**
 * Factory function to create a SummaryStore instance
 */
export function createSummaryStore(db: Database): SummaryStore {
  return new SummaryStore(db);
}
