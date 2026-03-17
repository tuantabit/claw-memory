/**
 * Veridic Tools Index
 * Export all agent tools (like tools/ in lossless-claw)
 */

import type { VeridicEngine } from "../engine.js";
import { createVerifyTool, type VerifyInput, type VerifyOutput } from "./veridic-verify.js";
import { createAuditTool, type AuditInput, type AuditOutput } from "./veridic-audit.js";
import { createExpandTool, type ExpandInput, type ExpandOutput } from "./veridic-expand.js";
import { createScoreTool, type ScoreInput, type ScoreOutput } from "./veridic-score.js";
import { createCompactTool, type CompactInput, type CompactOutput } from "./veridic-compact.js";

export { createVerifyTool, type VerifyInput, type VerifyOutput } from "./veridic-verify.js";
export { createAuditTool, type AuditInput, type AuditOutput } from "./veridic-audit.js";
export { createExpandTool, type ExpandInput, type ExpandOutput } from "./veridic-expand.js";
export { createScoreTool, type ScoreInput, type ScoreOutput } from "./veridic-score.js";
export { createCompactTool, type CompactInput, type CompactOutput } from "./veridic-compact.js";

/**
 * Tool definition for OpenClaw
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (input: unknown) => Promise<unknown>;
}

/**
 * Create all veridic tools
 */
export function createVeridicTools(engine: VeridicEngine): ToolDefinition[] {
  return [
    createVerifyTool(engine) as ToolDefinition,
    createAuditTool(engine) as ToolDefinition,
    createExpandTool(engine) as ToolDefinition,
    createScoreTool(engine) as ToolDefinition,
    createCompactTool(engine) as ToolDefinition,
  ];
}

/**
 * Get tool by name
 */
export function getTool(
  engine: VeridicEngine,
  name: string
): ToolDefinition | null {
  const tools = createVeridicTools(engine);
  return tools.find((t) => t.name === name) ?? null;
}
