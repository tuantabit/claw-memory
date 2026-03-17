
import type { VeridicEngine } from "../engine.js";

export interface ExpandInput {
  claim_id: string;
  include_evidence?: boolean;
}

export interface ExpandOutput {
  success: boolean;
  claim: {
    claim_id: string;
    claim_type: string;
    original_text: string;
    entities: Array<{ type: string; value: string }>;
    confidence: number;
    created_at: string;
  } | null;
  verification: {
    status: string;
    confidence: number;
    details: string;
    verified_at: string;
  } | null;
  evidence: Array<{
    evidence_id: string;
    source: string;
    supports_claim: boolean;
    confidence: number;
    data: Record<string, unknown>;
  }>;
  summary: string;
}

export function createExpandTool(engine: VeridicEngine) {
  return {
    name: "veridic_expand",
    description: "Get detailed information about a claim and its verification evidence.",
    parameters: {
      type: "object",
      properties: {
        claim_id: {
          type: "string",
          description: "Claim ID to get details for",
        },
        include_evidence: {
          type: "boolean",
          description: "Include raw evidence data in response",
        },
      },
      required: ["claim_id"],
    },

    async execute(input: ExpandInput): Promise<ExpandOutput> {
      try {
        const stores = engine.getStores();

        const claim = await stores.claims.getById(input.claim_id);
        if (!claim) {
          return {
            success: false,
            claim: null,
            verification: null,
            evidence: [],
            summary: `Claim not found: ${input.claim_id}`,
          };
        }

        const verification = await stores.verifications.getByClaimId(input.claim_id);

        const evidence = await stores.evidence.getByClaimId(input.claim_id);

        let summary = `Claim: "${claim.original_text.slice(0, 80)}..."\n`;
        summary += `Type: ${claim.claim_type}\n`;
        summary += `Confidence: ${(claim.confidence * 100).toFixed(0)}%\n`;

        if (verification) {
          summary += `\nVerification: ${verification.status.toUpperCase()}\n`;
          summary += `Details: ${verification.details}\n`;
        } else {
          summary += `\nVerification: NOT YET VERIFIED\n`;
        }

        summary += `\nEvidence: ${evidence.length} pieces\n`;
        const supporting = evidence.filter((e) => e.supports_claim).length;
        const contradicting = evidence.filter((e) => !e.supports_claim).length;
        summary += `  - Supporting: ${supporting}\n`;
        summary += `  - Contradicting: ${contradicting}`;

        return {
          success: true,
          claim: {
            claim_id: claim.claim_id,
            claim_type: claim.claim_type,
            original_text: claim.original_text,
            entities: claim.entities,
            confidence: claim.confidence,
            created_at: claim.created_at.toISOString(),
          },
          verification: verification
            ? {
                status: verification.status,
                confidence: verification.confidence,
                details: verification.details,
                verified_at: verification.verified_at.toISOString(),
              }
            : null,
          evidence: input.include_evidence
            ? evidence.map((e) => ({
                evidence_id: e.evidence_id,
                source: e.source,
                supports_claim: e.supports_claim,
                confidence: e.confidence,
                data: e.data,
              }))
            : evidence.map((e) => ({
                evidence_id: e.evidence_id,
                source: e.source,
                supports_claim: e.supports_claim,
                confidence: e.confidence,
                data: {},
              })),
          summary,
        };
      } catch (error) {
        return {
          success: false,
          claim: null,
          verification: null,
          evidence: [],
          summary: `Expand failed: ${error}`,
        };
      }
    },
  };
}
