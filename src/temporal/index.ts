/**
 * @module temporal
 * @description Temporal memory for time-based queries
 *
 * Tracks events with timestamps for timeline queries:
 * - "What happened last week?"
 * - "What was I working on 3 days ago?"
 * - "Timeline of this entity's changes"
 *
 * Supports natural language time expressions:
 * - "today", "yesterday"
 * - "last week", "this month"
 * - "3 days ago", "last 5 hours"
 * - "2 weeks ago", "last 3 months"
 *
 * @example
 * ```typescript
 * import { createTimelineService, createTemporalStore } from './temporal';
 *
 * const timeline = createTimelineService(db);
 * const store = createTemporalStore(db);
 *
 * // Record an event
 * await store.create({
 *   sessionId,
 *   eventType: 'CLAIM',
 *   claimId: claim.claim_id,
 *   eventData: { type: claim.claim_type },
 * });
 *
 * // Query with natural language
 * const events = await timeline.queryByTimeExpression(sessionId, "last week");
 *
 * // Get timeline segments by day
 * const segments = await timeline.getTimelineSegments(sessionId, "day");
 * ```
 */

export * from "./types.js";
export * from "./temporal-store.js";
export * from "./timeline-service.js";
