
import type { VeridicEngine } from "../engine.js";

export interface VerifyInput {
  claim_id?: string;
  query?: string;
  all?: boolean;
}

export interface VerifyOutput {
  success: boolean;
  verified_count: number;
  results: Array<{
    claim_id: string;
    claim_type: string;
    claim_text: string;
    status: string;
    confidence: number;
    details: string;
  }>;
  summary: string;
}

export function createVerifyTool(engine: VeridicEngine) {
  return {
    name: "veridic_verify",
    description: "Verify agent claims against evidence. Use to check if agent actually did what it claimed.",
    parameters: {
      type: "object",
      properties: {
        claim_id: {
          type: "string",
          description: "Specific claim ID to verify",
        },
        query: {
          type: "string",
          description: "Search query to find and verify claims (e.g., 'file', 'test')",
        },
        all: {
          type: "boolean",
          description: "Verify all unverified claims in current session",
        },
      },
    },

    async execute(input: VerifyInput): Promise<VerifyOutput> {
      const results: VerifyOutput["results"] = [];

      try {
        if (input.claim_id) {
          const result = await engine.verifyClaim(input.claim_id);
          if (result) {
            results.push({
              claim_id: result.claim.claim_id,
              claim_type: result.claim.claim_type,
              claim_text: result.claim.original_text,
              status: result.verification.status,
              confidence: result.verification.confidence,
              details: result.verification.details,
            });
          }
        }

        if (input.query) {
          const searchResults = await engine.searchClaims(input.query);
          for (const { claim } of searchResults) {
            const result = await engine.verifyClaim(claim.claim_id);
            if (result) {
              results.push({
                claim_id: result.claim.claim_id,
                claim_type: result.claim.claim_type,
                claim_text: result.claim.original_text,
                status: result.verification.status,
                confidence: result.verification.confidence,
                details: result.verification.details,
              });
            }
          }
        }

        if (input.all) {
          const stores = engine.getStores();
          const context = await engine.getTrustContext();
          const unverified = await stores.claims.getUnverified(context.session_id);

          for (const claim of unverified) {
            const result = await engine.verifyClaim(claim.claim_id);
            if (result) {
              results.push({
                claim_id: result.claim.claim_id,
                claim_type: result.claim.claim_type,
                claim_text: result.claim.original_text,
                status: result.verification.status,
                confidence: result.verification.confidence,
                details: result.verification.details,
              });
            }
          }
        }

        const verified = results.filter((r) => r.status === "verified").length;
        const contradicted = results.filter((r) => r.status === "contradicted").length;
        const unverified = results.filter((r) => r.status === "unverified").length;

        let summary = `Verified ${results.length} claims: `;
        summary += `${verified} verified, ${contradicted} contradicted, ${unverified} unverified.`;

        if (contradicted > 0) {
          summary += ` WARNING: ${contradicted} claims were FALSE.`;
        }

        return {
          success: true,
          verified_count: results.length,
          results,
          summary,
        };
      } catch (error) {
        return {
          success: false,
          verified_count: 0,
          results: [],
          summary: `Verification failed: ${error}`,
        };
      }
    },
  };
}
