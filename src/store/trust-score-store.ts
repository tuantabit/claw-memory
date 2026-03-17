
import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type { TrustScore } from "../types.js";

export class TrustScoreStore {
  constructor(private db: Database) {}

  
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

  
  async getById(scoreId: string): Promise<TrustScore | null> {
    const rows = await this.db.query<TrustScore>(
      `SELECT * FROM trust_scores WHERE score_id = ?`,
      [scoreId]
    );

    if (rows.length === 0) return null;

    return this.hydrate(rows[0]);
  }

  
  async getAverageScore(sessionId: string): Promise<number> {
    const rows = await this.db.query<{ avg: number }>(
      `SELECT AVG(overall_score) as avg
       FROM trust_scores
       WHERE session_id = ?`,
      [sessionId]
    );

    return Number(rows[0]?.avg ?? 100);
  }

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

  
  async deleteBySession(sessionId: string): Promise<void> {
    await this.db.execute(`DELETE FROM trust_scores WHERE session_id = ?`, [
      sessionId,
    ]);
  }

  
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
