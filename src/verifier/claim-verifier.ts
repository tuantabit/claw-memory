/**
 * Claim Verifier - Verify claims against evidence
 *
 * This module orchestrates the verification process:
 * 1. Collect evidence from multiple sources (filesystem, git, command receipts)
 * 2. Select appropriate verification strategy based on claim type
 * 3. Apply strategy to determine if claim is verified/contradicted/unverified
 * 4. Store verification results
 *
 * Each claim type has a specialized strategy (file, command, code, completion).
 * The default strategy handles unknown claim types with generic evidence weighting.
 */

import type { Database } from "../core/database.js";
import type {
  Claim,
  Evidence,
  Verification,
  VerificationStatus,
  VerificationInput,
  VerificationOutput,
  ClawMemoryConfig,
} from "../types.js";
import { ClawMemoryStores, createStores } from "../store/index.js";
import { EvidenceCollector, createEvidenceCollector } from "../collector/index.js";
import { FileVerificationStrategy } from "./strategies/file-strategy.js";
import { CommandVerificationStrategy } from "./strategies/command-strategy.js";
import { CodeVerificationStrategy } from "./strategies/code-strategy.js";
import { CompletionVerificationStrategy } from "./strategies/completion-strategy.js";

/**
 * Strategy interface for claim verification
 * Each strategy handles specific claim types with specialized logic
 */
interface VerificationStrategy {
  /** Verify a claim against collected evidence */
  verify(input: VerificationInput): VerificationOutput;

  /** Check if this strategy handles the given claim type */
  handles(claimType: string): boolean;
}

/**
 * Complete result of a verification including all related data
 */
export interface FullVerificationResult {
  claim: Claim;
  verification: Verification;
  evidence: Evidence[];
  output: VerificationOutput;
}

/**
 * Verifies claims against collected evidence
 *
 * @example
 * ```typescript
 * const verifier = new ClaimVerifier(db, config);
 *
 * // Verify a single claim
 * const result = await verifier.verify(claim);
 * console.log(result.verification.status); // "verified" | "contradicted" | "unverified"
 *
 * // Verify all claims in a session
 * const results = await verifier.verifySession("session-123");
 *
 * // Get contradictions for review
 * const contradictions = await verifier.getContradictions("session-123");
 * ```
 */
export class ClaimVerifier {
  private stores: ClawMemoryStores;
  private collector: EvidenceCollector;
  private strategies: VerificationStrategy[];
  private config: ClawMemoryConfig;

  constructor(db: Database, config: ClawMemoryConfig, cwd?: string) {
    this.stores = createStores(db);
    this.collector = createEvidenceCollector(db, cwd);
    this.config = config;

    // Register verification strategies in priority order
    this.strategies = [
      new FileVerificationStrategy(),
      new CommandVerificationStrategy(),
      new CodeVerificationStrategy(),
      new CompletionVerificationStrategy(),
    ];
  }

  /**
   * Verify a single claim
   *
   * Process:
   * 1. Collect evidence from all sources
   * 2. Store evidence in database
   * 3. Select appropriate verification strategy
   * 4. Run verification
   * 5. Store and return result
   */
  async verify(claim: Claim): Promise<FullVerificationResult> {
    // Step 1: Collect evidence from multiple sources
    const collectionResult = await this.collector.collectForClaim(claim);
    const evidence = collectionResult.evidence;

    // Step 2: Store evidence
    for (const e of evidence) {
      await this.stores.evidence.create(
        e.claim_id,
        e.source,
        e.source_ref,
        e.data,
        e.supports_claim,
        e.confidence
      );
    }

    // Step 3-4: Select strategy and verify
    const strategy = this.selectStrategy(claim.claim_type);
    const output = strategy.verify({ claim, evidence });

    // Step 5: Store verification result
    const verification = await this.stores.verifications.create(
      claim.claim_id,
      output.status,
      [...output.supporting_evidence, ...output.contradicting_evidence],
      output.confidence,
      output.details
    );

    return {
      claim,
      verification,
      evidence,
      output,
    };
  }

  /**
   * Verify multiple claims
   */
  async verifyAll(claims: Claim[]): Promise<FullVerificationResult[]> {
    const results: FullVerificationResult[] = [];

    for (const claim of claims) {
      const result = await this.verify(claim);
      results.push(result);
    }

    return results;
  }

  /**
   * Verify all unverified claims in a session
   */
  async verifySession(sessionId: string): Promise<FullVerificationResult[]> {
    const unverifiedClaims = await this.stores.claims.getUnverified(sessionId);
    return this.verifyAll(unverifiedClaims);
  }

  /**
   * Get full details about a claim including verification and evidence
   */
  async describe(claimId: string): Promise<{
    claim: Claim | null;
    verification: Verification | null;
    evidence: Evidence[];
  }> {
    const claim = await this.stores.claims.getById(claimId);
    if (!claim) {
      return { claim: null, verification: null, evidence: [] };
    }

    const verification = await this.stores.verifications.getByClaimId(claimId);
    const evidence = await this.stores.evidence.getByClaimId(claimId);

    return { claim, verification, evidence };
  }

