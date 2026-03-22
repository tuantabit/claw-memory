/**
 * @module retry/types
 * @description Type definitions for the Auto Retry System
 *
 * The retry system handles automatic retry when agent claims are contradicted.
 * It follows this flow:
 *
 * ```
 * Contradiction Detected
 *        ↓
 * Check if retryable (claim type, confidence)
 *        ↓
 * Generate retry prompt
 *        ↓
 * Send to agent → Re-verify → Success?
 *        ↓ No                    ↓ Yes
 * Retry count < max?         Return success
 *        ↓ No
 * Notify user with suggestions
 * ```
 *
 * @example
 * ```typescript
 * import { RetryConfig, DEFAULT_RETRY_CONFIG } from './types';
 *
 * // Custom config with 3 retries
 * const config: RetryConfig = {
 *   ...DEFAULT_RETRY_CONFIG,
 *   maxRetries: 3,
 *   notifyUser: true,
 * };
 * ```
 */

import type { ClaimType, Verification, Claim } from "../types.js";

/**
 * Configuration for retry behavior
 *
 * Controls how the retry system responds to contradicted claims.
 * All fields have sensible defaults via DEFAULT_RETRY_CONFIG.
 *
 * @example
 * ```typescript
 * const config: RetryConfig = {
 *   enabled: true,
 *   maxRetries: 2,
 *   retryableClaimTypes: ['file_created', 'file_modified'],
 *   minContradictionConfidence: 0.7,
 *   notifyUser: true,
 *   showProgress: true,
 * };
 * ```
 */
export interface RetryConfig {
  /**
   * Enable auto-retry on contradiction detection
   * When false, contradictions are logged but not automatically retried
   */
  enabled: boolean;

  /**
   * Maximum number of retry attempts before giving up
   * Default is 2 to balance persistence with efficiency
   */
  maxRetries: number;

  /**
   * Claim types that can trigger automatic retry
   * Claims not in this list will be marked contradicted without retry
   */
  retryableClaimTypes: ClaimType[];

  /**
   * Minimum contradiction confidence to trigger retry (0.0-1.0)
   * Lower values mean more retries, higher values mean only confident contradictions
   */
  minContradictionConfidence: number;

  /**
   * Notify user when all retries fail
   * Generates a user-facing warning with the claim details and suggestions
   */
  notifyUser: boolean;

  /**
   * Show retry progress to user during retry loop
   * Useful for debugging but may be noisy in production
   */
  showProgress: boolean;
}

/**
 * Default retry configuration
 *
 * Provides sensible defaults for most use cases:
 * - 2 retries (total 3 attempts including original)
 * - Most action types are retryable
 * - 70% confidence threshold
 * - User notification enabled
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
 *
 * Tracks the lifecycle of each retry:
 * - pending: Waiting to start
 * - retrying: Currently executing retry
 * - verified: Retry succeeded, claim now verified
 * - contradicted: Retry failed, claim still contradicted
 * - max_retries_exceeded: All retries exhausted
 * - skipped: Retry was skipped (not retryable or low confidence)
 */
export type RetryStatus =
  | "pending"
  | "retrying"
  | "verified"
  | "contradicted"
  | "max_retries_exceeded"
  | "skipped";

/**
 * Record of a single retry attempt
 *
 * Captures all details of one retry iteration for debugging and auditing.
 *
 * @example
 * ```typescript
 * const attempt: RetryAttempt = {
 *   attemptNumber: 1,
 *   claimId: 'claim-123',
 *   claimType: 'file_created',
 *   claimText: 'I created src/app.ts',
 *   retryPrompt: 'Please actually create the file...',
 *   status: 'retrying',
 *   startedAt: new Date(),
 * };
 * ```
 */
export interface RetryAttempt {
  /** Which attempt this is (1, 2, etc.) */
  attemptNumber: number;

  /** ID of the claim being retried */
  claimId: string;

  /** Type of the claim */
  claimType: ClaimType;

  /** Original claim text */
  claimText: string;

  /** Prompt sent to agent for retry */
  retryPrompt: string;

  /** Agent's response to retry prompt (if received) */
  agentResponse?: string;

  /** Verification result after retry (if completed) */
  verificationResult?: Verification;

  /** Current status of this attempt */
  status: RetryStatus;

  /** When this attempt started */
  startedAt: Date;

  /** When this attempt completed (if finished) */
  completedAt?: Date;
}

/**
 * Final result of the retry process
 *
 * Summarizes the outcome of all retry attempts for a single claim.
 *
 * @example
 * ```typescript
 * const result: RetryResult = {
 *   success: true,
 *   retriesAttempted: 1,
 *   finalStatus: 'verified',
 *   attempts: [...],
 *   originalClaim: claim,
 *   totalDurationMs: 5000,
 * };
 * ```
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

  /** All retry attempts in order */
  attempts: RetryAttempt[];

  /** Original claim that triggered retry */
  originalClaim: Claim;

  /** Final verification result */
  finalVerification?: Verification;

  /** Total time spent retrying in milliseconds */
  totalDurationMs: number;
}

/**
 * Contradiction that can trigger retry
 *
 * Represents a detected contradiction between agent claim and evidence.
 */
export interface Contradiction {
  /** The contradicted claim */
  claim: Claim;

  /** Verification result showing contradiction */
  verification: Verification;

  /** Confidence level of the contradiction (0.0-1.0) */
  confidence: number;

  /** Human-readable reason for contradiction */
  reason: string;
}

/**
 * Callback for retry progress updates
 *
 * Called during retry loop to update UI or logs.
 *
 * @param status - Current retry status
 * @param attempt - Current attempt number
 * @param maxRetries - Maximum attempts allowed
 * @param message - Human-readable progress message
 */
export type RetryProgressCallback = (
  status: RetryStatus,
  attempt: number,
  maxRetries: number,
  message: string
) => void;

/**
 * Context for generating retry prompts
 *
 * Contains all information needed to generate an effective retry prompt.
 */
export interface RetryPromptContext {
  /** The claim to retry */
  claim: Claim;

  /** Verification that detected the contradiction */
  verification: Verification;

  /** Which attempt this will be (1-based) */
  attemptNumber: number;

  /** Previous retry attempts for context */
  previousAttempts: RetryAttempt[];
}

/**
 * User notification for retry failure
 *
 * Displayed to user when all retries fail, with actionable suggestions.
 */
export interface RetryNotification {
  /** Severity: warning or error */
  type: "warning" | "error";

  /** Short title for the notification */
  title: string;

  /** Detailed message explaining the failure */
  message: string;

  /** The claim that failed verification */
  claim: Claim;

  /** How many retries were attempted */
  retriesAttempted: number;

  /** Actionable suggestions for the user */
  suggestions: string[];
}
