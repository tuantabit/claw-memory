/**
 * Message Store - Persistence layer for conversation messages
 *
 * This store handles all database operations for messages:
 * - Creating messages from user/assistant interactions
 * - Querying messages by session
 * - Supporting the LosslessBridge persistence
 *
 * Messages are the foundation of the context management system -
 * they represent the raw conversation that will be summarized.
 */

import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";

/**
 * Stored message representation in the database
 */
export interface StoredMessage {
  message_id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  response_id?: string;
  created_at: Date;
}

/**
 * Store for managing messages in the database
 *
 * Provides persistence for LosslessBridge message storage,
 * enabling context to survive across restarts.
 *
 * @example
 * ```typescript
 * const store = new MessageStore(db);
 *
 * // Create a new message
 * const message = await store.create(
 *   "session-123",
 *   "user",
 *   "Please create a new file"
 * );
 *
 * // Get all session messages
 * const messages = await store.getBySession("session-123");
 *
 * // Get recent messages
 * const recent = await store.getRecent("session-123", 10);
 * ```
 */
export class MessageStore {
  constructor(private db: Database) {}

  /**
   * Create a new message in the database
   *
   * @param sessionId - Session this message belongs to
   * @param role - Message role (user/assistant/system)
   * @param content - Message content
   * @param responseId - Optional response ID for tracking
   * @returns The created message with generated ID
   */
  async create(
    sessionId: string,
    role: "user" | "assistant" | "system",
    content: string,
    responseId?: string
  ): Promise<StoredMessage> {
    const messageId = `msg_${nanoid()}`;
    const now = new Date();

    await this.db.execute(
      `INSERT INTO messages (message_id, session_id, role, content, response_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [messageId, sessionId, role, content, responseId ?? null, now.toISOString()]
    );

    return {
      message_id: messageId,
      session_id: sessionId,
      role,
      content,
      response_id: responseId,
      created_at: now,
    };
  }

  /**
   * Get all messages for a session, sorted by creation time
   *
   * @param sessionId - Session ID to query
   * @param limit - Optional limit on number of messages
   * @returns Array of messages sorted ascending by created_at
   */
  async getBySession(sessionId: string, limit?: number): Promise<StoredMessage[]> {
    const sql = limit
      ? `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`
      : `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`;

    const params = limit ? [sessionId, limit] : [sessionId];
    const rows = await this.db.query<{
      message_id: string;
      session_id: string;
      role: string;
      content: string;
      response_id: string | null;
      created_at: string;
    }>(sql, params);

    return rows.map(row => ({
      message_id: row.message_id,
      session_id: row.session_id,
      role: row.role as "user" | "assistant" | "system",
      content: row.content,
      response_id: row.response_id ?? undefined,
      created_at: new Date(row.created_at),
    }));
  }

  /**
   * Get the N most recent messages for a session
   *
   * @param sessionId - Session ID to query
   * @param count - Number of recent messages to retrieve
   * @returns Array of messages sorted ascending by created_at
   */
  async getRecent(sessionId: string, count: number): Promise<StoredMessage[]> {
    const rows = await this.db.query<{
      message_id: string;
      session_id: string;
      role: string;
      content: string;
      response_id: string | null;
      created_at: string;
    }>(
      `SELECT * FROM messages WHERE session_id = ?
       ORDER BY created_at DESC LIMIT ?`,
      [sessionId, count]
    );

    return rows.reverse().map(row => ({
      message_id: row.message_id,
      session_id: row.session_id,
      role: row.role as "user" | "assistant" | "system",
      content: row.content,
      response_id: row.response_id ?? undefined,
      created_at: new Date(row.created_at),
    }));
  }

  /**
   * Count messages in a session
   *
   * @param sessionId - Session ID to count
   * @returns Number of messages in the session
   */
  async count(sessionId: string): Promise<number> {
    const rows = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?`,
      [sessionId]
    );
    return rows[0]?.cnt ?? 0;
  }

  /**
   * Delete old messages, keeping the most recent N
   *
   * @param sessionId - Session ID to clean up
   * @param keepLast - Number of recent messages to keep
   * @returns Number of messages deleted
   */
  async deleteOld(sessionId: string, keepLast: number): Promise<number> {
    const before = await this.count(sessionId);
    await this.db.execute(
      `DELETE FROM messages WHERE session_id = ? AND message_id NOT IN (
         SELECT message_id FROM messages WHERE session_id = ?
         ORDER BY created_at DESC LIMIT ?
       )`,
      [sessionId, sessionId, keepLast]
    );
    const after = await this.count(sessionId);
    return before - after;
  }

  /**
   * Search messages by content
   *
   * @param sessionId - Session ID to search in
   * @param query - Search query string
   * @param limit - Maximum results to return
   * @returns Matching messages
   */
  async search(sessionId: string, query: string, limit = 20): Promise<StoredMessage[]> {
    const rows = await this.db.query<{
      message_id: string;
      session_id: string;
      role: string;
      content: string;
      response_id: string | null;
      created_at: string;
    }>(
      `SELECT * FROM messages WHERE session_id = ? AND content LIKE ?
       ORDER BY created_at DESC LIMIT ?`,
      [sessionId, `%${query}%`, limit]
    );

    return rows.map(row => ({
      message_id: row.message_id,
      session_id: row.session_id,
      role: row.role as "user" | "assistant" | "system",
      content: row.content,
      response_id: row.response_id ?? undefined,
      created_at: new Date(row.created_at),
    }));
  }

  /**
   * Clear all messages from a session
   *
   * @param sessionId - Session ID to clear
   */
  async clearSession(sessionId: string): Promise<void> {
    await this.db.execute(`DELETE FROM messages WHERE session_id = ?`, [sessionId]);
  }

  /**
   * Get message by ID
   *
   * @param messageId - Message ID to retrieve
   * @returns Message or null if not found
   */
  async getById(messageId: string): Promise<StoredMessage | null> {
    const rows = await this.db.query<{
      message_id: string;
      session_id: string;
      role: string;
      content: string;
      response_id: string | null;
      created_at: string;
    }>(
      `SELECT * FROM messages WHERE message_id = ?`,
      [messageId]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      message_id: row.message_id,
      session_id: row.session_id,
      role: row.role as "user" | "assistant" | "system",
      content: row.content,
      response_id: row.response_id ?? undefined,
      created_at: new Date(row.created_at),
    };
  }
}

/**
 * Factory function to create a MessageStore instance
 */
export function createMessageStore(db: Database): MessageStore {
  return new MessageStore(db);
}
