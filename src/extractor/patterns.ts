/**
 * Claim Detection Patterns
 * Regex patterns for extracting claims from AI responses
 */

import type { ClaimType, ClaimPattern, ClaimEntity } from "../types.js";

/**
 * File operation patterns
 */
export const FILE_PATTERNS: ClaimPattern[] = [
  // File created
  {
    pattern: /(?:I(?:'ve|'m)?|I have|Let me)\s+(?:created?|wrote|added|made)\s+(?:a\s+)?(?:new\s+)?(?:file\s+)?(?:called\s+|named\s+)?[`"']?([^\s`"']+\.\w+)[`"']?/gi,
    type: "file_created",
    confidence: 0.9,
    entityGroups: [{ index: 1, type: "file" }],
  },
  {
    pattern: /(?:Created?|Wrote|Added)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"']+\.\w+)[`"']?/gi,
    type: "file_created",
    confidence: 0.85,
    entityGroups: [{ index: 1, type: "file" }],
  },
  {
    pattern: /(?:new file|file created)[:\s]+[`"']?([^\s`"']+\.\w+)[`"']?/gi,
    type: "file_created",
    confidence: 0.85,
    entityGroups: [{ index: 1, type: "file" }],
  },

  // File modified
  {
    pattern: /(?:I(?:'ve|'m)?|I have)\s+(?:updated?|modified|changed|edited|fixed)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"']+\.\w+)[`"']?/gi,
    type: "file_modified",
    confidence: 0.9,
    entityGroups: [{ index: 1, type: "file" }],
  },
  {
    pattern: /(?:Updated?|Modified|Changed|Edited|Fixed)\s+(?:the\s+)?[`"']?([^\s`"']+\.\w+)[`"']?/gi,
    type: "file_modified",
    confidence: 0.85,
    entityGroups: [{ index: 1, type: "file" }],
  },
  {
    pattern: /(?:made changes? to|updated)\s+[`"']?([^\s`"']+\.\w+)[`"']?/gi,
    type: "file_modified",
    confidence: 0.8,
    entityGroups: [{ index: 1, type: "file" }],
  },

  // File deleted
  {
    pattern: /(?:I(?:'ve|'m)?|I have)\s+(?:deleted?|removed|cleaned up)\s+(?:the\s+)?(?:file\s+)?[`"']?([^\s`"']+\.\w+)[`"']?/gi,
    type: "file_deleted",
    confidence: 0.9,
    entityGroups: [{ index: 1, type: "file" }],
  },
  {
    pattern: /(?:Deleted?|Removed)\s+(?:the\s+)?[`"']?([^\s`"']+\.\w+)[`"']?/gi,
    type: "file_deleted",
    confidence: 0.85,
    entityGroups: [{ index: 1, type: "file" }],
  },
];

/**
 * Code operation patterns
 */
export const CODE_PATTERNS: ClaimPattern[] = [
  // Code added
  {
    pattern: /(?:I(?:'ve|'m)?|I have)\s+(?:added|implemented|created?|wrote)\s+(?:a\s+)?(?:new\s+)?(?:function|method|class|component)\s+(?:called\s+|named\s+)?[`"']?(\w+)[`"']?/gi,
    type: "code_added",
    confidence: 0.85,
    entityGroups: [{ index: 1, type: "function" }],
  },
  {
    pattern: /(?:Added|Implemented|Created)\s+(?:the\s+)?(?:function|method|class|component)\s+[`"']?(\w+)[`"']?/gi,
    type: "code_added",
    confidence: 0.8,
    entityGroups: [{ index: 1, type: "function" }],
  },
  {
    pattern: /(?:added|implemented)\s+(?:the\s+)?[`"']?(\w+)[`"']?\s+(?:function|method|class|component)/gi,
    type: "code_added",
    confidence: 0.75,
    entityGroups: [{ index: 1, type: "function" }],
  },

  // Code removed
  {
    pattern: /(?:I(?:'ve|'m)?|I have)\s+(?:removed|deleted|cleaned up)\s+(?:the\s+)?(?:dead\s+)?(?:code|function|method|class)\s*[`"']?(\w+)?[`"']?/gi,
    type: "code_removed",
    confidence: 0.8,
    entityGroups: [{ index: 1, type: "function" }],
  },
  {
    pattern: /(?:Removed|Deleted)\s+(?:the\s+)?(?:unused\s+|dead\s+)?(?:code|function|method)\s*[`"']?(\w+)?[`"']?/gi,
    type: "code_removed",
    confidence: 0.75,
    entityGroups: [{ index: 1, type: "function" }],
  },

  // Code fixed
  {
    pattern: /(?:I(?:'ve|'m)?|I have)\s+(?:fixed|resolved|corrected|patched)\s+(?:the\s+)?(?:bug|error|issue|problem)\s+(?:in\s+)?[`"']?([^\s`"']+)?[`"']?/gi,
    type: "code_fixed",
    confidence: 0.85,
    entityGroups: [{ index: 1, type: "function" }],
  },
  {
    pattern: /(?:Fixed|Resolved|Corrected)\s+(?:the\s+)?(?:bug|error|issue)\s+(?:in\s+)?[`"']?([^\s`"']+)?[`"']?/gi,
    type: "code_fixed",
    confidence: 0.8,
    entityGroups: [{ index: 1, type: "function" }],
  },
];

/**
 * Command execution patterns
 */
export const COMMAND_PATTERNS: ClaimPattern[] = [
  // Command executed
  {
    pattern: /(?:I(?:'ve|'m)?|I have)\s+(?:ran?|executed?|running)\s+[`"']?(.+?)[`"']?(?:\s+and|\s+which|\s*$)/gi,
    type: "command_executed",
    confidence: 0.85,
    entityGroups: [{ index: 1, type: "command" }],
  },
  {
    pattern: /(?:Ran?|Executed?|Running)\s+[`"']?(.+?)[`"']?(?:\s+and|\s+which|\s*$)/gi,
    type: "command_executed",
    confidence: 0.8,
    entityGroups: [{ index: 1, type: "command" }],
  },
  {
    pattern: /(?:ran|executed|running)\s+(?:the\s+)?command[:\s]+[`"']?(.+?)[`"']?$/gim,
    type: "command_executed",
    confidence: 0.85,
    entityGroups: [{ index: 1, type: "command" }],
  },
];

/**
 * Test result patterns
 */
export const TEST_PATTERNS: ClaimPattern[] = [
  // Tests passed
  {
    pattern: /(?:all\s+)?tests?\s+(?:are\s+)?pass(?:ed|ing)?/gi,
    type: "test_passed",
    confidence: 0.9,
  },
  {
    pattern: /tests?\s+(?:run\s+)?success(?:fully)?/gi,
    type: "test_passed",
    confidence: 0.85,
  },
  {
    pattern: /(?:all\s+)?\d+\s+tests?\s+pass(?:ed|ing)?/gi,
    type: "test_passed",
    confidence: 0.9,
  },
  {
    pattern: /test suite passed/gi,
    type: "test_passed",
    confidence: 0.95,
  },

  // Tests failed
  {
    pattern: /tests?\s+(?:are\s+)?fail(?:ed|ing)?/gi,
    type: "test_failed",
    confidence: 0.9,
  },
  {
    pattern: /\d+\s+tests?\s+fail(?:ed|ing)?/gi,
    type: "test_failed",
    confidence: 0.9,
  },
  {
    pattern: /test suite failed/gi,
    type: "test_failed",
    confidence: 0.95,
  },
];

/**
 * Dependency patterns
 */
export const DEPENDENCY_PATTERNS: ClaimPattern[] = [
  {
    pattern: /(?:I(?:'ve|'m)?|I have)\s+(?:installed?|added)\s+(?:the\s+)?(?:package|dependency|module)\s+[`"']?([^\s`"']+)[`"']?/gi,
    type: "dependency_added",
    confidence: 0.85,
    entityGroups: [{ index: 1, type: "package" }],
  },
  {
    pattern: /(?:Installed?|Added)\s+[`"']?([^\s`"']+)[`"']?\s+(?:package|dependency|to dependencies)/gi,
    type: "dependency_added",
    confidence: 0.8,
    entityGroups: [{ index: 1, type: "package" }],
  },
  {
    pattern: /npm install(?:ed)?\s+[`"']?([^\s`"']+)[`"']?/gi,
    type: "dependency_added",
    confidence: 0.85,
    entityGroups: [{ index: 1, type: "package" }],
  },
  {
    pattern: /pnpm add(?:ed)?\s+[`"']?([^\s`"']+)[`"']?/gi,
    type: "dependency_added",
    confidence: 0.85,
    entityGroups: [{ index: 1, type: "package" }],
  },
];

/**
 * Task completion patterns
 */
export const COMPLETION_PATTERNS: ClaimPattern[] = [
  {
    pattern: /(?:I(?:'ve|'m)?|I have)\s+(?:completed?|finished?|done)\s+(?:the\s+)?(?:task|work|implementation)/gi,
    type: "task_completed",
    confidence: 0.85,
  },
  {
    pattern: /^(?:Done|Completed?|Finished?)[\s!.]*$/gim,
    type: "task_completed",
    confidence: 0.9,
  },
  {
    pattern: /(?:that'?s\s+)?(?:all\s+)?(?:done|complete|finished)/gi,
    type: "task_completed",
    confidence: 0.75,
  },
  {
    pattern: /implementation\s+(?:is\s+)?(?:complete|done|finished)/gi,
    type: "task_completed",
    confidence: 0.85,
  },
];

/**
 * All patterns combined
 */
export const ALL_PATTERNS: ClaimPattern[] = [
  ...FILE_PATTERNS,
  ...CODE_PATTERNS,
  ...COMMAND_PATTERNS,
  ...TEST_PATTERNS,
  ...DEPENDENCY_PATTERNS,
  ...COMPLETION_PATTERNS,
];

/**
 * Get patterns by claim type
 */
export function getPatternsByType(type: ClaimType): ClaimPattern[] {
  return ALL_PATTERNS.filter((p) => p.type === type);
}

/**
 * Extract entities from match
 */
export function extractEntities(
  match: RegExpMatchArray,
  pattern: ClaimPattern
): ClaimEntity[] {
  const entities: ClaimEntity[] = [];

  if (pattern.entityGroups) {
    for (const group of pattern.entityGroups) {
      const value = match[group.index];
      if (value && value.trim()) {
        entities.push({
          type: group.type,
          value: value.trim(),
          normalized: normalizeEntity(value.trim(), group.type),
        });
      }
    }
  }

  return entities;
}

/**
 * Normalize entity value
 */
function normalizeEntity(value: string, type: ClaimEntity["type"]): string {
  // Remove backticks and quotes
  let normalized = value.replace(/[`"']/g, "").trim();

  if (type === "file") {
    // Normalize file paths
    normalized = normalized.replace(/^\.\//, "");
  } else if (type === "command") {
    // Extract just the command name
    normalized = normalized.split(/\s+/)[0] ?? normalized;
  }

  return normalized;
}
