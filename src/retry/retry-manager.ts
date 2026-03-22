/**
 * RetryManager - Handles automatic retry on contradiction detection
 *
 * When a claim is contradicted:
 * 1. Generate retry prompt asking agent to actually perform the action
 * 2. Send prompt to agent (via callback)
 * 3. Re-verify the claim
 * 4. Repeat up to maxRetries times
 * 5. Notify user if all retries fail
 */

import type { Claim, Verification, LLMApi, VerificationStatus } from "../types.js";
import type {
  RetryConfig,
  RetryResult,
  RetryAttempt,
  Contradiction,
  RetryProgressCallback,
  RetryNotification,
} from "./types.js";
import { DEFAULT_RETRY_CONFIG } from "./types.js";
import {
  generateRetryPrompt,
  generateUserNotification,
  generateSuggestions,
  formatContradiction,
} from "./retry-prompt.js";

/**
 * Callback type for executing retry
 * This is called by the retry manager to request the agent to retry
 */
export type RetryExecutor = (
  retryPrompt: string,
  claim: Claim
) => Promise<{ response: string; verified: boolean }>;

/**
 * Callback type for notifying user
 */
export type UserNotifier = (notification: RetryNotification) => void;

/**
 * RetryManager handles the retry loop for contradicted claims
 */
export class RetryManager {
  private config: RetryConfig;
  private retryExecutor: RetryExecutor | null = null;
  private userNotifier: UserNotifier | null = null;
  private progressCallback: RetryProgressCallback | null = null;

  constructor(config?: Partial<RetryConfig>) {
    this.config = { ...DEFAULT_RETRY_CONFIG, ...config };
  }

  /**
   * Set the retry executor callback
   * This callback is responsible for sending the retry prompt to the agent
   */
  setRetryExecutor(executor: RetryExecutor): void {
    this.retryExecutor = executor;
  }

  /**
   * Set the user notifier callback
   * This callback is called when retry fails and user needs to be notified
   */
  setUserNotifier(notifier: UserNotifier): void {
    this.userNotifier = notifier;
  }

