/**
 * Temporal Store - Stores temporal events with timestamps
 *
 * Enables queries like:
 * - "What happened in the last hour?"
 * - "What happened before this error?"
 * - "Timeline of file changes"
 */

import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type {
  TemporalEvent,
  TemporalEventType,
  TemporalQueryOptions,
  CreateTemporalEventInput,
  TemporalStats,
} from "./types.js";

/**
 * Temporal Store for managing time-based events
 */
export class TemporalStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Create a new temporal event
   */
  async create(input: CreateTemporalEventInput): Promise<TemporalEvent> {
    const eventId = nanoid();
    const now = new Date();
    const occurredAt = input.occurredAt ?? now;

    await this.db.execute(
      `INSERT INTO temporal_events (event_id, session_id, event_type, entity_id, claim_id, relationship_id, event_data, occurred_at, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        input.sessionId,
        input.eventType,
        input.entityId ?? null,
        input.claimId ?? null,
        input.relationshipId ?? null,
        input.eventData ? JSON.stringify(input.eventData) : null,
        occurredAt.toISOString(),
        now.toISOString(),
      ]
    );

    return {
      eventId,
      sessionId: input.sessionId,
      eventType: input.eventType,
      entityId: input.entityId,
      claimId: input.claimId,
      relationshipId: input.relationshipId,
      eventData: input.eventData,
      occurredAt,
      recordedAt: now,
    };
  }

  /**
   * Get event by ID
   */
  async getById(eventId: string): Promise<TemporalEvent | null> {
    const rows = await this.db.query<{
      event_id: string;
      session_id: string;
      event_type: TemporalEventType;
      entity_id: string | null;
      claim_id: string | null;
      relationship_id: string | null;
      event_data: string | null;
      occurred_at: string;
      recorded_at: string;
    }>(
      `SELECT * FROM temporal_events WHERE event_id = ?`,
      [eventId]
    );

    if (rows.length === 0) return null;

    return this.hydrate(rows[0]);
  }

  /**
   * Query temporal events with options
   */
  async query(options: TemporalQueryOptions = {}): Promise<TemporalEvent[]> {
    let sql = `SELECT * FROM temporal_events WHERE 1=1`;
    const params: unknown[] = [];

    if (options.sessionId) {
      sql += ` AND session_id = ?`;
      params.push(options.sessionId);
    }

    if (options.eventType) {
      sql += ` AND event_type = ?`;
      params.push(options.eventType);
    }

    if (options.entityId) {
      sql += ` AND entity_id = ?`;
      params.push(options.entityId);
    }

    if (options.claimId) {
      sql += ` AND claim_id = ?`;
      params.push(options.claimId);
    }

    if (options.startTime) {
      sql += ` AND occurred_at >= ?`;
      params.push(options.startTime.toISOString());
    }

    if (options.endTime) {
      sql += ` AND occurred_at <= ?`;
      params.push(options.endTime.toISOString());
    }

    sql += ` ORDER BY occurred_at ${options.orderDir === "asc" ? "ASC" : "DESC"}`;

    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    if (options.offset) {
      sql += ` OFFSET ?`;
      params.push(options.offset);
    }

    const rows = await this.db.query<{
      event_id: string;
      session_id: string;
      event_type: TemporalEventType;
      entity_id: string | null;
      claim_id: string | null;
      relationship_id: string | null;
      event_data: string | null;
      occurred_at: string;
      recorded_at: string;
    }>(sql, params);

    return rows.map((row) => this.hydrate(row));
  }

  /**
   * Get events in a time range
   */
  async getInRange(
    sessionId: string,
    start: Date,
    end: Date
  ): Promise<TemporalEvent[]> {
    return this.query({ sessionId, startTime: start, endTime: end, orderDir: "asc" });
  }

  /**
   * Get events by type
   */
  async getByType(
    sessionId: string,
    eventType: TemporalEventType
  ): Promise<TemporalEvent[]> {
    return this.query({ sessionId, eventType });
  }

  /**
   * Get events for an entity
   */
  async getForEntity(entityId: string): Promise<TemporalEvent[]> {
    return this.query({ entityId });
  }

  /**
   * Get events for a claim
   */
  async getForClaim(claimId: string): Promise<TemporalEvent[]> {
    return this.query({ claimId });
  }

  /**
   * Get recent events
   */
  async getRecent(sessionId: string, limit = 20): Promise<TemporalEvent[]> {
    return this.query({ sessionId, limit, orderDir: "desc" });
  }

  /**
   * Get events before a specific time
   */
  async getBefore(sessionId: string, time: Date, limit = 10): Promise<TemporalEvent[]> {
    return this.query({ sessionId, endTime: time, limit, orderDir: "desc" });
  }

  /**
   * Get events after a specific time
   */
  async getAfter(sessionId: string, time: Date, limit = 10): Promise<TemporalEvent[]> {
    return this.query({ sessionId, startTime: time, limit, orderDir: "asc" });
  }

  /**
   * Delete event by ID
   */
  async delete(eventId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM temporal_events WHERE event_id = ?`,
      [eventId]
    );
  }

  /**
   * Delete all events for a session
   */
  async deleteBySession(sessionId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM temporal_events WHERE session_id = ?`,
      [sessionId]
    );
  }

  /**
   * Count events
   */
  async count(sessionId?: string): Promise<number> {
    let sql = `SELECT COUNT(*) as count FROM temporal_events`;
    const params: unknown[] = [];

    if (sessionId) {
      sql += ` WHERE session_id = ?`;
      params.push(sessionId);
    }

    const result = await this.db.query<{ count: number }>(sql, params);
    return result[0]?.count ?? 0;
  }

  /**
   * Get statistics for temporal events
   */
  async getStats(sessionId: string): Promise<TemporalStats> {
    // Total count
    const totalEvents = await this.count(sessionId);

    // Count by type
    const typeRows = await this.db.query<{
      event_type: TemporalEventType;
      count: number;
    }>(
      `SELECT event_type, COUNT(*) as count FROM temporal_events WHERE session_id = ? GROUP BY event_type`,
      [sessionId]
    );

    const byEventType: Partial<Record<TemporalEventType, number>> = {};
    for (const row of typeRows) {
      byEventType[row.event_type] = row.count;
    }

    // Oldest and newest
    const boundaryRows = await this.db.query<{
      oldest: string | null;
      newest: string | null;
    }>(
      `SELECT MIN(occurred_at) as oldest, MAX(occurred_at) as newest FROM temporal_events WHERE session_id = ?`,
      [sessionId]
    );

    const oldestEvent = boundaryRows[0]?.oldest ? new Date(boundaryRows[0].oldest) : undefined;
    const newestEvent = boundaryRows[0]?.newest ? new Date(boundaryRows[0].newest) : undefined;

    // Events per day
    const dailyRows = await this.db.query<{
      date: string;
      count: number;
    }>(
      `SELECT DATE(occurred_at) as date, COUNT(*) as count
       FROM temporal_events WHERE session_id = ?
       GROUP BY DATE(occurred_at)
       ORDER BY date DESC
       LIMIT 30`,
      [sessionId]
    );

    const eventsPerDay: Record<string, number> = {};
    for (const row of dailyRows) {
      eventsPerDay[row.date] = row.count;
    }

    return {
      totalEvents,
      byEventType: byEventType as Record<TemporalEventType, number>,
      oldestEvent,
      newestEvent,
      eventsPerDay,
    };
  }

  /**
   * Hydrate a database row into a TemporalEvent
   */
  private hydrate(row: {
    event_id: string;
    session_id: string;
    event_type: TemporalEventType;
    entity_id: string | null;
    claim_id: string | null;
    relationship_id: string | null;
    event_data: string | null;
    occurred_at: string;
    recorded_at: string;
  }): TemporalEvent {
    return {
      eventId: row.event_id,
      sessionId: row.session_id,
      eventType: row.event_type,
      entityId: row.entity_id ?? undefined,
      claimId: row.claim_id ?? undefined,
      relationshipId: row.relationship_id ?? undefined,
      eventData: row.event_data ? JSON.parse(row.event_data) : undefined,
      occurredAt: new Date(row.occurred_at),
      recordedAt: new Date(row.recorded_at),
    };
  }
}

/**
 * Factory function to create a TemporalStore
 */
export function createTemporalStore(db: Database): TemporalStore {
  return new TemporalStore(db);
}
