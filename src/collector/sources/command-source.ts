/**
 * Command Evidence Source
 * Collect evidence from command_receipts table
 */

import type { Database } from "../../core/database.js";
import type { Evidence, Claim, EvidenceSource, CommandReceipt } from "../../types.js";
import { nanoid } from "nanoid";

export interface CommandEvidence {
  command: string;
  exit_code: number | null;
  stdout_summary: string | null;
  duration_ms: number | null;
  executed_at: Date;
}

export class CommandEvidenceSource {
  constructor(private db: Database) {}

  /**
   * Collect evidence for a command-related claim
   */
  async collectForClaim(claim: Claim): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    // Get commands from claim entities
    const commands = claim.entities
      .filter((e) => e.type === "command")
      .map((e) => e.value);

    // Also extract commands from claim text
    const extractedCommands = this.extractCommandsFromText(claim.original_text);
    const allCommands = [...new Set([...commands, ...extractedCommands])];

    for (const command of allCommands) {
      const cmdEvidence = await this.collectForCommand(claim, command);
      evidence.push(...cmdEvidence);
    }

    // If claim is about tests, look for test commands
    if (claim.claim_type === "test_passed" || claim.claim_type === "test_failed") {
      const testEvidence = await this.collectTestEvidence(claim);
      evidence.push(...testEvidence);
    }

