import type { ClawMemoryEngine } from "../engine.js";

export interface AuditInput {
  session_id?: string;
  detailed?: boolean;
}

export interface AuditOutput {
  success: boolean;
  report: {
    session_id: string;
    total_claims: number;
    verified: number;
    contradicted: number;
    unverified: number;
    accuracy_rate: number;
    issues: Array<{
      claim_id: string;
      claim_type: string;
      claim_text: string;
      status: string;
      details: string;
    }>;
  };
  summary: string;
}

export function createAuditTool(engine: ClawMemoryEngine) {
  return {
    name: "claw-memory_audit",
    description: "Audit session for false claims. Shows verification status and detected contradictions.",
    parameters: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID to audit (defaults to current session)",
        },
        detailed: {
          type: "boolean",
          description: "Include full details for each issue",
        },
      },
    },

    async execute(input: AuditInput): Promise<AuditOutput> {
      try {
        const stores = engine.getStores();
        const sessionId = input.session_id ?? engine.getSession() ?? "";

        if (!sessionId) {
          return {
            success: false,
            report: {
              session_id: "",
              total_claims: 0,
              verified: 0,
              contradicted: 0,
              unverified: 0,
              accuracy_rate: 1,
              issues: [],
            },
            summary: "No session found",
          };
        }

        const claimStats = await stores.claims.getStats(sessionId);
        const verificationStats = await stores.verifications.getStats(sessionId);

        const verified = verificationStats.by_status.verified ?? 0;
        const contradicted = verificationStats.by_status.contradicted ?? 0;
        const unverified = verificationStats.by_status.unverified ?? 0;

        const issues: AuditOutput["report"]["issues"] = [];

        // Get contradicted claims
        const contradictedVerifications = await stores.verifications.getByStatus(
          sessionId,
          "contradicted"
        );

        for (const v of contradictedVerifications) {
          const claim = await stores.claims.getById(v.claim_id);
          if (claim) {
            issues.push({
              claim_id: claim.claim_id,
              claim_type: claim.claim_type,
              claim_text: claim.original_text,
              status: "contradicted",
              details: v.details ?? "Claim was contradicted by evidence",
            });
          }
        }

        const accuracyRate = verified / Math.max(1, verified + contradicted);

        let summary = `Claims: ${claimStats.total} total, `;
        summary += `${verified} verified, `;
        summary += `${contradicted} contradicted. `;
        summary += `Accuracy: ${(accuracyRate * 100).toFixed(0)}%`;

        if (contradicted > 0) {
          summary += `\n\n[WARN] Agent made ${contradicted} false claim(s)!`;
          for (const issue of issues.slice(0, 3)) {
            summary += `\n- ${issue.claim_type}: "${issue.claim_text.slice(0, 50)}..."`;
          }
        }

        return {
          success: true,
          report: {
            session_id: sessionId,
            total_claims: claimStats.total,
            verified,
            contradicted,
            unverified,
            accuracy_rate: accuracyRate,
            issues,
          },
          summary,
        };
      } catch (error) {
        return {
          success: false,
          report: {
            session_id: "",
            total_claims: 0,
            verified: 0,
            contradicted: 0,
            unverified: 0,
            accuracy_rate: 0,
            issues: [],
          },
          summary: `Audit failed: ${error}`,
        };
      }
    },
  };
}
