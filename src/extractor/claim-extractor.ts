/**
 * Claim Extractor - Extract claims from agent responses
 *
 * This module handles the extraction of verifiable claims from agent responses.
 * It uses a two-stage approach:
 * 1. Regex-based extraction (fast, pattern matching)
 * 2. LLM-based extraction (fallback when regex confidence is low)
 *
 * Claims are deduplicated and consolidated to avoid duplicate verifications.
 */

import { nanoid } from "nanoid";
import type {
  Claim,
  ClaimType,
  ClaimEntity,
  ExtractionResult,
  ClawMemoryConfig,
} from "../types.js";
import { ALL_PATTERNS, extractEntities } from "./patterns.js";
import { extractClaimsWithLLM } from "./llm-extractor.js";
import type { LLMApi } from "../types.js";

/**
 * Extracts verifiable claims from agent response text
 *
 * @example
 * ```typescript
 * const extractor = new ClaimExtractor(config);
 * const result = await extractor.extract(
 *   "I created src/index.ts and ran npm test",
 *   "session-123",
 *   null,
 *   null
 * );
 * // result.claims = [
 * //   { claim_type: "file_created", original_text: "created src/index.ts", ... },
 * //   { claim_type: "command_executed", original_text: "ran npm test", ... }
 * // ]
 * ```
 */
export class ClaimExtractor {
  private config: ClawMemoryConfig;

  constructor(config: ClawMemoryConfig) {
    this.config = config;
  }

  /**
   * Extract claims from text using regex and optionally LLM
   *
   * Process:
   * 1. Run regex patterns to extract claims
   * 2. If average confidence < threshold AND LLM enabled, use LLM
   * 3. Merge regex and LLM claims (LLM wins on conflicts if higher confidence)
   * 4. Consolidate duplicate claims
   *
   * @param text - The agent response text
   * @param sessionId - Current session ID
   * @param taskId - Current task ID (optional)
   * @param responseId - Response ID for tracking (optional)
   * @param llmApi - LLM API for hybrid extraction (optional)
   */
  async extract(
    text: string,
    sessionId: string,
    taskId: string | null,
    responseId: string | null,
    llmApi?: LLMApi
  ): Promise<ExtractionResult> {
    const startTime = Date.now();

    // Stage 1: Regex extraction
    const regexClaims = this.extractWithRegex(text, sessionId, taskId, responseId);

    let finalClaims = regexClaims;
    let method: "regex" | "llm" | "hybrid" = "regex";

    const avgConfidence = this.calculateAverageConfidence(regexClaims);

    // Stage 2: LLM fallback if confidence is low
    if (
      this.config.enableLLM &&
      llmApi &&
      avgConfidence < this.config.extractionThreshold
    ) {
      try {
        const llmClaims = await extractClaimsWithLLM(
          text,
          sessionId,
          taskId,
          responseId,
          llmApi
        );

        finalClaims = this.mergeClaims(regexClaims, llmClaims);
        method = "hybrid";
      } catch (error) {
        console.error("[claw-memory] LLM extraction failed:", error);
      }
    }

    // Consolidate to remove duplicates
    const consolidatedClaims = this.consolidateClaims(finalClaims);

    return {
      claims: consolidatedClaims,
      text_length: text.length,
      processing_time_ms: Date.now() - startTime,
      method,
    };
  }

