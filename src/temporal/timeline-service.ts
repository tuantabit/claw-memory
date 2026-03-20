/**
 * Timeline Service - High-level API for temporal queries
 *
 * Provides:
 * - Natural language time expression parsing
 * - Timeline visualization helpers
 * - Event aggregation by time periods
 */

import type { Database } from "../core/database.js";
import type {
  TemporalEvent,
  TemporalEventType,
  ParsedTimeRange,
  TimelineSegment,
  TemporalStats,
} from "./types.js";
import { TemporalStore, createTemporalStore } from "./temporal-store.js";

/**
 * Parse natural language time expressions
 */
function parseTimeExpression(expression: string): ParsedTimeRange | null {
  const now = new Date();
  const lowered = expression.toLowerCase().trim();

  // Handle "today"
  if (lowered === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression };
  }

  // Handle "yesterday"
  if (lowered === "yesterday") {
    const start = new Date(now);
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression };
  }

  // Handle "this week"
  if (lowered === "this week") {
    const start = new Date(now);
    const dayOfWeek = start.getDay();
    start.setDate(start.getDate() - dayOfWeek);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    return { start, end, expression };
  }

  // Handle "last week"
  if (lowered === "last week") {
    const end = new Date(now);
    const dayOfWeek = end.getDay();
    end.setDate(end.getDate() - dayOfWeek - 1);
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { start, end, expression };
  }

  // Handle "this month"
  if (lowered === "this month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now);
    return { start, end, expression };
  }

  // Handle "last month"
  if (lowered === "last month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression };
  }

  // Handle "N days ago" or "last N days"
  const daysAgoMatch = lowered.match(/^(\d+)\s*days?\s*ago$/);
  const lastNDaysMatch = lowered.match(/^last\s*(\d+)\s*days?$/);

  if (daysAgoMatch) {
    const days = parseInt(daysAgoMatch[1], 10);
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression };
  }

  if (lastNDaysMatch) {
    const days = parseInt(lastNDaysMatch[1], 10);
    const start = new Date(now);
    start.setDate(start.getDate() - days);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    return { start, end, expression };
  }

  // Handle "N hours ago" or "last N hours"
  const hoursAgoMatch = lowered.match(/^(\d+)\s*hours?\s*ago$/);
  const lastNHoursMatch = lowered.match(/^last\s*(\d+)\s*hours?$/);

  if (hoursAgoMatch) {
    const hours = parseInt(hoursAgoMatch[1], 10);
    const start = new Date(now);
    start.setHours(start.getHours() - hours);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + 59);
    end.setSeconds(59);
    return { start, end, expression };
  }

  if (lastNHoursMatch) {
    const hours = parseInt(lastNHoursMatch[1], 10);
    const start = new Date(now);
    start.setHours(start.getHours() - hours);
    const end = new Date(now);
    return { start, end, expression };
  }

  // Handle "N weeks ago" or "last N weeks"
  const weeksAgoMatch = lowered.match(/^(\d+)\s*weeks?\s*ago$/);
  const lastNWeeksMatch = lowered.match(/^last\s*(\d+)\s*weeks?$/);

  if (weeksAgoMatch) {
    const weeks = parseInt(weeksAgoMatch[1], 10);
    const start = new Date(now);
    start.setDate(start.getDate() - weeks * 7);
    const dayOfWeek = start.getDay();
    start.setDate(start.getDate() - dayOfWeek);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression };
  }

  if (lastNWeeksMatch) {
    const weeks = parseInt(lastNWeeksMatch[1], 10);
    const start = new Date(now);
    start.setDate(start.getDate() - weeks * 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    return { start, end, expression };
  }

  // Handle "N months ago" or "last N months"
  const monthsAgoMatch = lowered.match(/^(\d+)\s*months?\s*ago$/);
  const lastNMonthsMatch = lowered.match(/^last\s*(\d+)\s*months?$/);

  if (monthsAgoMatch) {
    const months = parseInt(monthsAgoMatch[1], 10);
    const start = new Date(now.getFullYear(), now.getMonth() - months, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - months + 1, 0);
    end.setHours(23, 59, 59, 999);
    return { start, end, expression };
  }

  if (lastNMonthsMatch) {
    const months = parseInt(lastNMonthsMatch[1], 10);
    const start = new Date(now);
    start.setMonth(start.getMonth() - months);
    start.setHours(0, 0, 0, 0);
    const end = new Date(now);
    return { start, end, expression };
  }

  return null;
}

/**
 * Timeline Service for time-based queries
 */
export class TimelineService {
  private db: Database;
  private temporalStore: TemporalStore;

  constructor(db: Database) {
    this.db = db;
    this.temporalStore = createTemporalStore(db);
  }

  /**
   * Parse a time expression into a date range
   */
  parseTimeExpression(expression: string): ParsedTimeRange | null {
    return parseTimeExpression(expression);
  }

  /**
   * Query events by natural language time expression
   */
  async queryByTimeExpression(
    sessionId: string,
    expression: string
  ): Promise<TemporalEvent[]> {
    const range = parseTimeExpression(expression);
    if (!range) {
      return [];
    }

    return this.temporalStore.getInRange(sessionId, range.start, range.end);
  }

  /**
   * Get timeline of events for a session
   */
  async getTimeline(
    sessionId: string,
    options: {
      startTime?: Date;
      endTime?: Date;
      limit?: number;
      eventTypes?: TemporalEventType[];
    } = {}
  ): Promise<TemporalEvent[]> {
    if (options.eventTypes && options.eventTypes.length > 0) {
      // Query each event type and merge
      const results: TemporalEvent[] = [];
      for (const eventType of options.eventTypes) {
        const events = await this.temporalStore.query({
          sessionId,
          eventType,
          startTime: options.startTime,
          endTime: options.endTime,
          limit: options.limit,
          orderDir: "asc",
        });
        results.push(...events);
      }
      // Sort by occurred_at
      results.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
      return options.limit ? results.slice(0, options.limit) : results;
    }

    return this.temporalStore.query({
      sessionId,
      startTime: options.startTime,
      endTime: options.endTime,
      limit: options.limit,
      orderDir: "asc",
    });
  }

