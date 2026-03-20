/**
 * Types for Auto Retry System
 *
 * Handles automatic retry when agent claims are contradicted.
 * Max 2 retries, then warn user if unsuccessful.
 */

import type { ClaimType, Verification, Claim } from "../types.js";

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Enable auto-retry on contradiction */
  enabled: boolean;

  /** Maximum retry attempts (default: 2) */
  maxRetries: number;

  /** Claim types that can trigger retry */
  retryableClaimTypes: ClaimType[];

  /** Minimum contradiction confidence to trigger retry (0.0-1.0) */
  minContradictionConfidence: number;

  /** Notify user when retry fails */
  notifyUser: boolean;

  /** Show retry progress to user */
  showProgress: boolean;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  enabled: true,
  maxRetries: 2,
  retryableClaimTypes: [
    "file_created",
    "file_modified",
    "file_deleted",
    "code_added",
    "code_removed",
    "code_fixed",
    "command_executed",
    "test_passed",
    "test_failed",
    "error_fixed",
    "dependency_added",
    "config_changed",
    "task_completed",
  ],
  minContradictionConfidence: 0.7,
  notifyUser: true,
  showProgress: true,
};

/**
 * Status of a retry attempt
 */
export type RetryStatus =
  | "pending"
  | "retrying"
  | "verified"
  | "contradicted"
  | "max_retries_exceeded"
  | "skipped";

/**
 * A single retry attempt record
 */
export interface RetryAttempt {
  attemptNumber: number;
  claimId: string;
  claimType: ClaimType;
  claimText: string;
  retryPrompt: string;
  agentResponse?: string;
  verificationResult?: Verification;
  status: RetryStatus;
  startedAt: Date;
  completedAt?: Date;
}

/**
 * Result of the retry process
 */
export interface RetryResult {
  /** Whether retry ultimately succeeded (claim verified) */
  success: boolean;

  /** Number of retry attempts made */
  retriesAttempted: number;

  /** Final status after all retries */
  finalStatus: RetryStatus;

  /** User notification message (if any) */
  userNotification?: string;

  /** All retry attempts */
  attempts: RetryAttempt[];

  /** Original claim that triggered retry */
  originalClaim: Claim;

  /** Final verification result */
  finalVerification?: Verification;

  /** Total time spent retrying (ms) */
  totalDurationMs: number;
}

/**
 * Contradiction that can trigger retry
 */
export interface Contradiction {
  claim: Claim;
  verification: Verification;
  confidence: number;
  reason: string;
}

/**
 * Callback for retry progress updates
 */
export type RetryProgressCallback = (
  status: RetryStatus,
  attempt: number,
  maxRetries: number,
  message: string
) => void;

/**
 * Context for generating retry prompts
 */
export interface RetryPromptContext {
  claim: Claim;
  verification: Verification;
  attemptNumber: number;
  previousAttempts: RetryAttempt[];
}

/**
 * User notification for retry failure
 */
export interface RetryNotification {
  type: "warning" | "error";
  title: string;
  message: string;
  claim: Claim;
  retriesAttempted: number;
  suggestions: string[];
}
