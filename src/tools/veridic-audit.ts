/**
 * veridic_audit Tool
 * Audit session for false claims (like lcm_describe in lossless-claw)
 */

import type { VeridicEngine } from "../engine.js";
import type { TrustReport, TrustIssue } from "../types.js";

export interface AuditInput {
  /** Session ID to audit (defaults to current) */
  session_id?: string;
  /** Only show issues of this severity or higher */
  min_severity?: "low" | "medium" | "high" | "critical";
  /** Include full details */
  detailed?: boolean;
}

export interface AuditOutput {
  success: boolean;
  report: {
    session_id: string;
    overall_score: number;
    total_claims: number;
    verified: number;
    contradicted: number;
    accuracy_rate: number;
    issues: Array<{
      claim_id: string;
      claim_type: string;
      claim_text: string;
      severity: string;
      details: string;
    }>;
    recommendations: string[];
  };
  summary: string;
}

export function createAuditTool(engine: VeridicEngine) {
  return {
    name: "veridic_audit",
    description: "Audit session for false claims and trust issues. Shows trust score and detected lies.",
    parameters: {
      type: "object",
      properties: {
        session_id: {
          type: "string",
          description: "Session ID to audit (defaults to current session)",
        },
        min_severity: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Only show issues of this severity or higher",
        },
        detailed: {
          type: "boolean",
          description: "Include full details for each issue",
        },
      },
    },

    async execute(input: AuditInput): Promise<AuditOutput> {
      try {
        // Generate report
        const report = await engine.generateReport(input.session_id);

        // Filter issues by severity
        let issues = report.issues;
        if (input.min_severity) {
          const severityOrder = ["low", "medium", "high", "critical"];
          const minIndex = severityOrder.indexOf(input.min_severity);
          issues = issues.filter((i) => severityOrder.indexOf(i.severity) >= minIndex);
        }

        // Build summary
        let summary = `Trust Score: ${report.summary.overall_score.toFixed(0)}/100. `;
        summary += `Claims: ${report.summary.total_claims} total, `;
        summary += `${report.summary.verified} verified, `;
        summary += `${report.summary.contradicted} FALSE. `;

        if (report.summary.contradicted > 0) {
          summary += `\n\nWARNING: Agent made ${report.summary.contradicted} false claims!`;
        }

        if (issues.length > 0) {
          summary += `\n\nTop Issues:\n`;
          for (const issue of issues.slice(0, 3)) {
            summary += `- [${issue.severity.toUpperCase()}] ${issue.claim_type}: "${issue.claim_text.slice(0, 50)}..."\n`;
          }
        }

        return {
          success: true,
          report: {
            session_id: report.session_id,
            overall_score: report.summary.overall_score,
            total_claims: report.summary.total_claims,
            verified: report.summary.verified,
            contradicted: report.summary.contradicted,
            accuracy_rate: report.summary.accuracy_rate,
            issues: issues.map((i) => ({
              claim_id: i.claim_id,
              claim_type: i.claim_type,
              claim_text: i.claim_text,
              severity: i.severity,
              details: i.details,
            })),
            recommendations: report.recommendations,
          },
          summary,
        };
      } catch (error) {
        return {
          success: false,
          report: {
            session_id: "",
            overall_score: 0,
            total_claims: 0,
            verified: 0,
            contradicted: 0,
            accuracy_rate: 0,
            issues: [],
            recommendations: [],
          },
          summary: `Audit failed: ${error}`,
        };
      }
    },
  };
}