  /**
   * Set progress callback for UI updates
   */
  setProgressCallback(callback: RetryProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Check if a claim type is retryable
   */
  isRetryable(claimType: string): boolean {
    return this.config.retryableClaimTypes.includes(claimType as Claim["claim_type"]);
  }

  /**
   * Check if a contradiction should trigger retry
   */
  shouldRetry(contradiction: Contradiction): boolean {
    if (!this.config.enabled) {
      return false;
    }

    if (!this.isRetryable(contradiction.claim.claim_type)) {
      return false;
    }

    if (contradiction.confidence < this.config.minContradictionConfidence) {
      return false;
    }

    return true;
  }

  /**
   * Handle a single contradicted claim with retry logic
   *
   * @param claim - The contradicted claim
   * @param verification - The verification result showing contradiction
   * @param verifyCallback - Callback to re-verify after retry
   * @returns RetryResult with final status
   */
  async handleContradiction(
    claim: Claim,
    verification: Verification,
    verifyCallback: (claim: Claim) => Promise<Verification>
  ): Promise<RetryResult> {
    const startTime = Date.now();
    const attempts: RetryAttempt[] = [];

    // Check if we should retry
    const contradiction: Contradiction = {
      claim,
      verification,
      confidence: verification.confidence,
      reason: verification.details,
    };

    if (!this.shouldRetry(contradiction)) {
      return {
        success: false,
        retriesAttempted: 0,
        finalStatus: "skipped",
        originalClaim: claim,
        attempts: [],
        totalDurationMs: Date.now() - startTime,
      };
    }

    // No retry executor set - can't perform retry
    if (!this.retryExecutor) {
      this.notifyProgress("skipped", 0, this.config.maxRetries, "No retry executor configured");
      return {
        success: false,
        retriesAttempted: 0,
        finalStatus: "skipped",
        userNotification: "Retry not available - no executor configured",
        originalClaim: claim,
        attempts: [],
        totalDurationMs: Date.now() - startTime,
      };
    }

    let currentVerification = verification;
    let attemptNumber = 0;

    // Retry loop
    while (attemptNumber < this.config.maxRetries) {
      attemptNumber++;

      const attempt: RetryAttempt = {
        attemptNumber,
        claimId: claim.claim_id,
        claimType: claim.claim_type,
        claimText: claim.original_text,
        retryPrompt: "",
        status: "retrying",
        startedAt: new Date(),
      };

      // Generate retry prompt
      const retryPrompt = generateRetryPrompt({
        claim,
        verification: currentVerification,
        attemptNumber,
        previousAttempts: attempts,
      });

      attempt.retryPrompt = retryPrompt;

      // Notify progress
      this.notifyProgress(
        "retrying",
        attemptNumber,
        this.config.maxRetries,
        `Retry attempt ${attemptNumber}/${this.config.maxRetries} for ${claim.claim_type}`
      );

      try {
        // Execute retry
        const retryResult = await this.retryExecutor(retryPrompt, claim);
        attempt.agentResponse = retryResult.response;

        // Re-verify
        currentVerification = await verifyCallback(claim);
        attempt.verificationResult = currentVerification;
        attempt.completedAt = new Date();

        // Check if verified
        if (currentVerification.status === "verified") {
          attempt.status = "verified";
          attempts.push(attempt);

          this.notifyProgress(
            "verified",
            attemptNumber,
            this.config.maxRetries,
            `Claim verified after ${attemptNumber} retry attempt(s)`
          );

          return {
            success: true,
            retriesAttempted: attemptNumber,
            finalStatus: "verified",
            originalClaim: claim,
            finalVerification: currentVerification,
            attempts,
            totalDurationMs: Date.now() - startTime,
          };
        }

        // Still contradicted
        attempt.status = "contradicted";
        attempts.push(attempt);
      } catch (error) {
        attempt.status = "contradicted";
        attempt.completedAt = new Date();
        attempts.push(attempt);
        console.error("[claw-memory] Retry attempt failed:", error);
      }
    }

    // All retries exhausted
    this.notifyProgress(
      "max_retries_exceeded",
      attemptNumber,
      this.config.maxRetries,
      `Max retries exceeded for ${claim.claim_type}`
    );

    // Notify user if configured
    const userNotification = this.notifyUser(claim, attemptNumber);

    return {
      success: false,
      retriesAttempted: attemptNumber,
      finalStatus: "max_retries_exceeded",
      userNotification,
      originalClaim: claim,
      finalVerification: currentVerification,
      attempts,
      totalDurationMs: Date.now() - startTime,
    };
  }

  /**
   * Handle multiple contradictions
   *
   * @param contradictions - Array of contradicted claims with verifications
   * @param verifyCallback - Callback to re-verify claims
   * @returns Array of retry results
   */
  async handleContradictions(
    contradictions: Array<{ claim: Claim; verification: Verification }>,
    verifyCallback: (claim: Claim) => Promise<Verification>
  ): Promise<RetryResult[]> {
    const results: RetryResult[] = [];

    for (const { claim, verification } of contradictions) {
      const result = await this.handleContradiction(claim, verification, verifyCallback);
      results.push(result);
    }

    return results;
  }

  /**
   * Notify progress callback
   */
  private notifyProgress(
    status: RetryAttempt["status"],
    attempt: number,
    maxRetries: number,
    message: string
  ): void {
    if (this.progressCallback) {
      this.progressCallback(status, attempt, maxRetries, message);
    }

    if (this.config.showProgress) {
      console.log(`[claw-memory] [retry] ${message}`);
    }
  }

  /**
   * Notify user about retry failure
   */
  private notifyUser(claim: Claim, retriesAttempted: number): string {
    const notification: RetryNotification = {
      type: "warning",
      title: "Verification Failed",
      message: generateUserNotification(claim, retriesAttempted),
      claim,
      retriesAttempted,
      suggestions: generateSuggestions(claim),
    };

    if (this.config.notifyUser && this.userNotifier) {
      this.userNotifier(notification);
    }

    console.warn(`[claw-memory] ${notification.message}`);

    return notification.message;
  }

  /**
   * Get current configuration
   */
  getConfig(): RetryConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<RetryConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Factory function to create a RetryManager
 */
export function createRetryManager(config?: Partial<RetryConfig>): RetryManager {
  return new RetryManager(config);
}