  /**
   * Search claims by text query
   */
  async search(
    sessionId: string,
    query: string
  ): Promise<Array<{ claim: Claim; verification: Verification | null }>> {
    const claims = await this.stores.claims.search(sessionId, query);

    const results: Array<{ claim: Claim; verification: Verification | null }> = [];

    for (const claim of claims) {
      const verification = await this.stores.verifications.getByClaimId(claim.claim_id);
      results.push({ claim, verification });
    }

    return results;
  }

  /**
   * Get all contradicted claims for a session
   * These are claims that were proven false
   */
  async getContradictions(sessionId: string): Promise<FullVerificationResult[]> {
    const verifications = await this.stores.verifications.getContradicted(sessionId);
    const results: FullVerificationResult[] = [];

    for (const verification of verifications) {
      const claim = await this.stores.claims.getById(verification.claim_id);
      if (!claim) continue;

      const evidence = await this.stores.evidence.getByClaimId(verification.claim_id);

      results.push({
        claim,
        verification,
        evidence,
        output: {
          status: verification.status,
          confidence: verification.confidence,
          details: verification.details,
          supporting_evidence: [],
          contradicting_evidence: verification.evidence_ids,
        },
      });
    }

    return results;
  }

  /**
   * Re-verify a claim (clears old evidence and verifies again)
   */
  async reverify(claimId: string): Promise<FullVerificationResult | null> {
    const claim = await this.stores.claims.getById(claimId);
    if (!claim) return null;

    // Clear old evidence
    await this.stores.evidence.deleteByClaimId(claimId);

    return this.verify(claim);
  }

  /**
   * Get verification statistics for a session
   */
  async getStats(sessionId: string): Promise<{
    total_claims: number;
    verified: number;
    contradicted: number;
    unverified: number;
    insufficient_evidence: number;
    verification_rate: number;
    accuracy_rate: number;
  }> {
    const claimStats = await this.stores.claims.getStats(sessionId);
    const verificationStats = await this.stores.verifications.getStats(sessionId);

    const verified = verificationStats.by_status.verified ?? 0;
    const contradicted = verificationStats.by_status.contradicted ?? 0;
    const unverified = verificationStats.by_status.unverified ?? 0;
    const insufficient = verificationStats.by_status.insufficient_evidence ?? 0;

    const total = claimStats.total;

    // How many claims have been processed
    const verificationRate = total > 0 ? (verified + contradicted) / total : 0;

    // Of processed claims, how many were verified (not contradicted)
    const accuracyRate = verified + contradicted > 0 ? verified / (verified + contradicted) : 1;

    return {
      total_claims: total,
      verified,
      contradicted,
      unverified,
      insufficient_evidence: insufficient,
      verification_rate: verificationRate,
      accuracy_rate: accuracyRate,
    };
  }

  /**
   * Select the appropriate verification strategy for a claim type
   * Falls back to a generic evidence-weighting strategy if no specific strategy matches
   */
  private selectStrategy(claimType: string): VerificationStrategy {
    // Check registered strategies in order
    for (const strategy of this.strategies) {
      if (strategy.handles(claimType)) {
        return strategy;
      }
    }

    // Default: generic evidence weighting strategy
    return {
      verify: (input: VerificationInput): VerificationOutput => {
        const supporting = input.evidence.filter((e) => e.supports_claim);
        const contradicting = input.evidence.filter((e) => !e.supports_claim);

        // No evidence at all
        if (supporting.length === 0 && contradicting.length === 0) {
          return {
            status: "insufficient_evidence",
            confidence: 0.2,
            details: "No evidence available for this claim type",
            supporting_evidence: [],
            contradicting_evidence: [],
          };
        }

        // Weight evidence by confidence
        const supportWeight = supporting.reduce((s, e) => s + e.confidence, 0);
        const contradictWeight = contradicting.reduce((s, e) => s + e.confidence, 0);

        // Determine status based on evidence weights
        let status: VerificationStatus;
        if (contradictWeight > supportWeight) {
          status = "contradicted";
        } else if (supportWeight > 0.5) {
          status = "verified";
        } else {
          status = "unverified";
        }

        return {
          status,
          confidence: Math.max(supportWeight, contradictWeight) / (supportWeight + contradictWeight + 0.1),
          details: `Generic verification: ${supporting.length} supporting, ${contradicting.length} contradicting`,
          supporting_evidence: supporting.map((e) => e.evidence_id),
          contradicting_evidence: contradicting.map((e) => e.evidence_id),
        };
      },
      handles: () => true,
    };
  }
}

/**
 * Factory function to create a ClaimVerifier
 */
export function createClaimVerifier(
  db: Database,
  config: ClawMemoryConfig,
  cwd?: string
): ClaimVerifier {
  return new ClaimVerifier(db, config, cwd);
}
