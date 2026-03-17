
export type { VeridicConfig } from "./config.js";


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

export type VerificationStatus =
  | "verified"
  | "unverified"
  | "contradicted"
  | "insufficient_evidence";

export type EvidenceSource =
  | "file_receipt"
  | "command_receipt"
  | "filesystem"
  | "git_diff"
  | "tool_call"
  | "code_content";

export interface ClaimEntity {
  type: "file" | "function" | "class" | "component" | "command" | "package" | "test" | "error";
  value: string;
  normalized?: string;
}

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

export interface Verification {
  verification_id: string;
  claim_id: string;
  status: VerificationStatus;
  evidence_ids: string[];
  confidence: number;
  details: string;
  verified_at: Date;
}

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


export interface TrustContext {
  session_id: string;
  current_score: number;
  recent_issues: TrustIssue[];
  warning_message?: string;
}

export interface TrustIssue {
  claim_id: string;
  claim_type: ClaimType;
  claim_text: string;
  status: VerificationStatus;
  severity: "low" | "medium" | "high" | "critical";
  details: string;
}

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


export interface ClaimPattern {
  pattern: RegExp;
  type: ClaimType;
  confidence: number;
  entityGroups?: { index: number; type: ClaimEntity["type"] }[];
}

export interface ExtractionResult {
  claims: Claim[];
  text_length: number;
  processing_time_ms: number;
  method: "regex" | "llm" | "hybrid";
}


export interface VerificationInput {
  claim: Claim;
  evidence: Evidence[];
}

export interface VerificationOutput {
  status: VerificationStatus;
  confidence: number;
  details: string;
  supporting_evidence: string[];
  contradicting_evidence: string[];
}


export interface LLMApi {
  complete: (params: {
    model?: string;
    maxTokens?: number;
    system?: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }) => Promise<{ content: string }>;
}

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


export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: string;
  orderDir?: "asc" | "desc";
}

export interface ClaimFilter {
  session_id?: string;
  task_id?: string;
  claim_type?: ClaimType;
  verified?: boolean;
  min_confidence?: number;
}

export interface VerificationFilter {
  claim_id?: string;
  status?: VerificationStatus;
  min_confidence?: number;
}


export interface FileReceipt {
  receipt_id: string;
  action_id: string;
  file_path: string;
  before_hash: string;
  after_hash: string;
  created_at: Date;
}

export interface CommandReceipt {
  receipt_id: string;
  action_id: string;
  command: string;
  exit_code: number | null;
  stdout_summary: string | null;
  duration_ms: number | null;
  created_at: Date;
}

export interface Action {
  action_id: string;
  session_id: string;
  task_id: string | null;
  tool_name: string;
  tool_input: Record<string, unknown> | null;
  tool_result: Record<string, unknown> | null;
  created_at: Date;
}
