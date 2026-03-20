/**
 * Retry Prompt Generator
 *
 * Creates prompts to request agent to redo contradicted actions.
 * Prompts are designed to be clear and actionable.
 */

import type { ClaimType, Claim, Verification } from "../types.js";
import type { RetryPromptContext, RetryAttempt } from "./types.js";

/**
 * Templates for retry prompts based on claim type
 */
const RETRY_TEMPLATES: Record<ClaimType, string> = {
  file_created: `You claimed to have created the file "{entity}", but verification found no evidence of this file existing.

Please actually create the file now. Make sure to use the appropriate tool to write the file.`,

  file_modified: `You claimed to have modified the file "{entity}", but verification found no changes to this file.

Please actually make the intended modifications to the file now.`,

  file_deleted: `You claimed to have deleted the file "{entity}", but verification found the file still exists.

Please actually delete the file now using the appropriate tool.`,

  code_added: `You claimed to have added code "{entity}", but verification could not find this code in any file.

Please actually add the code now. Make sure to write it to the appropriate file.`,

  code_removed: `You claimed to have removed code "{entity}", but verification found the code still exists.

Please actually remove the code now.`,

  code_fixed: `You claimed to have fixed "{entity}", but verification could not confirm the fix was applied.

Please actually apply the fix now.`,

  command_executed: `You claimed to have executed the command "{entity}", but there is no evidence this command was actually run.

Please actually execute the command now using the shell/bash tool.`,

  test_passed: `You claimed that tests passed for "{entity}", but verification found no evidence of test execution.

Please actually run the tests now and report the real results.`,

  test_failed: `You claimed that tests failed for "{entity}", but verification found no evidence of test execution.

Please actually run the tests and report the real results.`,

  error_fixed: `You claimed to have fixed the error "{entity}", but verification could not confirm the fix.

Please actually fix the error now.`,

  dependency_added: `You claimed to have added the dependency "{entity}", but verification found it was not added.

Please actually add the dependency using the appropriate package manager.`,

  config_changed: `You claimed to have changed the configuration "{entity}", but verification found no changes.

Please actually make the configuration change now.`,

  task_completed: `You claimed to have completed the task "{entity}", but verification could not confirm completion.

Please actually complete the task now.`,

  unknown: `Your previous claim could not be verified. Please redo the action and ensure it is actually performed.`,
};

/**
 * Generate a retry prompt for a contradicted claim
 *
 * @param context - Context for generating the prompt
 * @returns The retry prompt string
 */
export function generateRetryPrompt(context: RetryPromptContext): string {
  const { claim, verification, attemptNumber, previousAttempts } = context;

  // Get the template for this claim type
  const template = RETRY_TEMPLATES[claim.claim_type] || RETRY_TEMPLATES.unknown;

  // Extract main entity from claim
  const entity = claim.entities[0]?.value || "the item";

  // Fill in the template
  let prompt = template.replace("{entity}", entity);

  // Add attempt context
  const header = `[Verification System - Retry Attempt ${attemptNumber}]

`;

  // Add details about why verification failed
  const failureReason = `Verification Result: ${verification.status.toUpperCase()}
Confidence: ${(verification.confidence * 100).toFixed(0)}%
Details: ${verification.details || "No additional details"}

`;

  // Add previous attempt context if this is not the first retry
  let previousContext = "";
  if (previousAttempts.length > 0) {
    previousContext = `Previous Attempts: ${previousAttempts.length} (all unsuccessful)
`;
  }

  // Add instruction
  const instruction = `

Important: You must actually perform the action, not just describe it. Use the appropriate tools to complete the task.`;

  return header + failureReason + previousContext + prompt + instruction;
}

/**
 * Generate a user notification message for retry failure
 *
 * @param claim - The claim that failed verification
 * @param retriesAttempted - Number of retry attempts made
 * @returns User-friendly notification message
 */
export function generateUserNotification(
  claim: Claim,
  retriesAttempted: number
): string {
  const entity = claim.entities[0]?.value || "action";
  const claimTypeReadable = claim.claim_type.replace(/_/g, " ");

  return `Verification Warning: The agent claimed to have performed "${claimTypeReadable}" for "${entity}", but this could not be verified after ${retriesAttempted} retry attempt(s).

Original claim: "${claim.original_text}"

Suggestions:
- Review the agent's output manually
- Check if the file/action exists
- Consider running the command manually
- Ask the agent to try a different approach`;
}

/**
 * Generate suggestions for how to proceed after retry failure
 *
 * @param claim - The claim that failed
 * @returns Array of suggestion strings
 */
export function generateSuggestions(claim: Claim): string[] {
  const suggestions: string[] = [];

  switch (claim.claim_type) {
    case "file_created":
    case "file_modified":
    case "file_deleted":
      suggestions.push("Check if the file path is correct");
      suggestions.push("Verify file permissions allow the operation");
      suggestions.push("Try using an absolute path instead of relative");
      break;

    case "command_executed":
    case "test_passed":
    case "test_failed":
      suggestions.push("Check if the command exists and is installed");
      suggestions.push("Verify the working directory is correct");
      suggestions.push("Try running the command manually to see errors");
      break;

    case "dependency_added":
      suggestions.push("Check if package manager is configured correctly");
      suggestions.push("Verify network connectivity for package downloads");
      suggestions.push("Try specifying the exact version");
      break;

    default:
      suggestions.push("Review the agent's output for errors");
      suggestions.push("Try a different approach to achieve the goal");
      suggestions.push("Break down the task into smaller steps");
  }

  return suggestions;
}

/**
 * Format a contradiction for logging
 *
 * @param claim - The contradicted claim
 * @param verification - The verification result
 * @returns Formatted string for logging
 */
export function formatContradiction(
  claim: Claim,
  verification: Verification
): string {
  const entity = claim.entities[0]?.value || "unknown";
  return `[CONTRADICTION] ${claim.claim_type}: "${entity}"
  Claim: "${claim.original_text.slice(0, 100)}..."
  Status: ${verification.status}
  Confidence: ${(verification.confidence * 100).toFixed(0)}%
  Details: ${verification.details || "None"}`;
}
