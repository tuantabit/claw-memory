import type { Database } from "../../core/database.js";
import type { Claim, Evidence, ClaimEntity } from "../../types.js";
import { SharedDatabaseAdapter } from "../../shared/database-adapter.js";
import { nanoid } from "nanoid";

export interface ReceiptSourceConfig {
  maxReceiptsPerClaim: number;
  lookbackMinutes: number;
}

export const DEFAULT_RECEIPT_SOURCE_CONFIG: ReceiptSourceConfig = {
  maxReceiptsPerClaim: 10,
  lookbackMinutes: 60,
};

export class ReceiptSource {
  private adapter: SharedDatabaseAdapter;
  private config: ReceiptSourceConfig;

  constructor(db: Database, config: Partial<ReceiptSourceConfig> = {}) {
    this.adapter = new SharedDatabaseAdapter(db);
    this.config = { ...DEFAULT_RECEIPT_SOURCE_CONFIG, ...config };
  }

  async collect(claim: Claim): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    const fileEntity = claim.entities.find(e => e.type === "file");
    if (fileEntity && this.isFileRelatedClaim(claim.claim_type)) {
      const fileEvidence = await this.collectFileEvidence(claim, fileEntity);
      evidence.push(...fileEvidence);
    }

    const commandEntity = claim.entities.find(e => e.type === "command");
    if (commandEntity && this.isCommandRelatedClaim(claim.claim_type)) {
      const commandEvidence = await this.collectCommandEvidence(claim, commandEntity);
      evidence.push(...commandEvidence);
    }

    if (this.isTestRelatedClaim(claim.claim_type)) {
      const testEvidence = await this.collectTestEvidence(claim);
      evidence.push(...testEvidence);
    }

    return evidence.slice(0, this.config.maxReceiptsPerClaim);
  }

  private async collectFileEvidence(claim: Claim, fileEntity: ClaimEntity): Promise<Evidence[]> {
    const evidence: Evidence[] = [];
    const filePath = fileEntity.normalized ?? fileEntity.value;

    const receipt = await this.adapter.getFileReceiptByPath(filePath);
    if (receipt) {
      const supports = this.evaluateFileReceipt(claim.claim_type, receipt);
      evidence.push({
        evidence_id: nanoid(),
        claim_id: claim.claim_id,
        source: "file_receipt",
        source_ref: receipt.receipt_id,
        data: {
          file_path: receipt.file_path,
          before_hash: receipt.before_hash,
          after_hash: receipt.after_hash,
          created_at: receipt.created_at.toISOString(),
        },
        supports_claim: supports,
        confidence: supports ? 0.95 : 0.9,
        collected_at: new Date(),
      });

      await this.adapter.linkClaimToReceipt(
        claim.claim_id,
        "file",
        receipt.receipt_id,
        supports ? 0.95 : 0.9
      );
    }

    return evidence;
  }

  private async collectCommandEvidence(claim: Claim, commandEntity: ClaimEntity): Promise<Evidence[]> {
    const evidence: Evidence[] = [];
    const command = commandEntity.normalized ?? commandEntity.value;

    const receipt = await this.adapter.getCommandReceiptByPattern(command);
    if (receipt) {
      const supports = this.evaluateCommandReceipt(claim.claim_type, receipt);
      evidence.push({
        evidence_id: nanoid(),
        claim_id: claim.claim_id,
        source: "command_receipt",
        source_ref: receipt.receipt_id,
        data: {
          command: receipt.command,
          exit_code: receipt.exit_code,
          stdout_summary: receipt.stdout_summary,
          duration_ms: receipt.duration_ms,
          created_at: receipt.created_at.toISOString(),
        },
        supports_claim: supports,
        confidence: supports ? 0.95 : 0.9,
        collected_at: new Date(),
      });

      await this.adapter.linkClaimToReceipt(
        claim.claim_id,
        "command",
        receipt.receipt_id,
        supports ? 0.95 : 0.9
      );
    }

    return evidence;
  }

  private async collectTestEvidence(claim: Claim): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    const testReceipt = await this.adapter.getCommandReceiptByPattern("test");
    if (testReceipt) {
      const testPassed = testReceipt.exit_code === 0;
      const claimSaysPass = claim.claim_type === "test_passed";
      const supports = testPassed === claimSaysPass;

      evidence.push({
        evidence_id: nanoid(),
        claim_id: claim.claim_id,
        source: "command_receipt",
        source_ref: testReceipt.receipt_id,
        data: {
          command: testReceipt.command,
          exit_code: testReceipt.exit_code,
          stdout_summary: testReceipt.stdout_summary,
          test_passed: testPassed,
        },
        supports_claim: supports,
        confidence: 0.98,
        collected_at: new Date(),
      });

      await this.adapter.linkClaimToReceipt(
        claim.claim_id,
        "command",
        testReceipt.receipt_id,
        0.98
      );
    }

    return evidence;
  }

  private evaluateFileReceipt(
    claimType: string,
    receipt: { before_hash: string; after_hash: string }
  ): boolean {
    const wasCreated = !receipt.before_hash && !!receipt.after_hash;
    const wasModified = !!receipt.before_hash && !!receipt.after_hash && receipt.before_hash !== receipt.after_hash;
    const wasDeleted = !!receipt.before_hash && !receipt.after_hash;

    switch (claimType) {
      case "file_created":
        return wasCreated;
      case "file_modified":
        return wasModified;
      case "file_deleted":
        return wasDeleted;
      default:
        return wasCreated || wasModified;
    }
  }

  private evaluateCommandReceipt(
    claimType: string,
    receipt: { exit_code: number | null }
  ): boolean {
    const succeeded = receipt.exit_code === 0;

    switch (claimType) {
      case "command_executed":
        return true;
      case "test_passed":
        return succeeded;
      case "test_failed":
        return !succeeded;
      default:
        return succeeded;
    }
  }

  private isFileRelatedClaim(claimType: string): boolean {
    return ["file_created", "file_modified", "file_deleted", "code_added", "code_removed"].includes(claimType);
  }

  private isCommandRelatedClaim(claimType: string): boolean {
    return ["command_executed", "test_passed", "test_failed"].includes(claimType);
  }

  private isTestRelatedClaim(claimType: string): boolean {
    return ["test_passed", "test_failed"].includes(claimType);
  }
}

export function createReceiptSource(db: Database, config?: Partial<ReceiptSourceConfig>): ReceiptSource {
  return new ReceiptSource(db, config);
}
