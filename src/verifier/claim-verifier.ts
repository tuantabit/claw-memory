/**
 * Claim Verifier
 * Main verification engine (like RetrievalEngine in lossless-claw)
 */

import type { Database } from "../core/database.js";
import type {
  Claim,
  Evidence,
  Verification,
  VerificationStatus,
  VerificationInput,
  VerificationOutput,
  VeridicConfig,
} from "../types.js";
import { VeridicStores, createStores } from "../store/index.js";
import { EvidenceCollector, createEvidenceCollector } from "../collector/index.js";
import { FileVerificationStrategy } from "./strategies/file-strategy.js";
import { CommandVerificationStrategy } from "./strategies/command-strategy.js";
import { CodeVerificationStrategy } from "./strategies/code-strategy.js";
import { CompletionVerificationStrategy } from "./strategies/completion-strategy.js";

/**
 * Verification strategy interface
 */
interface VerificationStrategy {
  verify(input: VerificationInput): VerificationOutput;
  handles(claimType: string): boolean;
}

/**
 * Full verification result
 */
export interface FullVerificationResult {
  claim: Claim;
  verification: Verification;
  evidence: Evidence[];
  output: VerificationOutput;
}

export class ClaimVerifier {
  private stores: VeridicStores;
  private collector: EvidenceCollector;
  private strategies: VerificationStrategy[];
  private config: VeridicConfig;

  constructor(db: Database, config: VeridicConfig, cwd?: string) {
    this.stores = createStores(db);
    this.collector = createEvidenceCollector(db, cwd);
    this.config = config;

    // Register strategies
    this.strategies = [
      new FileVerificationStrategy(),
      new CommandVerificationStrategy(),
      new CodeVerificationStrategy(),
      new CompletionVerificationStrategy(),
    ];
  }

  /**
   * Verify a single claim
   * Main entry point (like RetrievalEngine.expand())
   */
  async verify(claim: Claim): Promise<FullVerificationResult> {
    // Step 1: Collect evidence
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

    // Step 3: Select and apply verification strategy
    const strategy = this.selectStrategy(claim.claim_type);
    const output = strategy.verify({ claim, evidence });

    // Step 4: Create and store verification
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
   * Verify unverified claims for a session
   */
  async verifySession(sessionId: string): Promise<FullVerificationResult[]> {
    const unverifiedClaims = await this.stores.claims.getUnverified(sessionId);
    return this.verifyAll(unverifiedClaims);
  }

  /**
   * Get verification for a claim (like RetrievalEngine.describe())
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
   * Search claims (like RetrievalEngine.grep())
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
   * Get contradicted claims for a session
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
   * Re-verify a claim (with fresh evidence)
   */
  async reverify(claimId: string): Promise<FullVerificationResult | null> {
    const claim = await this.stores.claims.getById(claimId);
    if (!claim) return null;

    // Delete old evidence
    await this.stores.evidence.deleteByClaimId(claimId);

    // Re-verify
    return this.verify(claim);
  }

  /**
   * Get verification statistics
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
    const verificationRate = total > 0 ? (verified + contradicted) / total : 0;
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
   * Select appropriate strategy for claim type
   */
  private selectStrategy(claimType: string): VerificationStrategy {
    for (const strategy of this.strategies) {
      if (strategy.handles(claimType)) {
        return strategy;
      }
    }

    // Default strategy
    return {
      verify: (input: VerificationInput): VerificationOutput => {
        const supporting = input.evidence.filter((e) => e.supports_claim);
        const contradicting = input.evidence.filter((e) => !e.supports_claim);

        if (supporting.length === 0 && contradicting.length === 0) {
          return {
            status: "insufficient_evidence",
            confidence: 0.2,
            details: "No evidence available for this claim type",
            supporting_evidence: [],
            contradicting_evidence: [],
          };
        }

        const supportWeight = supporting.reduce((s, e) => s + e.confidence, 0);
        const contradictWeight = contradicting.reduce((s, e) => s + e.confidence, 0);

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
 * Create claim verifier
 */
export function createClaimVerifier(
  db: Database,
  config: VeridicConfig,
  cwd?: string
): ClaimVerifier {
  return new ClaimVerifier(db, config, cwd);
}
