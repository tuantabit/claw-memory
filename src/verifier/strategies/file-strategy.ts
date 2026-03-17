/**
 * File Verification Strategy
 * Verify file-related claims
 */

import type {
  Claim,
  Evidence,
  VerificationInput,
  VerificationOutput,
  VerificationStatus,
} from "../../types.js";

export class FileVerificationStrategy {
  /**
   * Verify a file-related claim
   */
  verify(input: VerificationInput): VerificationOutput {
    const { claim, evidence } = input;

    // Filter relevant evidence
    const fileEvidence = evidence.filter(
      (e) => e.source === "file_receipt" || e.source === "filesystem" || e.source === "git_diff"
    );

    if (fileEvidence.length === 0) {
      return {
        status: "insufficient_evidence",
        confidence: 0.3,
        details: "No file-related evidence found",
        supporting_evidence: [],
        contradicting_evidence: [],
      };
    }

    // Analyze evidence
    const supporting = fileEvidence.filter((e) => e.supports_claim);
    const contradicting = fileEvidence.filter((e) => !e.supports_claim);

    // Calculate weighted confidence
    const supportingWeight = supporting.reduce((sum, e) => sum + e.confidence, 0);
    const contradictingWeight = contradicting.reduce((sum, e) => sum + e.confidence, 0);

    // Determine status
    let status: VerificationStatus;
    let confidence: number;
    let details: string;

    if (contradicting.length > 0 && contradictingWeight > supportingWeight) {
      status = "contradicted";
      confidence = contradictingWeight / (supportingWeight + contradictingWeight);
      details = this.buildContradictionDetails(claim, contradicting);
    } else if (supporting.length > 0 && supportingWeight >= 0.6) {
      status = "verified";
      confidence = supportingWeight / (supportingWeight + contradictingWeight + 0.1);
      details = this.buildVerificationDetails(claim, supporting);
    } else if (supporting.length > 0) {
      status = "unverified";
      confidence = supportingWeight / 2;
      details = "Evidence found but confidence is low";
    } else {
      status = "insufficient_evidence";
      confidence = 0.2;
      details = "No supporting evidence found";
    }

    return {
      status,
      confidence: Math.min(confidence, 1.0),
      details,
      supporting_evidence: supporting.map((e) => e.evidence_id),
      contradicting_evidence: contradicting.map((e) => e.evidence_id),
    };
  }

  /**
   * Build details for verified claim
   */
  private buildVerificationDetails(claim: Claim, evidence: Evidence[]): string {
    const fileEntities = claim.entities.filter((e) => e.type === "file");
    const files = fileEntities.map((e) => e.value).join(", ");

    switch (claim.claim_type) {
      case "file_created":
        return `File creation verified: ${files}. Found ${evidence.length} supporting evidence.`;

      case "file_modified":
        return `File modification verified: ${files}. Hash changes confirmed.`;

      case "file_deleted":
        return `File deletion verified: ${files}. File no longer exists.`;

      default:
        return `Claim verified with ${evidence.length} pieces of evidence.`;
    }
  }

  /**
   * Build details for contradicted claim
   */
  private buildContradictionDetails(claim: Claim, evidence: Evidence[]): string {
    const fileEntities = claim.entities.filter((e) => e.type === "file");
    const files = fileEntities.map((e) => e.value).join(", ");

    switch (claim.claim_type) {
      case "file_created":
        return `CONTRADICTION: Agent claimed to create ${files}, but no file creation evidence found.`;

      case "file_modified":
        return `CONTRADICTION: Agent claimed to modify ${files}, but file hash unchanged.`;

      case "file_deleted":
        return `CONTRADICTION: Agent claimed to delete ${files}, but file still exists.`;

      default:
        return `Claim contradicted by ${evidence.length} pieces of evidence.`;
    }
  }

  /**
   * Check if this strategy handles the claim type
   */
  handles(claimType: string): boolean {
    return ["file_created", "file_modified", "file_deleted"].includes(claimType);
  }
}