  /**
   * Get timeline for a specific entity
   */
  async getEntityTimeline(entityId: string): Promise<TemporalEvent[]> {
    return this.temporalStore.getForEntity(entityId);
  }

  /**
   * Get timeline for a specific claim
   */
  async getClaimTimeline(claimId: string): Promise<TemporalEvent[]> {
    return this.temporalStore.getForClaim(claimId);
  }

  /**
   * Group events into time segments
   */
  async getTimelineSegments(
    sessionId: string,
    segmentDuration: "hour" | "day" | "week" | "month",
    options: {
      startTime?: Date;
      endTime?: Date;
    } = {}
  ): Promise<TimelineSegment[]> {
    const events = await this.getTimeline(sessionId, {
      startTime: options.startTime,
      endTime: options.endTime,
    });

    if (events.length === 0) {
      return [];
    }

    const segments: TimelineSegment[] = [];
    let currentSegment: TimelineSegment | null = null;

    for (const event of events) {
      const segmentStart = this.getSegmentStart(event.occurredAt, segmentDuration);
      const segmentEnd = this.getSegmentEnd(segmentStart, segmentDuration);

      if (
        !currentSegment ||
        currentSegment.startTime.getTime() !== segmentStart.getTime()
      ) {
        if (currentSegment) {
          segments.push(currentSegment);
        }
        currentSegment = {
          startTime: segmentStart,
          endTime: segmentEnd,
          events: [event],
          eventCount: 1,
        };
      } else {
        currentSegment.events.push(event);
        currentSegment.eventCount++;
      }
    }

    if (currentSegment) {
      segments.push(currentSegment);
    }

    return segments;
  }

  /**
   * Get events that happened before a specific event
   */
  async getEventsBefore(
    eventId: string,
    limit = 10
  ): Promise<TemporalEvent[]> {
    const event = await this.temporalStore.getById(eventId);
    if (!event) {
      return [];
    }

    return this.temporalStore.getBefore(event.sessionId, event.occurredAt, limit);
  }

  /**
   * Get events that happened after a specific event
   */
  async getEventsAfter(
    eventId: string,
    limit = 10
  ): Promise<TemporalEvent[]> {
    const event = await this.temporalStore.getById(eventId);
    if (!event) {
      return [];
    }

    return this.temporalStore.getAfter(event.sessionId, event.occurredAt, limit);
  }

  /**
   * Get activity summary for a time period
   */
  async getActivitySummary(
    sessionId: string,
    expression: string
  ): Promise<{
    timeRange: ParsedTimeRange;
    totalEvents: number;
    byType: Partial<Record<TemporalEventType, number>>;
    peakHour?: number;
  } | null> {
    const range = parseTimeExpression(expression);
    if (!range) {
      return null;
    }

    const events = await this.temporalStore.getInRange(
      sessionId,
      range.start,
      range.end
    );

    const byType: Partial<Record<TemporalEventType, number>> = {};
    const hourCounts: Record<number, number> = {};

    for (const event of events) {
      // Count by type
      byType[event.eventType] = (byType[event.eventType] || 0) + 1;

      // Count by hour
      const hour = event.occurredAt.getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }

    // Find peak hour
    let peakHour: number | undefined;
    let peakCount = 0;
    for (const [hour, count] of Object.entries(hourCounts)) {
      if (count > peakCount) {
        peakCount = count;
        peakHour = parseInt(hour, 10);
      }
    }

    return {
      timeRange: range,
      totalEvents: events.length,
      byType,
      peakHour,
    };
  }

  /**
   * Get temporal statistics for a session
   */
  async getStats(sessionId: string): Promise<TemporalStats> {
    return this.temporalStore.getStats(sessionId);
  }

  /**
   * Get direct access to temporal store
   */
  getTemporalStore(): TemporalStore {
    return this.temporalStore;
  }

  /**
   * Calculate segment start time
   */
  private getSegmentStart(date: Date, duration: "hour" | "day" | "week" | "month"): Date {
    const result = new Date(date);

    switch (duration) {
      case "hour":
        result.setMinutes(0, 0, 0);
        break;
      case "day":
        result.setHours(0, 0, 0, 0);
        break;
      case "week":
        const dayOfWeek = result.getDay();
        result.setDate(result.getDate() - dayOfWeek);
        result.setHours(0, 0, 0, 0);
        break;
      case "month":
        result.setDate(1);
        result.setHours(0, 0, 0, 0);
        break;
    }

    return result;
  }

  /**
   * Calculate segment end time
   */
  private getSegmentEnd(start: Date, duration: "hour" | "day" | "week" | "month"): Date {
    const result = new Date(start);

    switch (duration) {
      case "hour":
        result.setHours(result.getHours() + 1);
        result.setMilliseconds(-1);
        break;
      case "day":
        result.setDate(result.getDate() + 1);
        result.setMilliseconds(-1);
        break;
      case "week":
        result.setDate(result.getDate() + 7);
        result.setMilliseconds(-1);
        break;
      case "month":
        result.setMonth(result.getMonth() + 1);
        result.setMilliseconds(-1);
        break;
    }

    return result;
  }
}

/**
 * Factory function to create a TimelineService
 */
export function createTimelineService(db: Database): TimelineService {
  return new TimelineService(db);
}
