/**
 * @module temporal
 * @description Temporal memory for time-based queries
 *
 * Re-exports from @openclaw/memory-core with plugin-specific event types.
 *
 * @example
 * ```typescript
 * import { createTimelineService, createTemporalStore, DEV_EVENT_TYPES } from './temporal';
 *
 * const timeline = createTimelineService(db);
 * const store = createTemporalStore(db);
 *
 * // Record an event using dev event types
 * await store.create({
 *   sessionId,
 *   eventType: 'CLAIM',
 *   claimId: claim.claim_id,
 *   eventData: { type: claim.claim_type },
 * });
 *
 * // Query with natural language
 * const events = await timeline.queryByTimeExpression(sessionId, "last week");
 * ```
 */

// Re-export types from core
export type {
  TemporalEvent,
  TemporalQueryOptions,
  TimeExpression,
  ParsedTimeRange,
  TemporalStats,
  TimelineSegment,
  CreateTemporalEventInput,
} from "memory-core";

// Re-export implementations from core
export {
  TemporalStore,
  createTemporalStore,
  TimelineService,
  createTimelineService,
} from "memory-core";

// ============================================
// Plugin-Specific: Development Event Types
// ============================================

/**
 * Event types for development context (claim verification)
 */
export const DEV_EVENT_TYPES = [
  "CLAIM", // Claim extracted from response
  "VERIFICATION", // Claim verified
  "ACTION", // Action performed
  "ENTITY_CREATED", // Entity created in graph
  "ENTITY_MODIFIED", // Entity modified
  "RELATIONSHIP_CREATED", // Relationship created
] as const;

export type DevEventType = (typeof DEV_EVENT_TYPES)[number];

/**
 * Legacy type alias for backward compatibility
 */
export type TemporalEventType = DevEventType;
