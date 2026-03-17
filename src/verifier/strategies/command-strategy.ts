/**
 * Command Verification Strategy
 * Verify command execution claims
 */

import type {
  Claim,
  Evidence,
  VerificationInput,
  VerificationOutput,
  VerificationStatus,
} from "../../types.js";

export class CommandVerificationStrategy {
  /**
   * Verify a command-related claim
   */
  verify(input: VerificationInput): VerificationOutput {
    const { claim, evidence } = input;

    // Filter relevant evidence
    const cmdEvidence = evidence.filter(
      (e) => e.source === "command_receipt" || e.source === "tool_call"
    );

    if (cmdEvidence.length === 0) {
      return {
        status: "insufficient_evidence",
        confidence: 0.3,
        details: "No command execution evidence found",
        supporting_evidence: [],
        contradicting_evidence: [],
      };
    }

    // For test claims, check exit codes
    if (claim.claim_type === "test_passed" || claim.claim_type === "test_failed") {
      return this.verifyTestClaim(claim, cmdEvidence);
    }

    // For general command claims
    return this.verifyCommandClaim(claim, cmdEvidence);
  }

  /**
   * Verify test-related claims
   */
  private verifyTestClaim(claim: Claim, evidence: Evidence[]): VerificationOutput {
    const supporting: Evidence[] = [];
    const contradicting: Evidence[] = [];

    for (const e of evidence) {
      const data = e.data as { exit_code?: number; stdout_summary?: string };
      const exitCode = data.exit_code;

      if (claim.claim_type === "test_passed") {
        if (exitCode === 0) {
          supporting.push(e);
        } else if (exitCode !== null && exitCode !== undefined) {
          contradicting.push(e);
        }
      } else if (claim.claim_type === "test_failed") {
        if (exitCode !== 0 && exitCode !== null && exitCode !== undefined) {
          supporting.push(e);
        } else if (exitCode === 0) {
          contradicting.push(e);
        }
      }
    }

    // Determine result
    let status: VerificationStatus;
    let confidence: number;
    let details: string;

    if (contradicting.length > 0) {
      status = "contradicted";
      const exitCodes = contradicting
        .map((e) => (e.data as { exit_code?: number }).exit_code)
        .filter((c) => c !== undefined);

      if (claim.claim_type === "test_passed") {
        details = `CONTRADICTION: Agent claimed tests passed, but exit code was ${exitCodes[0]}`;
      } else {
        details = `CONTRADICTION: Agent claimed tests failed, but exit code was 0`;
      }
      confidence = 0.95;
    } else if (supporting.length > 0) {
      status = "verified";
      if (claim.claim_type === "test_passed") {
        details = `Tests verified: exit code 0 confirmed`;
      } else {
        details = `Test failure verified: non-zero exit code confirmed`;
      }
      confidence = 0.9;
    } else {
      status = "insufficient_evidence";
      details = "No test execution evidence found";
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
   * Verify general command claims
   */
  private verifyCommandClaim(claim: Claim, evidence: Evidence[]): VerificationOutput {
    const commandEntities = claim.entities.filter((e) => e.type === "command");
    const expectedCommands = commandEntities.map((e) => e.value);

    const supporting: Evidence[] = [];
    const contradicting: Evidence[] = [];

    for (const e of evidence) {
      const data = e.data as { command?: string; exit_code?: number };

      // Check if command matches
      const commandMatches = expectedCommands.some(
        (cmd) => data.command?.includes(cmd) ?? false
      );

      if (commandMatches || expectedCommands.length === 0) {
        if (e.supports_claim) {
          supporting.push(e);
        } else {
          contradicting.push(e);
        }
      }
    }

    // Determine result
    let status: VerificationStatus;
    let confidence: number;
    let details: string;

    if (supporting.length > 0) {
      status = "verified";
      details = `Command execution verified: ${supporting.length} matching executions found`;
      confidence = Math.min(0.7 + supporting.length * 0.1, 0.95);
    } else if (evidence.length > 0) {
      status = "unverified";
      details = `Commands found but no exact match for claimed command`;
      confidence = 0.4;
    } else {
      status = "insufficient_evidence";
      details = "No command execution records found";
      confidence = 0.2;
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
   * Check if this strategy handles the claim type
   */
  handles(claimType: string): boolean {
    return ["command_executed", "test_passed", "test_failed", "dependency_added"].includes(
      claimType
    );
  }
}
