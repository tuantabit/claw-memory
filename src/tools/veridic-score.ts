
import type { VeridicEngine } from "../engine.js";

export interface ScoreInput {
  /** Session ID (defaults to current) */
  session_id?: string;
  /** Include score history */
  include_history?: boolean;
  /** Number of historical scores to include */
  history_limit?: number;
}

export interface ScoreOutput {
  success: boolean;
  current_score: number;
  trend: "improving" | "declining" | "stable";
  trend_change: number;
  stats: {
    total_claims: number;
    verified: number;
    contradicted: number;
    unverified: number;
    accuracy_rate: number;
  };
  category_scores: Record<string, number>;
  history?: Array<{
    score: number;
    calculated_at: string;
  }>;
  warning: string | null;
  summary: string;
}

export function createScoreTool(engine: VeridicEngine) {
  return {
    name: "veridic_score",
    description: "Get current trust score for the agent session. Shows if agent is trustworthy.",
    parameters: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID to check (defaults to current)",
        },
        include_history: {
          type: "boolean",
          description: "Include score history over time",
        },
        history_limit: {
          type: "number",
          description: "Number of historical scores to include (default: 10)",
        },
      },
    },

    async execute(input: ScoreInput): Promise<ScoreOutput> {
      try {
        const stores = engine.getStores();
        const context = await engine.getTrustContext(input.session_id);
        const sessionId = context.session_id || input.session_id;

        if (!sessionId) {
          return {
            success: false,
            current_score: 100,
            trend: "stable",
            trend_change: 0,
            stats: {
              total_claims: 0,
              verified: 0,
              contradicted: 0,
              unverified: 0,
              accuracy_rate: 1,
            },
            category_scores: {},
            warning: null,
            summary: "No session found",
          };
        }

        const latestScore = await stores.trustScores.getLatest(sessionId);
        const currentScore = latestScore?.overall_score ?? 100;

        const trend = await stores.trustScores.getTrend(sessionId);

        const categoryScores = latestScore?.category_scores ?? {};

        const claimStats = await stores.claims.getStats(sessionId);
        const verificationStats = await stores.verifications.getStats(sessionId);

        const stats = {
          total_claims: claimStats.total,
          verified: verificationStats.by_status.verified ?? 0,
          contradicted: verificationStats.by_status.contradicted ?? 0,
          unverified: verificationStats.by_status.unverified ?? 0,
          accuracy_rate:
            (verificationStats.by_status.verified ?? 0) /
            Math.max(
              1,
              (verificationStats.by_status.verified ?? 0) +
                (verificationStats.by_status.contradicted ?? 0)
            ),
        };

        let history: ScoreOutput["history"];
        if (input.include_history) {
          const historyLimit = input.history_limit ?? 10;
          const scoreHistory = await stores.trustScores.getHistory(sessionId, historyLimit);
          history = scoreHistory.map((s) => ({
            score: s.overall_score,
            calculated_at: s.calculated_at.toISOString(),
          }));
        }

        let warning: string | null = null;
        const config = engine.getConfig();
        if (currentScore < config.trustBlockThreshold) {
          warning = `CRITICAL: Trust score below blocking threshold (${config.trustBlockThreshold}). Agent may be unreliable.`;
        } else if (currentScore < config.trustWarningThreshold) {
          warning = `WARNING: Trust score below warning threshold (${config.trustWarningThreshold}). Verify agent actions.`;
        }

        let summary = `Trust Score: ${currentScore.toFixed(0)}/100 `;

        if (trend.direction === "improving") {
          summary += `(+${trend.change.toFixed(1)} improving)`;
        } else if (trend.direction === "declining") {
          summary += `(${trend.change.toFixed(1)} declining)`;
        } else {
          summary += "(stable)";
        }

        summary += `\n\nClaims: ${stats.total_claims} total`;
        summary += `\n  - Verified: ${stats.verified}`;
        summary += `\n  - Contradicted (FALSE): ${stats.contradicted}`;
        summary += `\n  - Unverified: ${stats.unverified}`;
        summary += `\n\nAccuracy: ${(stats.accuracy_rate * 100).toFixed(0)}%`;

        if (warning) {
          summary = `${warning}\n\n${summary}`;
        }

        return {
          success: true,
          current_score: currentScore,
          trend: trend.direction,
          trend_change: trend.change,
          stats,
          category_scores: categoryScores,
          history,
          warning,
          summary,
        };
      } catch (error) {
        return {
          success: false,
          current_score: 0,
          trend: "stable",
          trend_change: 0,
          stats: {
            total_claims: 0,
            verified: 0,
            contradicted: 0,
            unverified: 0,
            accuracy_rate: 0,
          },
          category_scores: {},
          warning: `Failed to get score: ${error}`,
          summary: `Error: ${error}`,
        };
      }
    },
  };
}
