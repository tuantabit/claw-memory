/**
 * Veridic-Claw Core Types
 * Following lossless-claw pattern: types.ts defines all interfaces
 */

// Re-export VeridicConfig from config for convenience
export type { VeridicConfig } from "./config.js";

// ==================== Claim Types ====================

/**
 * Types of claims an agent can make
 */
export type ClaimType =
  | "file_created"
  | "file_modified"
  | "file_deleted"
  | "code_added"
  | "code_removed"
  | "code_fixed"
  | "command_executed"
  | "test_passed"
  | "test_failed"
  | "error_fixed"
  | "dependency_added"
  | "config_changed"
  | "task_completed"
  | "unknown";

/**
 * Verification status
 */
export type VerificationStatus =
  | "verified"
  | "unverified"
  | "contradicted"
  | "insufficient_evidence";

/**
 * Evidence source types
 */
export type EvidenceSource =
  | "file_receipt"
  | "command_receipt"
  | "filesystem"
  | "git_diff"
  | "tool_call"
  | "code_content";

/**
 * Entity extracted from claim
 */
export interface ClaimEntity {
  type: "file" | "function" | "class" | "component" | "command" | "package" | "test" | "error";
  value: string;
  normalized?: string;
}

/**
 * A claim extracted from AI response
 */
export interface Claim {
  claim_id: string;
  session_id: string;
  task_id: string | null;
  response_id: string | null;
  claim_type: ClaimType;
  original_text: string;
  entities: ClaimEntity[];
  confidence: number;
  created_at: Date;
}

/**
 * Evidence supporting or contradicting a claim
 */
export interface Evidence {
  evidence_id: string;
  claim_id: string;
  source: EvidenceSource;
  source_ref: string;
  data: Record<string, unknown>;
  supports_claim: boolean;
  confidence: number;
  collected_at: Date;
}

/**
 * Result of claim verification
 */
export interface Verification {
  verification_id: string;
  claim_id: string;
  status: VerificationStatus;
  evidence_ids: string[];
  confidence: number;
  details: string;
  verified_at: Date;
}

/**
 * Trust score for a session
 */
export interface TrustScore {
  score_id: string;
  session_id: string;
  overall_score: number;
  category_scores: Record<string, number>;
  total_claims: number;
  verified_claims: number;
  contradicted_claims: number;
  unverified_claims: number;
  calculated_at: Date;
}

// ==================== Engine Types ====================

/**
 * Trust context injected into agent
 */
export interface TrustContext {
  session_id: string;
  current_score: number;
  recent_issues: TrustIssue[];
  warning_message?: string;
}

/**
 * A trust issue detected
 */
export interface TrustIssue {
  claim_id: string;
  claim_type: ClaimType;
  claim_text: string;
  status: VerificationStatus;
  severity: "low" | "medium" | "high" | "critical";
  details: string;
}

/**
 * Full trust report for a session
 */
export interface TrustReport {
  session_id: string;
  generated_at: Date;
  summary: {
    overall_score: number;
    total_claims: number;
    verified: number;
    contradicted: number;
    unverified: number;
    accuracy_rate: number;
  };
  category_breakdown: Record<ClaimType, {
    total: number;
    verified: number;
    contradicted: number;
  }>;
  issues: TrustIssue[];
  recommendations: string[];
}

// ==================== Extraction Types ====================

/**
 * Pattern for claim detection
 */
export interface ClaimPattern {
  pattern: RegExp;
  type: ClaimType;
  confidence: number;
  entityGroups?: { index: number; type: ClaimEntity["type"] }[];
}

/**
 * Result of claim extraction
 */
export interface ExtractionResult {
  claims: Claim[];
  text_length: number;
  processing_time_ms: number;
  method: "regex" | "llm" | "hybrid";
}

// ==================== Verification Strategy Types ====================

/**
 * Input for verification strategy
 */
export interface VerificationInput {
  claim: Claim;
  evidence: Evidence[];
}

/**
 * Output from verification strategy
 */
export interface VerificationOutput {
  status: VerificationStatus;
  confidence: number;
  details: string;
  supporting_evidence: string[];
  contradicting_evidence: string[];
}

// ==================== Dependencies (like LcmDependencies) ====================

/**
 * LLM API interface (from OpenClaw context)
 */
export interface LLMApi {
  complete: (params: {
    model?: string;
    maxTokens?: number;
    system?: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }) => Promise<{ content: string }>;
}

/**
 * Dependencies injected from OpenClaw (like LcmDependencies)
 */
export interface VeridicDependencies {
  /** LLM API for extraction/verification */
  llmApi?: LLMApi;
  /** Database instance */
  db: import("./core/database.js").Database;
  /** Get current session ID */
  getSessionId: () => string | null;
  /** Get current task ID */
  getTaskId: () => string | null;
  /** Log function */
  log: (level: "debug" | "info" | "warn" | "error", message: string, data?: unknown) => void;
}

// ==================== Store Types ====================

/**
 * Query options for stores
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: "asc" | "desc";
}

/**
 * Filter for claims
 */
export interface ClaimFilter {
  session_id?: string;
  task_id?: string;
  claim_type?: ClaimType;
  verified?: boolean;
  min_confidence?: number;
}

/**
 * Filter for verifications
 */
export interface VerificationFilter {
  claim_id?: string;
  status?: VerificationStatus;
  min_confidence?: number;
}

// ==================== Receipt Types (from ClawMemory) ====================

/**
 * File receipt - tracks file changes
 */
export interface FileReceipt {
  receipt_id: string;
  action_id: string;
  file_path: string;
  before_hash: string;
  after_hash: string;
  created_at: Date;
}

/**
 * Command receipt - tracks command execution
 */
export interface CommandReceipt {
  receipt_id: string;
  action_id: string;
  command: string;
  exit_code: number | null;
  stdout_summary: string | null;
  duration_ms: number | null;
  created_at: Date;
}

/**
 * Action - tracks tool calls
 */
export interface Action {
  action_id: string;
  session_id: string;
  task_id: string | null;
  tool_name: string;
  tool_input: Record<string, unknown> | null;
  tool_result: Record<string, unknown> | null;
  created_at: Date;
}
