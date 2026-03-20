/**
 * @module retry
 * @description Auto-retry system for contradicted claims
 *
 * When a claim is contradicted by evidence, this module:
 * 1. Generates a retry prompt asking the agent to actually perform the action
 * 2. Sends the prompt and waits for agent response
 * 3. Re-verifies the claim
 * 4. Repeats up to maxRetries times (default: 2)
 * 5. Notifies user if all retries fail
 *
 * @example
 * ```typescript
 * import { createRetryManager, generateRetryPrompt } from './retry';
 *
 * const manager = createRetryManager({ maxRetries: 2 });
 *
 * // Handle a contradiction
 * const result = await manager.handleContradiction(
 *   claim,
 *   verification,
 *   async (claim) => { ... } // re-verify callback
 * );
 *
 * if (!result.success) {
 *   console.warn(result.userNotification);
 * }
 * ```
 */

export * from "./types.js";
export * from "./retry-prompt.js";
export * from "./retry-manager.js";
