/**
 * Claim Extractor
 * Extract claims from AI responses (like CompactionEngine in lossless-claw)
 */

import { nanoid } from "nanoid";
import type {
  Claim,
  ClaimType,
  ClaimEntity,
  ExtractionResult,
  VeridicConfig,
} from "../types.js";
import { ALL_PATTERNS, extractEntities } from "./patterns.js";
import { extractClaimsWithLLM } from "./llm-extractor.js";
import type { LLMApi } from "../types.js";

export class ClaimExtractor {
  private config: VeridicConfig;

  constructor(config: VeridicConfig) {
    this.config = config;
  }

  /**
   * Extract claims from AI response text
   * Main entry point (like CompactionEngine.compact())
   */
  async extract(
    text: string,
    sessionId: string,
    taskId: string | null,
    responseId: string | null,
    llmApi?: LLMApi
  ): Promise<ExtractionResult> {
    const startTime = Date.now();

    // Step 1: Try regex extraction first (fast)
    const regexClaims = this.extractWithRegex(text, sessionId, taskId, responseId);

    // Step 2: If LLM enabled and regex confidence is low, try LLM
    let finalClaims = regexClaims;
    let method: "regex" | "llm" | "hybrid" = "regex";

    const avgConfidence = this.calculateAverageConfidence(regexClaims);

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

        // Merge regex and LLM claims, preferring higher confidence
        finalClaims = this.mergeClaims(regexClaims, llmClaims);
        method = "hybrid";
      } catch (error) {
        console.error("[veridic-claw] LLM extraction failed:", error);
        // Fall back to regex results
      }
    }

    // Step 3: Consolidate similar claims
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
      // Reset regex lastIndex
      pattern.pattern.lastIndex = 0;

      let match: RegExpExecArray | null;
      while ((match = pattern.pattern.exec(text)) !== null) {
        const originalText = match[0].trim();

        // Skip duplicates
        const key = `${pattern.type}:${originalText}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // Extract entities
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

      // Reset for next pattern
      pattern.pattern.lastIndex = 0;
    }

    return claims;
  }

  /**
   * Check if extraction should be performed
   * (like CompactionEngine.evaluate())
   */
  shouldExtract(text: string): boolean {
    // Skip very short responses
    if (text.length < 20) return false;

    // Skip if no action words
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
   * Merge claims from regex and LLM, preferring higher confidence
   */
  private mergeClaims(regexClaims: Claim[], llmClaims: Claim[]): Claim[] {
    const merged = new Map<string, Claim>();

    // Add regex claims
    for (const claim of regexClaims) {
      const key = this.getClaimKey(claim);
      merged.set(key, claim);
    }

    // Add or replace with LLM claims if higher confidence
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
   * Consolidate similar claims
   * (like CompactionEngine.condensedPass())
   */
  private consolidateClaims(claims: Claim[]): Claim[] {
    // Group by type and entity
    const groups = new Map<string, Claim[]>();

    for (const claim of claims) {
      const key = this.getClaimKey(claim);
      const group = groups.get(key) ?? [];
      group.push(claim);
      groups.set(key, group);
    }

    // Take highest confidence claim from each group
    const consolidated: Claim[] = [];
    for (const group of groups.values()) {
      const best = group.reduce((a, b) =>
        a.confidence > b.confidence ? a : b
      );
      consolidated.push(best);
    }

    return consolidated;
  }

  /**
   * Get unique key for claim deduplication
   */
  private getClaimKey(claim: Claim): string {
    const entityKey = claim.entities
      .map((e) => `${e.type}:${e.normalized ?? e.value}`)
      .sort()
      .join(",");

    return `${claim.claim_type}|${entityKey}`;
  }

  /**
   * Calculate average confidence of claims
   */
  private calculateAverageConfidence(claims: Claim[]): number {
    if (claims.length === 0) return 0;
    const sum = claims.reduce((acc, c) => acc + c.confidence, 0);
    return sum / claims.length;
  }

  /**
   * Quick check for specific claim type in text
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
   * Extract file paths mentioned in text
   */
  extractFilePaths(text: string): string[] {
    const filePattern = /[`"']?([^\s`"']+\.\w{1,10})[`"']?/g;
    const paths: string[] = [];
    let match: RegExpExecArray | null;

    while ((match = filePattern.exec(text)) !== null) {
      const path = match[1];
      // Filter out common false positives
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
   * Extract command from text
   */
  extractCommands(text: string): string[] {
    const commands: string[] = [];

    // Look for commands in backticks
    const backtickPattern = /`([^`]+)`/g;
    let match: RegExpExecArray | null;

    while ((match = backtickPattern.exec(text)) !== null) {
      const cmd = match[1];
      // Check if it looks like a command
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
 * Create claim extractor with config
 */
export function createClaimExtractor(config: VeridicConfig): ClaimExtractor {
  return new ClaimExtractor(config);
}