  /**
   * Extract claims using regex patterns
   *
   * Iterates through all defined patterns and extracts matching claims.
   * Each pattern has a type, confidence score, and entity extraction rules.
   */
  extractWithRegex(
    text: string,
    sessionId: string,
    taskId: string | null,
    responseId: string | null
  ): Claim[] {
    const claims: Claim[] = [];
    const seen = new Set<string>();

    for (const pattern of ALL_PATTERNS) {
      // Reset regex state for global patterns
      pattern.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = pattern.pattern.exec(text)) !== null) {
        const originalText = match[0].trim();

        // Deduplicate by type + text
        const key = `${pattern.type}:${originalText}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Extract entities (files, commands, etc.) from match groups
        const entities = extractEntities(match, pattern);

        claims.push({
          claim_id: nanoid(),
          session_id: sessionId,
          task_id: taskId,
          response_id: responseId,
          claim_type: pattern.type,
          original_text: originalText,
          entities,
          confidence: pattern.confidence,
          created_at: new Date(),
        });
      }

      // Reset for next iteration
      pattern.pattern.lastIndex = 0;
    }

    return claims;
  }

  /**
   * Quick check if text contains any actionable claims
   *
   * Used to skip processing for responses that clearly don't contain claims.
   * Checks for common action verbs like "created", "updated", "ran", etc.
   */
  shouldExtract(text: string): boolean {
    if (text.length < 20) return false;

    const actionIndicators = [
      /\b(?:created?|wrote|added|implemented)\b/i,
      /\b(?:updated?|modified|changed|edited|fixed)\b/i,
      /\b(?:deleted?|removed)\b/i,
      /\b(?:ran?|executed?)\b/i,
      /\b(?:tests?\s+pass)/i,
      /\b(?:done|completed?|finished?)\b/i,
      /\b(?:installed?)\b/i,
    ];

    return actionIndicators.some((pattern) => pattern.test(text));
  }

  /**
   * Merge regex and LLM claims, preferring higher confidence
   */
  private mergeClaims(regexClaims: Claim[], llmClaims: Claim[]): Claim[] {
    const merged = new Map<string, Claim>();

    // Add regex claims first
    for (const claim of regexClaims) {
      const key = this.getClaimKey(claim);
      merged.set(key, claim);
    }

    // Override with LLM claims if higher confidence
    for (const claim of llmClaims) {
      const key = this.getClaimKey(claim);
      const existing = merged.get(key);

      if (!existing || claim.confidence > existing.confidence) {
        merged.set(key, claim);
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Consolidate claims by grouping similar claims and keeping highest confidence
   */
  private consolidateClaims(claims: Claim[]): Claim[] {
    const groups = new Map<string, Claim[]>();

    for (const claim of claims) {
      const key = this.getClaimKey(claim);
      const group = groups.get(key) ?? [];
      group.push(claim);
      groups.set(key, group);
    }

    const consolidated: Claim[] = [];
    for (const group of groups.values()) {
      // Keep the claim with highest confidence
      const best = group.reduce((a, b) =>
        a.confidence > b.confidence ? a : b
      );
      consolidated.push(best);
    }

    return consolidated;
  }

  /**
   * Generate a unique key for a claim based on type and entities
   */
  private getClaimKey(claim: Claim): string {
    const entityKey = claim.entities
      .map((e) => `${e.type}:${e.normalized ?? e.value}`)
      .sort()
      .join(",");

    return `${claim.claim_type}|${entityKey}`;
  }

  /**
   * Calculate average confidence across claims
   */
  private calculateAverageConfidence(claims: Claim[]): number {
    if (claims.length === 0) return 0;
    const sum = claims.reduce((acc, c) => acc + c.confidence, 0);
    return sum / claims.length;
  }

  /**
   * Check if text contains a specific claim type
   */
  hasClaimType(text: string, type: ClaimType): boolean {
    const patterns = ALL_PATTERNS.filter((p) => p.type === type);
    return patterns.some((p) => {
      p.pattern.lastIndex = 0;
      const result = p.pattern.test(text);
      p.pattern.lastIndex = 0;
      return result;
    });
  }

  /**
   * Extract file paths from text (utility method)
   */
  extractFilePaths(text: string): string[] {
    const filePattern = /[`"']?([^\s`"']+\.\w{1,10})[`"']?/g;
    const paths: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = filePattern.exec(text)) !== null) {
      const path = match[1];
      if (
        path &&
        !path.startsWith("http") &&
        !path.includes("@") &&
        path.includes("/") || path.match(/\.(ts|js|tsx|jsx|json|md|css|html|py|go|rs)$/)
      ) {
        paths.push(path);
      }
    }

    return [...new Set(paths)];
  }

  /**
   * Extract commands from text (utility method)
   */
  extractCommands(text: string): string[] {
    const commands: string[] = [];

    // Look for commands in backticks
    const backtickPattern = /`([^`]+)`/g;
    let match: RegExpExecArray | null;

    while ((match = backtickPattern.exec(text)) !== null) {
      const cmd = match[1];
      if (
        cmd &&
        (cmd.startsWith("npm ") ||
          cmd.startsWith("pnpm ") ||
          cmd.startsWith("yarn ") ||
          cmd.startsWith("git ") ||
          cmd.startsWith("cd ") ||
          cmd.startsWith("mkdir ") ||
          cmd.startsWith("rm ") ||
          cmd.startsWith("cat ") ||
          cmd.startsWith("./") ||
          cmd.match(/^\w+\s+/))
      ) {
        commands.push(cmd);
      }
    }

    return commands;
  }
}

/**
 * Factory function to create a ClaimExtractor
 */
export function createClaimExtractor(config: ClawMemoryConfig): ClaimExtractor {
  return new ClaimExtractor(config);
}
