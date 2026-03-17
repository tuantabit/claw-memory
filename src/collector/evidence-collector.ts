
import type { Database } from "../core/database.js";
import type { Evidence, Claim, ClaimType } from "../types.js";
import { FileEvidenceSource } from "./sources/file-source.js";
import { CommandEvidenceSource } from "./sources/command-source.js";
import { ToolEvidenceSource } from "./sources/tool-source.js";
import { GitEvidenceSource } from "./sources/git-source.js";

export interface CollectionResult {
  claim_id: string;
  evidence: Evidence[];
  sources_checked: string[];
  collection_time_ms: number;
}

export class EvidenceCollector {
  private fileSource: FileEvidenceSource;
  private commandSource: CommandEvidenceSource;
  private toolSource: ToolEvidenceSource;
  private gitSource: GitEvidenceSource;

  constructor(db: Database, cwd: string = process.cwd()) {
    this.fileSource = new FileEvidenceSource(db);
    this.commandSource = new CommandEvidenceSource(db);
    this.toolSource = new ToolEvidenceSource(db);
    this.gitSource = new GitEvidenceSource(cwd);
  }

  /**
   * Collect all evidence for a claim
   * Main entry point (like ContextAssembler.assemble())
   */
  async collectForClaim(claim: Claim): Promise<CollectionResult> {
    const startTime = Date.now();
    const evidence: Evidence[] = [];
    const sourcesChecked: string[] = [];

    const sources = this.getSourcesForClaimType(claim.claim_type);

    const collectionPromises: Promise<Evidence[]>[] = [];

    if (sources.includes("file")) {
      sourcesChecked.push("file");
      collectionPromises.push(this.fileSource.collectForClaim(claim));
    }

    if (sources.includes("command")) {
      sourcesChecked.push("command");
      collectionPromises.push(this.commandSource.collectForClaim(claim));
    }

    if (sources.includes("tool")) {
      sourcesChecked.push("tool");
      collectionPromises.push(this.toolSource.collectForClaim(claim));
    }

    if (sources.includes("git")) {
      sourcesChecked.push("git");
      collectionPromises.push(this.gitSource.collectForClaim(claim));
    }

    const results = await Promise.all(collectionPromises);

    for (const result of results) {
      evidence.push(...result);
    }

    const deduped = this.deduplicateEvidence(evidence);

    return {
      claim_id: claim.claim_id,
      evidence: deduped,
      sources_checked: sourcesChecked,
      collection_time_ms: Date.now() - startTime,
    };
  }

  /**
   * Collect evidence for multiple claims
   */
  async collectForClaims(claims: Claim[]): Promise<Map<string, CollectionResult>> {
    const results = new Map<string, CollectionResult>();

    const batchSize = 5;
    for (let i = 0; i < claims.length; i += batchSize) {
      const batch = claims.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map((claim) => this.collectForClaim(claim))
      );

      for (const result of batchResults) {
        results.set(result.claim_id, result);
      }
    }

    return results;
  }

  /**
   * Get sources relevant for a claim type
   */
  private getSourcesForClaimType(
    claimType: ClaimType
  ): Array<"file" | "command" | "tool" | "git"> {
    const sourceMap: Record<ClaimType, Array<"file" | "command" | "tool" | "git">> = {
      file_created: ["file", "tool", "git"],
      file_modified: ["file", "tool", "git"],
      file_deleted: ["file", "tool", "git"],
      code_added: ["file", "tool", "git"],
      code_removed: ["file", "tool", "git"],
      code_fixed: ["file", "tool", "git"],
      command_executed: ["command", "tool"],
      test_passed: ["command", "tool"],
      test_failed: ["command", "tool"],
      error_fixed: ["file", "command", "tool"],
      dependency_added: ["command", "tool", "file"],
      config_changed: ["file", "tool", "git"],
      task_completed: ["tool"],
      unknown: ["tool"],
    };

    return sourceMap[claimType] ?? ["tool"];
  }

  /**
   * Deduplicate evidence by source_ref
   */
  private deduplicateEvidence(evidence: Evidence[]): Evidence[] {
    const seen = new Map<string, Evidence>();

    for (const e of evidence) {
      const key = `${e.source}:${e.source_ref}`;
      const existing = seen.get(key);

      if (!existing || e.confidence > existing.confidence) {
        seen.set(key, e);
      }
    }

    return Array.from(seen.values());
  }

  /**
   * Get summary of evidence for a claim
   */
  summarizeEvidence(evidence: Evidence[]): {
    total: number;
    supporting: number;
    contradicting: number;
    by_source: Record<string, number>;
    average_confidence: number;
  } {
    const supporting = evidence.filter((e) => e.supports_claim).length;
    const contradicting = evidence.filter((e) => !e.supports_claim).length;

    const bySource: Record<string, number> = {};
    for (const e of evidence) {
      bySource[e.source] = (bySource[e.source] ?? 0) + 1;
    }

    const avgConfidence =
      evidence.length > 0
        ? evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length
        : 0;

    return {
      total: evidence.length,
      supporting,
      contradicting,
      by_source: bySource,
      average_confidence: avgConfidence,
    };
  }

  /**
   * Check if there's sufficient evidence for a claim
   */
  hasSufficientEvidence(evidence: Evidence[]): boolean {
    if (evidence.length === 0) return false;

    return evidence.some((e) => e.confidence >= 0.7);
  }

  /**
   * Get the strongest evidence (highest confidence supporting)
   */
  getStrongestEvidence(evidence: Evidence[]): Evidence | null {
    const supporting = evidence.filter((e) => e.supports_claim);
    if (supporting.length === 0) return null;

    return supporting.reduce((best, e) =>
      e.confidence > best.confidence ? e : best
    );
  }

  /**
   * Get the strongest contradicting evidence
   */
  getStrongestContradiction(evidence: Evidence[]): Evidence | null {
    const contradicting = evidence.filter((e) => !e.supports_claim);
    if (contradicting.length === 0) return null;

    return contradicting.reduce((best, e) =>
      e.confidence > best.confidence ? e : best
    );
  }
}

export function createEvidenceCollector(
  db: Database,
  cwd?: string
): EvidenceCollector {
  return new EvidenceCollector(db, cwd);
}
