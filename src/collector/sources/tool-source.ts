
import type { Database } from "../../core/database.js";
import type { Evidence, Claim, EvidenceSource, Action } from "../../types.js";
import { nanoid } from "nanoid";

export class ToolEvidenceSource {
  constructor(private db: Database) {}

  
  async collectForClaim(claim: Claim): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    const toolsForClaim = this.getExpectedTools(claim.claim_type);

    for (const toolName of toolsForClaim) {
      const toolEvidence = await this.collectForTool(claim, toolName);
      evidence.push(...toolEvidence);
    }

    for (const entity of claim.entities) {
      const entityEvidence = await this.collectForEntity(claim, entity.value);
      evidence.push(...entityEvidence);
    }

    return evidence;
  }

  
  private getExpectedTools(claimType: string): string[] {
    const toolMap: Record<string, string[]> = {
      file_created: ["Write", "file_write", "create_file"],
      file_modified: ["Edit", "Write", "file_edit", "file_write"],
      file_deleted: ["Bash", "bash", "rm"],
      code_added: ["Edit", "Write", "file_edit", "file_write"],
      code_removed: ["Edit", "file_edit"],
      code_fixed: ["Edit", "file_edit"],
      command_executed: ["Bash", "bash", "shell", "execute"],
      test_passed: ["Bash", "bash"],
      test_failed: ["Bash", "bash"],
      dependency_added: ["Bash", "bash"],
      config_changed: ["Edit", "Write", "file_edit", "file_write"],
      task_completed: [],
    };

    return toolMap[claimType] ?? [];
  }

  
  async collectForTool(claim: Claim, toolName: string): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    try {
      const actions = await this.db.query<Action>(
        `SELECT * FROM actions
         WHERE session_id = ? AND tool_name = ?
         ORDER BY created_at DESC
         LIMIT 20`,
        [claim.session_id, toolName]
      );

      for (const action of actions) {
        const relevance = this.calculateRelevance(claim, action);
        if (relevance < 0.3) continue;

        const supports = this.evaluateToolSupport(claim, action);

        evidence.push({
          evidence_id: nanoid(),
          claim_id: claim.claim_id,
          source: "tool_call" as EvidenceSource,
          source_ref: action.action_id,
          data: {
            tool_name: action.tool_name,
            tool_input: action.tool_input,
            tool_result: this.summarizeResult(action.tool_result),
            task_id: action.task_id,
            created_at: action.created_at,
          },
          supports_claim: supports,
          confidence: relevance,
          collected_at: new Date(),
        });
      }
    } catch {
    }

    return evidence;
  }

  
  async collectForEntity(claim: Claim, entityValue: string): Promise<Evidence[]> {
    const evidence: Evidence[] = [];

    try {
      const actions = await this.db.query<Action>(
        `SELECT * FROM actions
         WHERE session_id = ?
           AND (
             CAST(tool_input AS VARCHAR) LIKE ?
             OR CAST(tool_result AS VARCHAR) LIKE ?
           )
         ORDER BY created_at DESC
         LIMIT 10`,
        [claim.session_id, `%${entityValue}%`, `%${entityValue}%`]
      );

      for (const action of actions) {
        const supports = this.evaluateToolSupport(claim, action);
        const relevance = this.calculateRelevance(claim, action);

        evidence.push({
          evidence_id: nanoid(),
          claim_id: claim.claim_id,
          source: "tool_call" as EvidenceSource,
          source_ref: action.action_id,
          data: {
            tool_name: action.tool_name,
            tool_input: action.tool_input,
            tool_result: this.summarizeResult(action.tool_result),
            matched_entity: entityValue,
          },
          supports_claim: supports,
          confidence: relevance,
          collected_at: new Date(),
        });
      }
    } catch {
    }

    return evidence;
  }

  
  async getSessionTools(sessionId: string, limit = 50): Promise<Action[]> {
    try {
      return await this.db.query<Action>(
        `SELECT * FROM actions
         WHERE session_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [sessionId, limit]
      );
    } catch {
      return [];
    }
  }

  
  private evaluateToolSupport(claim: Claim, action: Action): boolean {
    const input = action.tool_input as Record<string, unknown> | null;
    const result = action.tool_result as Record<string, unknown> | null;

    switch (claim.claim_type) {
      case "file_created":
      case "file_modified":
        return this.entityMatchesInput(claim, input);

      case "command_executed":
        return this.hasCommandInInput(claim, input);

      case "test_passed":
        return result?.exit_code === 0 || result?.exitCode === 0;

      case "test_failed":
        return (result?.exit_code !== 0 && result?.exit_code !== undefined) ||
               (result?.exitCode !== 0 && result?.exitCode !== undefined);

      default:
        return true;
    }
  }

  
  private entityMatchesInput(
    claim: Claim,
    input: Record<string, unknown> | null
  ): boolean {
    if (!input) return false;

    const inputStr = JSON.stringify(input);
    return claim.entities.some((e) => inputStr.includes(e.value));
  }

  
  private hasCommandInInput(
    claim: Claim,
    input: Record<string, unknown> | null
  ): boolean {
    if (!input) return false;

    const commands = claim.entities
      .filter((e) => e.type === "command")
      .map((e) => e.value);

    const inputStr = JSON.stringify(input);
    return commands.some((cmd) => inputStr.includes(cmd));
  }

  
  private calculateRelevance(claim: Claim, action: Action): number {
    let relevance = 0.5;

    const expectedTools = this.getExpectedTools(claim.claim_type);
    if (expectedTools.includes(action.tool_name)) {
      relevance += 0.2;
    }

    if (action.tool_input) {
      const inputStr = JSON.stringify(action.tool_input);
      const matchedEntities = claim.entities.filter((e) =>
        inputStr.includes(e.value)
      );
      relevance += 0.1 * Math.min(matchedEntities.length, 3);
    }

    const age = Date.now() - new Date(action.created_at).getTime();
    if (age < 60000) relevance += 0.1;

    return Math.min(relevance, 1.0);
  }

  
  private summarizeResult(result: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!result) return null;

    const str = JSON.stringify(result);
    if (str.length > 1000) {
      return {
        _truncated: true,
        _length: str.length,
        exit_code: result.exit_code ?? result.exitCode,
        success: result.success,
      };
    }

    return result;
  }
}