    return evidence;
  }

  /**
   * Collect evidence for a specific command
   */
  async collectForCommand(claim: Claim, command: string): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    // Search for matching command receipts
    const receipts = await this.db.query<CommandReceipt>(
      `SELECT * FROM command_receipts
       WHERE command LIKE ?
       ORDER BY created_at DESC
       LIMIT 10`,
      [`%${this.normalizeCommand(command)}%`]
    );

    for (const receipt of receipts) {
      const supports = this.evaluateCommandSupport(claim, receipt);

      evidence.push({
        evidence_id: nanoid(),
        claim_id: claim.claim_id,
        source: "command_receipt" as EvidenceSource,
        source_ref: receipt.receipt_id,
        data: {
          command: receipt.command,
          exit_code: receipt.exit_code,
          stdout_summary: receipt.stdout_summary,
          duration_ms: receipt.duration_ms,
          created_at: receipt.created_at,
        },
        supports_claim: supports,
        confidence: this.calculateCommandConfidence(claim, receipt, command),
        collected_at: new Date(),
      });
    }

    return evidence;
  }

  /**
   * Collect evidence specifically for test claims
   */
  async collectTestEvidence(claim: Claim): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    // Look for test-related commands
    const testCommands = await this.db.query<CommandReceipt>(
      `SELECT * FROM command_receipts
       WHERE command LIKE '%test%'
          OR command LIKE '%jest%'
          OR command LIKE '%vitest%'
          OR command LIKE '%mocha%'
          OR command LIKE '%pytest%'
       ORDER BY created_at DESC
       LIMIT 5`
    );

    for (const receipt of testCommands) {
      const supports = this.evaluateTestSupport(claim, receipt);

      evidence.push({
        evidence_id: nanoid(),
        claim_id: claim.claim_id,
        source: "command_receipt" as EvidenceSource,
        source_ref: receipt.receipt_id,
        data: {
          command: receipt.command,
          exit_code: receipt.exit_code,
          stdout_summary: receipt.stdout_summary,
          duration_ms: receipt.duration_ms,
          is_test_command: true,
        },
        supports_claim: supports,
        confidence: this.calculateTestConfidence(claim, receipt),
        collected_at: new Date(),
      });
    }

    return evidence;
  }

  /**
   * Extract commands from text
   */
  private extractCommandsFromText(text: string): string[] {
    const commands: string[] = [];

    // Commands in backticks
    const backtickMatches = text.matchAll(/`([^`]+)`/g);
    for (const match of backtickMatches) {
      const cmd = match[1];
      if (this.looksLikeCommand(cmd)) {
        commands.push(cmd);
      }
    }

    // Common command patterns
    const patterns = [
      /(?:ran?|executed?|running)\s+[`"]?([^\s`"]+(?:\s+[^\s`"]+)*)[`"]?/gi,
      /npm\s+(?:run\s+)?(\w+)/gi,
      /pnpm\s+(?:run\s+)?(\w+)/gi,
      /yarn\s+(?:run\s+)?(\w+)/gi,
    ];

    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          commands.push(match[0]);
        }
      }
    }

    return commands;
  }

  /**
   * Check if text looks like a command
   */
  private looksLikeCommand(text: string): boolean {
    const commandPrefixes = [
      "npm", "pnpm", "yarn", "node", "npx",
      "git", "cd", "mkdir", "rm", "cat", "ls",
      "python", "pip", "cargo", "go", "make",
      "docker", "kubectl",
    ];

    const firstWord = text.split(/\s+/)[0]?.toLowerCase();
    return commandPrefixes.includes(firstWord ?? "") || text.startsWith("./");
  }

  /**
   * Normalize command for matching
   */
  private normalizeCommand(command: string): string {
    // Extract main command without arguments
    return command.split(/\s+/).slice(0, 3).join(" ");
  }

  /**
   * Evaluate if command receipt supports the claim
   */
  private evaluateCommandSupport(claim: Claim, receipt: CommandReceipt): boolean {
    switch (claim.claim_type) {
      case "command_executed":
        // Command was executed if receipt exists
        return true;

      case "test_passed":
        // Tests passed if exit code is 0
        return receipt.exit_code === 0;

      case "test_failed":
        // Tests failed if exit code is non-zero
        return receipt.exit_code !== 0 && receipt.exit_code !== null;

      case "dependency_added":
        // Check if install command succeeded
        return (
          receipt.exit_code === 0 &&
          (receipt.command.includes("install") || receipt.command.includes("add"))
        );

      default:
        return receipt.exit_code === 0;
    }
  }

  /**
   * Evaluate if receipt supports test claim
   */
  private evaluateTestSupport(claim: Claim, receipt: CommandReceipt): boolean {
    if (claim.claim_type === "test_passed") {
      return receipt.exit_code === 0;
    } else if (claim.claim_type === "test_failed") {
      return receipt.exit_code !== 0 && receipt.exit_code !== null;
    }
    return false;
  }

  /**
   * Calculate confidence for command evidence
   */
  private calculateCommandConfidence(
    claim: Claim,
    receipt: CommandReceipt,
    searchCommand: string
  ): number {
    let confidence = 0.6;

    // Higher confidence if command matches closely
    if (receipt.command.includes(searchCommand)) {
      confidence += 0.2;
    }

    // Higher confidence if exit code is definitive
    if (receipt.exit_code !== null) {
      confidence += 0.1;
    }

    // Higher confidence for recent commands
    const age = Date.now() - new Date(receipt.created_at).getTime();
    if (age < 60000) { // Within 1 minute
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  /**
   * Calculate confidence for test evidence
   */
  private calculateTestConfidence(claim: Claim, receipt: CommandReceipt): number {
    let confidence = 0.7;

    // Higher confidence if exit code is clear
    if (receipt.exit_code === 0 && claim.claim_type === "test_passed") {
      confidence += 0.2;
    } else if (receipt.exit_code !== 0 && claim.claim_type === "test_failed") {
      confidence += 0.2;
    }

    // Check stdout for test result indicators
    if (receipt.stdout_summary) {
      if (
        receipt.stdout_summary.includes("passed") ||
        receipt.stdout_summary.includes("success")
      ) {
        confidence += claim.claim_type === "test_passed" ? 0.1 : -0.1;
      }
      if (
        receipt.stdout_summary.includes("failed") ||
        receipt.stdout_summary.includes("error")
      ) {
        confidence += claim.claim_type === "test_failed" ? 0.1 : -0.1;
      }
    }

    return Math.max(0, Math.min(confidence, 1.0));
  }
}
