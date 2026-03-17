
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Database } from "../../core/database.js";
import type { Evidence, Claim, EvidenceSource, FileReceipt } from "../../types.js";
import { nanoid } from "nanoid";

export interface FileEvidence {
  exists: boolean;
  path: string;
  hash?: string;
  size?: number;
  modified_at?: Date;
  content_sample?: string;
}

export class FileEvidenceSource {
  constructor(private db: Database) {}

  
  async collectForClaim(claim: Claim): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    const filePaths = claim.entities
      .filter((e) => e.type === "file")
      .map((e) => e.normalized ?? e.value);

    for (const filePath of filePaths) {
      const receiptEvidence = await this.collectFromReceipts(claim, filePath);
      evidence.push(...receiptEvidence);

      const fsEvidence = await this.collectFromFilesystem(claim, filePath);
      if (fsEvidence) {
        evidence.push(fsEvidence);
      }
    }

    return evidence;
  }

  
  async collectFromReceipts(claim: Claim, filePath: string): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    try {
      const receipts = await this.db.query<FileReceipt>(
        `SELECT * FROM file_receipts
         WHERE file_path LIKE ?
         ORDER BY created_at DESC
         LIMIT 10`,
        [`%${filePath}%`]
      );

      for (const receipt of receipts) {
        const supports = this.evaluateReceiptSupport(claim, receipt);

        evidence.push({
          evidence_id: nanoid(),
          claim_id: claim.claim_id,
          source: "file_receipt" as EvidenceSource,
          source_ref: receipt.receipt_id,
          data: {
            file_path: receipt.file_path,
            before_hash: receipt.before_hash,
            after_hash: receipt.after_hash,
            action_id: receipt.action_id,
            created_at: receipt.created_at,
          },
          supports_claim: supports,
          confidence: this.calculateReceiptConfidence(claim, receipt),
          collected_at: new Date(),
        });
      }
    } catch {
      // ClawMemory tables not available - skip receipt-based evidence
    }

    return evidence;
  }

  
  async collectFromFilesystem(
    claim: Claim,
    filePath: string
  ): Promise<Evidence | null> {
    const fileInfo = await this.getFileInfo(filePath);

    const supports = this.evaluateFilesystemSupport(claim, fileInfo);

    return {
      evidence_id: nanoid(),
      claim_id: claim.claim_id,
      source: "filesystem" as EvidenceSource,
      source_ref: filePath,
      data: fileInfo as unknown as Record<string, unknown>,
      supports_claim: supports,
      confidence: this.calculateFilesystemConfidence(claim, fileInfo),
      collected_at: new Date(),
    };
  }

  
  async getFileInfo(filePath: string): Promise<FileEvidence> {
    const pathsToTry = [
      filePath,
      `./${filePath}`,
      `${process.cwd()}/${filePath}`,
    ];

    for (const path of pathsToTry) {
      if (existsSync(path)) {
        try {
          const stats = await stat(path);
          const content = await readFile(path, "utf-8");
          const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);

          return {
            exists: true,
            path,
            hash,
            size: stats.size,
            modified_at: stats.mtime,
            content_sample: content.slice(0, 500),
          };
        } catch {
          return { exists: true, path };
        }
      }
    }

    return { exists: false, path: filePath };
  }

  
  async fileContains(filePath: string, searchText: string): Promise<boolean> {
    try {
      const pathsToTry = [filePath, `./${filePath}`, `${process.cwd()}/${filePath}`];

      for (const path of pathsToTry) {
        if (existsSync(path)) {
          const content = await readFile(path, "utf-8");
          return content.includes(searchText);
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  
  private evaluateReceiptSupport(claim: Claim, receipt: FileReceipt): boolean {
    switch (claim.claim_type) {
      case "file_created":
        return (
          receipt.before_hash === "NOT_EXIST" ||
          receipt.before_hash === "NEW_FILE"
        );

      case "file_modified":
        return (
          receipt.before_hash !== receipt.after_hash &&
          receipt.before_hash !== "NOT_EXIST" &&
          receipt.before_hash !== "NEW_FILE"
        );

      case "file_deleted":
        return receipt.after_hash === "NOT_EXIST";

      default:
        return receipt.before_hash !== receipt.after_hash;
    }
  }

  
  private evaluateFilesystemSupport(claim: Claim, fileInfo: FileEvidence): boolean {
    switch (claim.claim_type) {
      case "file_created":
      case "file_modified":
      case "code_added":
      case "code_fixed":
        return fileInfo.exists;

      case "file_deleted":
      case "code_removed":
        return !fileInfo.exists;

      default:
        return fileInfo.exists;
    }
  }

  
  private calculateReceiptConfidence(claim: Claim, receipt: FileReceipt): number {
    let confidence = 0.7;

    const claimPath = claim.entities.find((e) => e.type === "file")?.value;
    if (claimPath && receipt.file_path.endsWith(claimPath)) {
      confidence += 0.2;
    }

    const receiptAge = Date.now() - new Date(receipt.created_at).getTime();
    if (receiptAge < 60000) {
      confidence += 0.1;
    }

    return Math.min(confidence, 1.0);
  }

  
  private calculateFilesystemConfidence(
    claim: Claim,
    fileInfo: FileEvidence
  ): number {
    let confidence = 0.6;

    if (fileInfo.exists) {
      confidence += 0.2;

      if (fileInfo.modified_at) {
        const age = Date.now() - fileInfo.modified_at.getTime();
        if (age < 300000) {
          confidence += 0.2;
        }
      }
    }

    return Math.min(confidence, 1.0);
  }
}
