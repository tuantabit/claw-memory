import type { VerificationInput, VerificationOutput, VerificationStatus } from "../../types.js";

export interface ReceiptStrategyConfig {
  minConfidenceForVerified: number;
  minConfidenceForContradicted: number;
  requireReceipt: boolean;
}

export const DEFAULT_RECEIPT_STRATEGY_CONFIG: ReceiptStrategyConfig = {
  minConfidenceForVerified: 0.7,
  minConfidenceForContradicted: 0.7,
  requireReceipt: false,
};

export class ReceiptStrategy {
  private config: ReceiptStrategyConfig;

  constructor(config: Partial<ReceiptStrategyConfig> = {}) {
    this.config = { ...DEFAULT_RECEIPT_STRATEGY_CONFIG, ...config };
  }

  verify(input: VerificationInput): VerificationOutput {
    const receiptEvidence = input.evidence.filter(
      e => e.source === "file_receipt" || e.source === "command_receipt"
    );

    if (receiptEvidence.length === 0) {
      if (this.config.requireReceipt) {
        return {
          status: "contradicted",
          confidence: 0.8,
          details: "No receipt found for claimed action",
          supporting_evidence: [],
          contradicting_evidence: [],
        };
      }
      return {
        status: "insufficient_evidence",
        confidence: 0.3,
        details: "No receipt evidence available",
        supporting_evidence: [],
        contradicting_evidence: [],
      };
    }

    const supporting = receiptEvidence.filter(e => e.supports_claim);
    const contradicting = receiptEvidence.filter(e => !e.supports_claim);

    if (supporting.length > 0 && contradicting.length === 0) {
      const avgConfidence = supporting.reduce((sum, e) => sum + e.confidence, 0) / supporting.length;
      return {
        status: avgConfidence >= this.config.minConfidenceForVerified ? "verified" : "unverified",
        confidence: avgConfidence,
        details: this.buildSupportingDetails(supporting),
        supporting_evidence: supporting.map(e => e.evidence_id),
        contradicting_evidence: [],
      };
    }

    if (contradicting.length > 0 && supporting.length === 0) {
      const avgConfidence = contradicting.reduce((sum, e) => sum + e.confidence, 0) / contradicting.length;
      return {
        status: avgConfidence >= this.config.minConfidenceForContradicted ? "contradicted" : "unverified",
        confidence: avgConfidence,
        details: this.buildContradictingDetails(contradicting),
        supporting_evidence: [],
        contradicting_evidence: contradicting.map(e => e.evidence_id),
      };
    }

    const supportWeight = supporting.reduce((sum, e) => sum + e.confidence, 0);
    const contradictWeight = contradicting.reduce((sum, e) => sum + e.confidence, 0);
    const totalWeight = supportWeight + contradictWeight;

    let status: VerificationStatus;
    let confidence: number;
    let details: string;

    if (supportWeight > contradictWeight) {
      confidence = supportWeight / totalWeight;
      status = confidence >= this.config.minConfidenceForVerified ? "verified" : "unverified";
      details = `Mixed evidence: ${supporting.length} supporting vs ${contradicting.length} contradicting`;
    } else {
      confidence = contradictWeight / totalWeight;
      status = confidence >= this.config.minConfidenceForContradicted ? "contradicted" : "unverified";
      details = `Mixed evidence: ${contradicting.length} contradicting vs ${supporting.length} supporting`;
    }

    return {
      status,
      confidence,
      details,
      supporting_evidence: supporting.map(e => e.evidence_id),
      contradicting_evidence: contradicting.map(e => e.evidence_id),
    };
  }

  private buildSupportingDetails(evidence: Array<{ source: string; data: Record<string, unknown> }>): string {
    const sources = evidence.map(e => {
      if (e.source === "file_receipt") {
        const data = e.data as { file_path?: string };
        return `file: ${data.file_path ?? "unknown"}`;
      }
      if (e.source === "command_receipt") {
        const data = e.data as { command?: string; exit_code?: number };
        return `command: ${data.command ?? "unknown"} (exit: ${data.exit_code ?? "?"})`;
      }
      return e.source;
    });
    return `Verified by receipts: ${sources.join(", ")}`;
  }

  private buildContradictingDetails(evidence: Array<{ source: string; data: Record<string, unknown> }>): string {
    const issues: string[] = [];

    for (const e of evidence) {
      if (e.source === "file_receipt") {
        const data = e.data as { before_hash?: string; after_hash?: string; file_path?: string };
        if (!data.before_hash && !data.after_hash) {
          issues.push(`File ${data.file_path ?? "unknown"} not found in receipts`);
        } else if (data.before_hash === data.after_hash) {
          issues.push(`File ${data.file_path ?? "unknown"} was not modified`);
        }
      }
      if (e.source === "command_receipt") {
        const data = e.data as { command?: string; exit_code?: number; test_passed?: boolean };
        if (data.exit_code !== 0) {
          issues.push(`Command failed with exit code ${data.exit_code}`);
        }
        if (data.test_passed === false) {
          issues.push("Test failed but was claimed to pass");
        }
      }
    }

    return issues.length > 0 ? issues.join("; ") : "Receipt evidence contradicts claim";
  }
}

export function createReceiptStrategy(config?: Partial<ReceiptStrategyConfig>): ReceiptStrategy {
  return new ReceiptStrategy(config);
}
