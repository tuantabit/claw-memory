/**
 * Task Completion Verification Strategy
 * Verify task completion claims
 */

import type {
  Claim,
  Evidence,
  VerificationInput,
  VerificationOutput,
  VerificationStatus,
} from "../../types.js";

export class CompletionVerificationStrategy {
  /**
   * Verify a task completion claim
   */
  verify(input: VerificationInput): VerificationOutput {
    const { claim, evidence } = input;

    // Completion claims require substantial evidence
    // We need to see that actions were actually taken

    const toolEvidence = evidence.filter((e) => e.source === "tool_call");
    const fileEvidence = evidence.filter(
      (e) => e.source === "file_receipt" || e.source === "filesystem"
    );
    const commandEvidence = evidence.filter((e) => e.source === "command_receipt");

    // Calculate activity score
    const activityScore = this.calculateActivityScore(
      toolEvidence,
      fileEvidence,
      commandEvidence
    );

    // Check for recent activity
    const recentActivity = this.hasRecentActivity(evidence);

    // Check for successful outcomes
    const successfulOutcomes = this.countSuccessfulOutcomes(evidence);

    // Determine verification result
    let status: VerificationStatus;
    let confidence: number;
    let details: string;

    if (activityScore >= 0.7 && recentActivity && successfulOutcomes > 0) {
      status = "verified";
      confidence = Math.min(activityScore, 0.9);
      details = `Task completion verified: ${toolEvidence.length} tool calls, ${fileEvidence.length} file operations, ${successfulOutcomes} successful outcomes`;
    } else if (activityScore >= 0.4) {
      status = "unverified";
      confidence = activityScore * 0.7;
      details = `Task partially complete: Activity detected but outcomes unclear`;
    } else if (evidence.length === 0) {
      status = "contradicted";
      confidence = 0.85;
      details = `CONTRADICTION: Agent claimed task complete but no actions were recorded`;
    } else {
      status = "insufficient_evidence";
      confidence = 0.3;
      details = `Insufficient evidence to verify task completion`;
    }

    return {
      status,
      confidence,
      details,
      supporting_evidence: evidence.filter((e) => e.supports_claim).map((e) => e.evidence_id),
      contradicting_evidence: evidence.filter((e) => !e.supports_claim).map((e) => e.evidence_id),
    };
  }

  /**
   * Calculate activity score based on evidence
   */
  private calculateActivityScore(
    toolEvidence: Evidence[],
    fileEvidence: Evidence[],
    commandEvidence: Evidence[]
  ): number {
    let score = 0;

    // Weight different types of evidence
    score += Math.min(toolEvidence.length * 0.1, 0.4);
    score += Math.min(fileEvidence.length * 0.15, 0.3);
    score += Math.min(commandEvidence.length * 0.1, 0.3);

    // Bonus for diversity of evidence
    const evidenceTypes = [
      toolEvidence.length > 0,
      fileEvidence.length > 0,
      commandEvidence.length > 0,
    ].filter(Boolean).length;

    score += evidenceTypes * 0.1;

    return Math.min(score, 1.0);
  }

  /**
   * Check if there was recent activity
   */
  private hasRecentActivity(evidence: Evidence[]): boolean {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

    return evidence.some((e) => {
      const collectedAt = new Date(e.collected_at).getTime();
      return collectedAt >= fiveMinutesAgo;
    });
  }

  /**
   * Count successful outcomes
   */
  private countSuccessfulOutcomes(evidence: Evidence[]): number {
    let count = 0;

    for (const e of evidence) {
      const data = e.data as {
        exit_code?: number;
        after_hash?: string;
        before_hash?: string;
      };

      // Successful command
      if (data.exit_code === 0) {
        count++;
      }

      // File was actually changed
      if (data.before_hash && data.after_hash && data.before_hash !== data.after_hash) {
        count++;
      }

      // General supporting evidence
      if (e.supports_claim && e.confidence >= 0.7) {
        count++;
      }
    }

    return count;
  }

  /**
   * Check if this strategy handles the claim type
   */
  handles(claimType: string): boolean {
    return claimType === "task_completed";
  }
}
