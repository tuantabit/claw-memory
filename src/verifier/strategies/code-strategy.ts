/**
 * Code Verification Strategy
 * Verify code-related claims (added, removed, fixed)
 */

import type {
  Claim,
  Evidence,
  VerificationInput,
  VerificationOutput,
  VerificationStatus,
} from "../../types.js";

export class CodeVerificationStrategy {
  /**
   * Verify a code-related claim
   */
  verify(input: VerificationInput): VerificationOutput {
    const { claim, evidence } = input;

    // Filter relevant evidence
    const codeEvidence = evidence.filter(
      (e) =>
        e.source === "file_receipt" ||
        e.source === "filesystem" ||
        e.source === "git_diff" ||
        e.source === "code_content" ||
        e.source === "tool_call"
    );

    if (codeEvidence.length === 0) {
      return {
        status: "insufficient_evidence",
        confidence: 0.3,
        details: "No code-related evidence found",
        supporting_evidence: [],
        contradicting_evidence: [],
      };
    }

    // Analyze based on claim type
    switch (claim.claim_type) {
      case "code_added":
        return this.verifyCodeAdded(claim, codeEvidence);

      case "code_removed":
        return this.verifyCodeRemoved(claim, codeEvidence);

      case "code_fixed":
      case "error_fixed":
        return this.verifyCodeFixed(claim, codeEvidence);

      default:
        return this.verifyGenericCode(claim, codeEvidence);
    }
  }

  /**
   * Verify code was added
   */
  private verifyCodeAdded(claim: Claim, evidence: Evidence[]): VerificationOutput {
    const supporting: Evidence[] = [];
    const contradicting: Evidence[] = [];

    for (const e of evidence) {
      const data = e.data as {
        diff_summary?: { additions?: number };
        before_hash?: string;
        after_hash?: string;
      };

      // Check for additions in diff
      if (data.diff_summary?.additions && data.diff_summary.additions > 0) {
        supporting.push(e);
      }
      // Check for hash changes (file was modified)
      else if (data.before_hash && data.after_hash && data.before_hash !== data.after_hash) {
        supporting.push(e);
      }
      // Tool call evidence
      else if (e.source === "tool_call" && e.supports_claim) {
        supporting.push(e);
      }
    }

    // Get entities for details
    const codeEntities = claim.entities.filter(
      (e) => e.type === "function" || e.type === "class" || e.type === "component"
    );
    const names = codeEntities.map((e) => e.value).join(", ");

    let status: VerificationStatus;
    let confidence: number;
    let details: string;

    if (supporting.length > 0) {
      status = "verified";
      details = names
        ? `Code addition verified: ${names} was added. ${supporting.length} evidence found.`
        : `Code addition verified: ${supporting.length} evidence of additions found.`;
      confidence = Math.min(0.6 + supporting.length * 0.15, 0.95);
    } else {
      status = "unverified";
      details = "No evidence of code additions found";
      confidence = 0.3;
    }

    return {
      status,
      confidence,
      details,
      supporting_evidence: supporting.map((e) => e.evidence_id),
      contradicting_evidence: contradicting.map((e) => e.evidence_id),
    };
  }

  /**
   * Verify code was removed
   */
  private verifyCodeRemoved(claim: Claim, evidence: Evidence[]): VerificationOutput {
    const supporting: Evidence[] = [];
    const contradicting: Evidence[] = [];

    for (const e of evidence) {
      const data = e.data as {
        diff_summary?: { deletions?: number };
        before_hash?: string;
        after_hash?: string;
      };

      // Check for deletions in diff
      if (data.diff_summary?.deletions && data.diff_summary.deletions > 0) {
        supporting.push(e);
      }
      // Check for hash changes
      else if (data.before_hash && data.after_hash && data.before_hash !== data.after_hash) {
        supporting.push(e);
      }
      // Tool call evidence
      else if (e.source === "tool_call" && e.supports_claim) {
        supporting.push(e);
      }
    }

    let status: VerificationStatus;
    let confidence: number;
    let details: string;

    if (supporting.length > 0) {
      status = "verified";
      details = `Code removal verified: ${supporting.length} evidence of deletions found.`;
      confidence = Math.min(0.6 + supporting.length * 0.15, 0.95);
    } else {
      status = "unverified";
      details = "No evidence of code removals found";
      confidence = 0.3;
    }

    return {
      status,
      confidence,
      details,
      supporting_evidence: supporting.map((e) => e.evidence_id),
      contradicting_evidence: contradicting.map((e) => e.evidence_id),
    };
  }

