/**
 * Trust Score Store - Persistence layer for agent trust scores
 *
 * This store tracks trust scores over time:
 * - Each verification cycle generates a new trust score
 * - Scores range from 0 (no trust) to 100 (full trust)
 * - Historical scores enable trend analysis
 * - Category scores show trust by claim type
 *
 * Trust scoring considers:
 * - Verified claims (positive impact)
 * - Contradicted claims (strong negative impact)
 * - Unverified claims (slight negative impact)
 */

import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type { TrustScore } from "../types.js";

/**
 * Store for managing trust score history
 *
 * @example
 * ```typescript
 * const store = new TrustScoreStore(db);
 *
 * // Record a new trust score
 * const score = await store.create(
 *   sessionId,
 *   85.0,  // overall score
 *   { file_created: 90, command_executed: 80 },  // by category
 *   10, 8, 1, 1  // total, verified, contradicted, unverified
 * );
 *
 * // Query trust data
 * const latest = await store.getLatest(sessionId);
 * const trend = await store.getTrend(sessionId);
 * ```
 */
export class TrustScoreStore {
  constructor(private db: Database) {}

  /**
   * Create a new trust score record
   *
   * Called after each verification cycle to record current trust level.
   *
   * @param sessionId - Session this score belongs to
   * @param overallScore - Overall trust score (0-100)
   * @param categoryScores - Score breakdown by claim type
   * @param totalClaims - Total number of claims processed
   * @param verifiedClaims - Number of verified claims
   * @param contradictedClaims - Number of contradicted claims
   * @param unverifiedClaims - Number of unverified claims
   * @returns The created trust score record
   */
  async create(
    sessionId: string,
    overallScore: number,
    categoryScores: Record<string, number>,
    totalClaims: number,
    verifiedClaims: number,
    contradictedClaims: number,
    unverifiedClaims: number
  ): Promise<TrustScore> {
    const score: TrustScore = {
      score_id: nanoid(),
      session_id: sessionId,
      overall_score: overallScore,
      category_scores: categoryScores,
      total_claims: totalClaims,
      verified_claims: verifiedClaims,
      contradicted_claims: contradictedClaims,
      unverified_claims: unverifiedClaims,
      calculated_at: new Date(),
    };

    await this.db.insert("trust_scores", {
      score_id: score.score_id,
      session_id: score.session_id,
      overall_score: score.overall_score,
      category_scores: JSON.stringify(score.category_scores),
      total_claims: score.total_claims,
      verified_claims: score.verified_claims,
      contradicted_claims: score.contradicted_claims,
      unverified_claims: score.unverified_claims,
    });

    return score;
  }

  /**
   * Get the most recent trust score for a session
   *
   * @param sessionId - Session to query
   * @returns Latest trust score or null if none exists
   */
  async getLatest(sessionId: string): Promise<TrustScore | null> {
    const rows = await this.db.query<TrustScore>(
      `SELECT * FROM trust_scores
       WHERE session_id = ?
       ORDER BY calculated_at DESC
       LIMIT 1`,
      [sessionId]
    );

    if (rows.length === 0) return null;

    return this.hydrate(rows[0]);
  }

  /**
   * Get trust score history for a session
   *
   * Returns scores in reverse chronological order.
   *
   * @param sessionId - Session to query
   * @param limit - Maximum scores to return
   * @returns Array of historical trust scores
   */
  async getHistory(sessionId: string, limit = 50): Promise<TrustScore[]> {
    const rows = await this.db.query<TrustScore>(
      `SELECT * FROM trust_scores
       WHERE session_id = ?
       ORDER BY calculated_at DESC
       LIMIT ?`,
      [sessionId, limit]
    );

    return rows.map((r) => this.hydrate(r));
  }

  /**
   * Get a trust score by its unique ID
   *
   * @param scoreId - Score ID to look up
   * @returns The trust score if found, null otherwise
   */
  async getById(scoreId: string): Promise<TrustScore | null> {
    const rows = await this.db.query<TrustScore>(
      `SELECT * FROM trust_scores WHERE score_id = ?`,
      [scoreId]
    );

    if (rows.length === 0) return null;

    return this.hydrate(rows[0]);
  }

