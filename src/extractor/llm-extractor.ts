/**
 * LLM-based Claim Extractor
 * Uses LLM for more accurate claim extraction when regex confidence is low
 */

import { nanoid } from "nanoid";
import type { Claim, ClaimType, ClaimEntity, LLMApi } from "../types.js";

/**
 * System prompt for claim extraction
 */
const EXTRACTION_PROMPT = `You are a claim extractor. Analyze the AI assistant's response and extract all verifiable claims about actions performed.

Extract claims in these categories:
- file_created: Files that were created
- file_modified: Files that were updated/changed
- file_deleted: Files that were removed
- code_added: Functions/classes/components that were added
- code_removed: Code that was removed
- code_fixed: Bugs/errors that were fixed
- command_executed: Commands that were run
- test_passed: Claims that tests passed
- test_failed: Claims that tests failed
- dependency_added: Packages that were installed
- task_completed: Claims that work is done/complete

For each claim, extract:
1. type: The claim category
2. text: The original text containing the claim
3. entities: Files, functions, commands mentioned
4. confidence: How confident the claim is (0.0-1.0)

Respond with ONLY a JSON array of claims:
[
  {
    "type": "file_created",
    "text": "I created the file src/utils.ts",
    "entities": [{"type": "file", "value": "src/utils.ts"}],
    "confidence": 0.95
  }
]

If no claims found, respond with: []`;

/**
 * Parse LLM response into claims
 */
function parseLLMResponse(
  response: string,
  sessionId: string,
  taskId: string | null,
  responseId: string | null
): Claim[] {
  try {
    // Extract JSON from response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      type?: string;
      text?: string;
      entities?: Array<{ type?: string; value?: string }>;
      confidence?: number;
    }>;

    if (!Array.isArray(parsed)) return [];

    const validTypes: ClaimType[] = [
      "file_created",
      "file_modified",
      "file_deleted",
      "code_added",
      "code_removed",
      "code_fixed",
      "command_executed",
      "test_passed",
      "test_failed",
      "dependency_added",
      "config_changed",
      "task_completed",
    ];

    const claims: Claim[] = [];

    for (const item of parsed) {
      if (!item.type || !item.text) continue;
      if (!validTypes.includes(item.type as ClaimType)) continue;

      const entities: ClaimEntity[] = [];
      if (Array.isArray(item.entities)) {
        for (const entity of item.entities) {
          if (entity.type && entity.value) {
            entities.push({
              type: entity.type as ClaimEntity["type"],
              value: entity.value,
              normalized: entity.value,
            });
          }
        }
      }

      claims.push({
        claim_id: nanoid(),
        session_id: sessionId,
        task_id: taskId,
        response_id: responseId,
        claim_type: item.type as ClaimType,
        original_text: item.text,
        entities,
        confidence: typeof item.confidence === "number"
          ? Math.min(1, Math.max(0, item.confidence))
          : 0.7,
        created_at: new Date(),
      });
    }

    return claims;
  } catch (error) {
    console.error("[veridic-claw] Failed to parse LLM response:", error);
    return [];
  }
}

/**
 * Extract claims using LLM
 */
export async function extractClaimsWithLLM(
  text: string,
  sessionId: string,
  taskId: string | null,
  responseId: string | null,
  llmApi: LLMApi
): Promise<Claim[]> {
  try {
    const response = await llmApi.complete({
      model: "claude-3-haiku-20240307", // Use fast model
      maxTokens: 1000,
      system: EXTRACTION_PROMPT,
      messages: [
        {
          role: "user",
          content: `Extract claims from this AI response:\n\n${text}`,
        },
      ],
    });

    return parseLLMResponse(response.content, sessionId, taskId, responseId);
  } catch (error) {
    console.error("[veridic-claw] LLM extraction failed:", error);
    return [];
  }
}

/**
 * Verify a specific claim using LLM
 */
export async function verifyClaimWithLLM(
  claim: Claim,
  evidence: string,
  llmApi: LLMApi
): Promise<{
  verified: boolean;
  confidence: number;
  reasoning: string;
}> {
  const prompt = `Analyze if this claim is supported by the evidence.

CLAIM:
Type: ${claim.claim_type}
Text: "${claim.original_text}"
Entities: ${JSON.stringify(claim.entities)}

EVIDENCE:
${evidence}

Respond with JSON:
{
  "verified": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}`;

  try {
    const response = await llmApi.complete({
      model: "claude-3-haiku-20240307",
      maxTokens: 200,
      system: "You are a verification assistant. Analyze claims against evidence and determine if claims are supported.",
      messages: [{ role: "user", content: prompt }],
    });

    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { verified: false, confidence: 0, reasoning: "Failed to parse response" };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      verified?: boolean;
      confidence?: number;
      reasoning?: string;
    };

    return {
      verified: parsed.verified ?? false,
      confidence: parsed.confidence ?? 0,
      reasoning: parsed.reasoning ?? "Unknown",
    };
  } catch (error) {
    return {
      verified: false,
      confidence: 0,
      reasoning: `LLM verification failed: ${error}`,
    };
  }
}