  /**
   * Verify code/error was fixed
   */
  private verifyCodeFixed(claim: Claim, evidence: Evidence[]): VerificationOutput {
    const supporting: Evidence[] = [];
    const contradicting: Evidence[] = [];

    // Look for file changes as evidence of fix
    for (const e of evidence) {
      const data = e.data as {
        before_hash?: string;
        after_hash?: string;
        diff_summary?: { additions?: number; deletions?: number };
        exit_code?: number;
      };

      // File was changed (potential fix)
      if (data.before_hash && data.after_hash && data.before_hash !== data.after_hash) {
        supporting.push(e);
      }
      // Has additions and deletions (refactoring/fix pattern)
      else if (
        data.diff_summary?.additions &&
        data.diff_summary?.deletions &&
        data.diff_summary.additions > 0 &&
        data.diff_summary.deletions > 0
      ) {
        supporting.push(e);
      }
      // Successful test after fix
      else if (data.exit_code === 0 && e.source === "command_receipt") {
        supporting.push(e);
      }
      // Tool call that modified something
      else if (e.source === "tool_call" && e.supports_claim) {
        supporting.push(e);
      }
    }

    let status: VerificationStatus;
    let confidence: number;
    let details: string;

    if (supporting.length >= 2) {
      status = "verified";
      details = `Fix verified: Code changes detected with ${supporting.length} evidence.`;
      confidence = Math.min(0.7 + supporting.length * 0.1, 0.95);
    } else if (supporting.length === 1) {
      status = "verified";
      details = "Fix partially verified: Code was changed but fix effect unconfirmed.";
      confidence = 0.6;
    } else {
      status = "unverified";
      details = "No evidence of code fix found";
      confidence = 0.3;
    }

    return {
      status,
      confidence,
      details,
      supporting_evidence: supporting.map((e) => e.evidence_id),
      contradicting_evidence: contradicting.map((e) => e.evidence_id),
    };
  }

  /**
   * Generic code verification
   */
  private verifyGenericCode(claim: Claim, evidence: Evidence[]): VerificationOutput {
    const supporting = evidence.filter((e) => e.supports_claim);
    const contradicting = evidence.filter((e) => !e.supports_claim);

    const supportWeight = supporting.reduce((sum, e) => sum + e.confidence, 0);
    const contradictWeight = contradicting.reduce((sum, e) => sum + e.confidence, 0);

    let status: VerificationStatus;
    let confidence: number;

    if (contradictWeight > supportWeight && contradicting.length > 0) {
      status = "contradicted";
      confidence = contradictWeight / (supportWeight + contradictWeight);
    } else if (supporting.length > 0) {
      status = "verified";
      confidence = supportWeight / (supportWeight + contradictWeight + 0.1);
    } else {
      status = "insufficient_evidence";
      confidence = 0.2;
    }

    return {
      status,
      confidence: Math.min(confidence, 1.0),
      details: `Generic code verification: ${supporting.length} supporting, ${contradicting.length} contradicting`,
      supporting_evidence: supporting.map((e) => e.evidence_id),
      contradicting_evidence: contradicting.map((e) => e.evidence_id),
    };
  }

  /**
   * Check if this strategy handles the claim type
   */
  handles(claimType: string): boolean {
    return ["code_added", "code_removed", "code_fixed", "error_fixed", "config_changed"].includes(
      claimType
    );
  }
}