  /**
   * Get the average trust score for a session
   *
   * Averages all historical scores.
   *
   * @param sessionId - Session to query
   * @returns Average score (defaults to 100 if no scores)
   */
  async getAverageScore(sessionId: string): Promise<number> {
    const rows = await this.db.query<{ avg: number }>(
      `SELECT AVG(overall_score) as avg
       FROM trust_scores
       WHERE session_id = ?`,
      [sessionId]
    );

    return Number(rows[0]?.avg ?? 100);
  }

  /**
   * Analyze trust score trend over recent scores
   *
   * Compares the latest score to scores from the window period
   * to determine if trust is improving, declining, or stable.
   *
   * @param sessionId - Session to analyze
   * @param windowSize - Number of recent scores to consider
   * @returns Trend direction, change amount, and recent score values
   */
  async getTrend(
    sessionId: string,
    windowSize = 5
  ): Promise<{
    direction: "improving" | "declining" | "stable";
    change: number;
    recent_scores: number[];
  }> {
    const rows = await this.db.query<{ overall_score: number }>(
      `SELECT overall_score FROM trust_scores
       WHERE session_id = ?
       ORDER BY calculated_at DESC
       LIMIT ?`,
      [sessionId, windowSize]
    );

    if (rows.length < 2) {
      return {
        direction: "stable",
        change: 0,
        recent_scores: rows.map((r) => r.overall_score),
      };
    }

    const scores = rows.map((r) => r.overall_score);
    const latest = scores[0];
    const oldest = scores[scores.length - 1];
    const change = latest - oldest;

    let direction: "improving" | "declining" | "stable";
    if (change > 5) {
      direction = "improving";
    } else if (change < -5) {
      direction = "declining";
    } else {
      direction = "stable";
    }

    return { direction, change, recent_scores: scores };
  }

  /**
   * Find sessions with low trust scores
   *
   * Returns sessions where the latest trust score is below
   * the specified threshold. Useful for identifying agents
   * that need attention.
   *
   * @param threshold - Score threshold (sessions below this are returned)
   * @param limit - Maximum sessions to return
   * @returns Array of low-trust sessions with scores and timestamps
   */
  async getLowScoreSessions(threshold = 50, limit = 20): Promise<
    Array<{
      session_id: string;
      latest_score: number;
      calculated_at: Date;
    }>
  > {
    const rows = await this.db.query<{
      session_id: string;
      overall_score: number;
      calculated_at: Date;
    }>(
      `SELECT session_id, overall_score, calculated_at
       FROM trust_scores ts1
       WHERE calculated_at = (
         SELECT MAX(calculated_at) FROM trust_scores ts2
         WHERE ts2.session_id = ts1.session_id
       )
       AND overall_score < ?
       ORDER BY overall_score ASC
       LIMIT ?`,
      [threshold, limit]
    );

    return rows.map((r) => ({
      session_id: r.session_id,
      latest_score: r.overall_score,
      calculated_at: new Date(r.calculated_at),
    }));
  }

  /**
   * Delete all trust scores for a session
   *
   * Used when cleaning up session data.
   *
   * @param sessionId - Session to delete scores for
   */
  async deleteBySession(sessionId: string): Promise<void> {
    await this.db.execute(`DELETE FROM trust_scores WHERE session_id = ?`, [
      sessionId,
    ]);
  }

  /**
   * Hydrate a database row into a TrustScore object
   *
   * Parses JSON fields and converts timestamps.
   *
   * @param row - Raw database row
   * @returns Properly typed TrustScore object
   */
  private hydrate(row: TrustScore): TrustScore {
    return {
      ...row,
      category_scores:
        typeof row.category_scores === "string"
          ? JSON.parse(row.category_scores)
          : row.category_scores ?? {},
      calculated_at: new Date(row.calculated_at),
    };
  }
}
