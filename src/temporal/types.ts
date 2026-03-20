/**
 * Types for Temporal Memory
 *
 * Temporal memory tracks events with timestamps for:
 * - Timeline queries ("what happened last week?")
 * - Causality analysis (what happened before/after)
 * - Trend detection
 */

/**
 * Types of temporal events
 */
export type TemporalEventType =
  | "CLAIM"
  | "VERIFICATION"
  | "ACTION"
  | "ENTITY_CREATED"
  | "ENTITY_MODIFIED"
  | "RELATIONSHIP_CREATED";

/**
 * A temporal event with timestamp
 */
export interface TemporalEvent {
  eventId: string;
  sessionId: string;
  eventType: TemporalEventType;
  entityId?: string;
  claimId?: string;
  relationshipId?: string;
  eventData?: Record<string, unknown>;
  occurredAt: Date;
  recordedAt: Date;
}

/**
 * Options for querying temporal events
 */
export interface TemporalQueryOptions {
  sessionId?: string;
  eventType?: TemporalEventType;
  entityId?: string;
  claimId?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
  orderDir?: "asc" | "desc";
}

/**
 * Time expression for natural language queries
 */
export interface TimeExpression {
  type: "relative" | "absolute" | "range";
  value: string;
  startDate?: Date;
  endDate?: Date;
}

/**
 * Result of parsing a time expression
 */
export interface ParsedTimeRange {
  start: Date;
  end: Date;
  expression: string;
}

/**
 * Statistics for temporal events
 */
export interface TemporalStats {
  totalEvents: number;
  byEventType: Record<TemporalEventType, number>;
  oldestEvent?: Date;
  newestEvent?: Date;
  eventsPerDay: Record<string, number>; // date string -> count
}

/**
 * Event timeline segment
 */
export interface TimelineSegment {
  startTime: Date;
  endTime: Date;
  events: TemporalEvent[];
  eventCount: number;
}

/**
 * Input for creating a temporal event
 */
export interface CreateTemporalEventInput {
  sessionId: string;
  eventType: TemporalEventType;
  entityId?: string;
  claimId?: string;
  relationshipId?: string;
  eventData?: Record<string, unknown>;
  occurredAt?: Date;
}
