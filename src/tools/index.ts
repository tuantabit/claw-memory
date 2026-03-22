import type { ClawMemoryEngine } from "../engine.js";
import { createVerifyTool, type VerifyInput, type VerifyOutput } from "./claw-memory-verify.js";
import { createAuditTool, type AuditInput, type AuditOutput } from "./claw-memory-audit.js";
import { createExpandTool, type ExpandInput, type ExpandOutput } from "./claw-memory-expand.js";
import { createCompactTool, type CompactInput, type CompactOutput } from "./claw-memory-compact.js";

export { createVerifyTool, type VerifyInput, type VerifyOutput } from "./claw-memory-verify.js";
export { createAuditTool, type AuditInput, type AuditOutput } from "./claw-memory-audit.js";
export { createExpandTool, type ExpandInput, type ExpandOutput } from "./claw-memory-expand.js";
export { createCompactTool, type CompactInput, type CompactOutput } from "./claw-memory-compact.js";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (input: unknown) => Promise<unknown>;
}

export function createClawMemoryTools(engine: ClawMemoryEngine): ToolDefinition[] {
  return [
    createVerifyTool(engine) as ToolDefinition,
    createAuditTool(engine) as ToolDefinition,
    createExpandTool(engine) as ToolDefinition,
    createCompactTool(engine) as ToolDefinition,
  ];
}

export function getTool(
  engine: ClawMemoryEngine,
  name: string
): ToolDefinition | null {
  const tools = createClawMemoryTools(engine);
  return tools.find((t) => t.name === name) ?? null;
}
