/**
 * Receipt Store - Persistence layer for actions and receipts
 *
 * This store handles all database operations for action tracking:
 * - Creating actions (tool calls)
 * - Creating file receipts (file operation evidence)
 * - Creating command receipts (command execution evidence)
 *
 * Receipts are the immutable evidence used to verify agent claims.
 * When an agent says "I created file X", we verify against file_receipts.
 */

import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type { FileReceipt, CommandReceipt, Action } from "../types.js";

/**
 * Store for managing actions and receipts in the database
 *
 * @example
 * ```typescript
 * const store = new ReceiptStore(db);
 *
 * // Record a tool call
 * const actionId = await store.createAction("session-123", "Edit", { file: "src/index.ts" });
 *
 * // Create file receipt after operation
 * await store.createFileReceipt(actionId, "src/index.ts", "modify", "abc123", "def456");
 *
 * // Complete the action
 * await store.completeAction(actionId, { success: true }, 150);
 *
 * // Later, verify claims against receipts
 * const receipt = await store.getFileReceiptByPath("src/index.ts");
 * ```
 */
export class ReceiptStore {
  constructor(private db: Database) {}

  // ========== Actions ==========

  /**
   * Create a new action record (beginning of a tool call)
   *
   * @param sessionId - Session ID
   * @param toolName - Name of the tool being called
   * @param toolInput - Input parameters to the tool
   * @param taskId - Optional task ID
   * @returns The generated action ID
   */
  async createAction(
    sessionId: string,
    toolName: string,
    toolInput: unknown,
    taskId?: string
  ): Promise<string> {
    const actionId = `act_${nanoid()}`;

    await this.db.execute(
      `INSERT INTO actions (action_id, session_id, task_id, tool_name, tool_input, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [actionId, sessionId, taskId ?? null, toolName, JSON.stringify(toolInput), new Date().toISOString()]
    );

    return actionId;
  }

  /**
   * Complete an action with result
   *
   * @param actionId - Action ID to complete
   * @param result - Tool result
   * @param durationMs - Duration in milliseconds
   * @param error - Error message if failed
   */
  async completeAction(
    actionId: string,
    result: unknown,
    durationMs: number,
    error?: string
  ): Promise<void> {
    await this.db.execute(
      `UPDATE actions SET
         tool_result = ?,
         status = ?,
         error_message = ?,
         duration_ms = ?,
         completed_at = ?
       WHERE action_id = ?`,
      [
        JSON.stringify(result),
        error ? 'error' : 'success',
        error ?? null,
        durationMs,
        new Date().toISOString(),
        actionId,
      ]
    );
  }

  /**
   * Get an action by ID
   *
   * @param actionId - Action ID
   * @returns Action or null if not found
   */
  async getAction(actionId: string): Promise<Action | null> {
    const rows = await this.db.query<ActionRow>(
      `SELECT * FROM actions WHERE action_id = ?`,
      [actionId]
    );

    if (rows.length === 0) return null;
    return this.rowToAction(rows[0]);
  }

  /**
   * Get recent actions for a session
   *
   * @param sessionId - Session ID
   * @param limit - Maximum number of actions
   * @returns Array of actions
   */
  async getActionsBySession(sessionId: string, limit = 100): Promise<Action[]> {
    const rows = await this.db.query<ActionRow>(
      `SELECT * FROM actions WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
      [sessionId, limit]
    );
    return rows.map(row => this.rowToAction(row));
  }

  /**
   * Get actions by tool name
   *
   * @param sessionId - Session ID
   * @param toolName - Tool name to filter
   * @param limit - Maximum number of actions
   * @returns Array of actions
   */
  async getActionsByTool(sessionId: string, toolName: string, limit = 50): Promise<Action[]> {
    const rows = await this.db.query<ActionRow>(
      `SELECT * FROM actions WHERE session_id = ? AND tool_name = ? ORDER BY created_at DESC LIMIT ?`,
      [sessionId, toolName, limit]
    );
    return rows.map(row => this.rowToAction(row));
  }

  // ========== File Receipts ==========

  /**
   * Create a file receipt
   *
   * @param actionId - Associated action ID
   * @param filePath - Path to the file
   * @param operation - Operation type (create/modify/delete/read)
   * @param beforeHash - Hash before operation (null for create)
   * @param afterHash - Hash after operation (null for delete)
   * @param beforeSize - Size before operation
   * @param afterSize - Size after operation
   * @returns The generated receipt ID
   */
  async createFileReceipt(
    actionId: string,
    filePath: string,
    operation: "create" | "modify" | "delete" | "read",
    beforeHash?: string,
    afterHash?: string,
    beforeSize?: number,
    afterSize?: number
  ): Promise<string> {
    const receiptId = `fr_${nanoid()}`;

    await this.db.execute(
      `INSERT INTO file_receipts
       (receipt_id, action_id, file_path, operation, before_hash, after_hash, before_size, after_size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receiptId, actionId, filePath, operation, beforeHash ?? null, afterHash ?? null, beforeSize ?? null, afterSize ?? null, new Date().toISOString()]
    );

    return receiptId;
  }

  /**
   * Get the most recent file receipt for a path
   *
   * @param filePath - File path to look up
   * @returns File receipt or null if not found
   */
  async getFileReceiptByPath(filePath: string): Promise<FileReceipt | null> {
    const rows = await this.db.query<FileReceiptRow>(
      `SELECT * FROM file_receipts WHERE file_path = ? ORDER BY created_at DESC LIMIT 1`,
      [filePath]
    );

    if (rows.length === 0) return null;
    return this.rowToFileReceipt(rows[0]);
  }

  /**
   * Get all file receipts for a session
   *
   * @param sessionId - Session ID
   * @returns Array of file receipts
   */
  async getFileReceiptsForSession(sessionId: string): Promise<FileReceipt[]> {
    const rows = await this.db.query<FileReceiptRow>(
      `SELECT fr.* FROM file_receipts fr
       JOIN actions a ON fr.action_id = a.action_id
       WHERE a.session_id = ?
       ORDER BY fr.created_at DESC`,
      [sessionId]
    );

    return rows.map(row => this.rowToFileReceipt(row));
  }

  /**
   * Get file receipts by operation type
   *
   * @param sessionId - Session ID
   * @param operation - Operation type to filter
   * @returns Array of file receipts
   */
  async getFileReceiptsByOperation(
    sessionId: string,
    operation: "create" | "modify" | "delete" | "read"
  ): Promise<FileReceipt[]> {
    const rows = await this.db.query<FileReceiptRow>(
      `SELECT fr.* FROM file_receipts fr
       JOIN actions a ON fr.action_id = a.action_id
       WHERE a.session_id = ? AND fr.operation = ?
       ORDER BY fr.created_at DESC`,
      [sessionId, operation]
    );

    return rows.map(row => this.rowToFileReceipt(row));
  }

  /**
   * Check if a file was created in this session
   *
   * @param sessionId - Session ID
   * @param filePath - File path
   * @returns True if file was created
   */
  async wasFileCreated(sessionId: string, filePath: string): Promise<boolean> {
    const rows = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM file_receipts fr
       JOIN actions a ON fr.action_id = a.action_id
       WHERE a.session_id = ? AND fr.file_path = ? AND fr.operation = 'create'`,
      [sessionId, filePath]
    );
    return (rows[0]?.cnt ?? 0) > 0;
  }

  /**
   * Check if a file was modified in this session
   *
   * @param sessionId - Session ID
   * @param filePath - File path
   * @returns True if file was modified
   */
  async wasFileModified(sessionId: string, filePath: string): Promise<boolean> {
    const rows = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM file_receipts fr
       JOIN actions a ON fr.action_id = a.action_id
       WHERE a.session_id = ? AND fr.file_path = ? AND fr.operation IN ('create', 'modify')`,
      [sessionId, filePath]
    );
    return (rows[0]?.cnt ?? 0) > 0;
  }

  // ========== Command Receipts ==========

  /**
   * Create a command receipt
   *
   * @param actionId - Associated action ID
   * @param command - Command that was executed
   * @param exitCode - Exit code (null if not completed)
   * @param stdoutSummary - Truncated stdout
   * @param stderrSummary - Truncated stderr
   * @param durationMs - Duration in milliseconds
   * @param workingDir - Working directory
   * @returns The generated receipt ID
   */
  async createCommandReceipt(
    actionId: string,
    command: string,
    exitCode: number | null,
    stdoutSummary?: string,
    stderrSummary?: string,
    durationMs?: number,
    workingDir?: string
  ): Promise<string> {
    const receiptId = `cr_${nanoid()}`;

    await this.db.execute(
      `INSERT INTO command_receipts
       (receipt_id, action_id, command, working_dir, exit_code, stdout_summary, stderr_summary, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [receiptId, actionId, command, workingDir ?? null, exitCode, stdoutSummary ?? null, stderrSummary ?? null, durationMs ?? null, new Date().toISOString()]
    );

    return receiptId;
  }

  /**
   * Get command receipt by pattern match
   *
   * @param pattern - Pattern to search in command text
   * @returns Most recent matching command receipt
   */
  async getCommandReceiptByPattern(pattern: string): Promise<CommandReceipt | null> {
    const rows = await this.db.query<CommandReceiptRow>(
      `SELECT * FROM command_receipts WHERE command LIKE ? ORDER BY created_at DESC LIMIT 1`,
      [`%${pattern}%`]
    );

    if (rows.length === 0) return null;
    return this.rowToCommandReceipt(rows[0]);
  }

  /**
   * Get all command receipts for a session
   *
   * @param sessionId - Session ID
   * @returns Array of command receipts
   */
  async getCommandReceiptsForSession(sessionId: string): Promise<CommandReceipt[]> {
    const rows = await this.db.query<CommandReceiptRow>(
      `SELECT cr.* FROM command_receipts cr
       JOIN actions a ON cr.action_id = a.action_id
       WHERE a.session_id = ?
       ORDER BY cr.created_at DESC`,
      [sessionId]
    );

    return rows.map(row => this.rowToCommandReceipt(row));
  }

  /**
   * Get command receipts by exit code
   *
   * @param sessionId - Session ID
   * @param exitCode - Exit code to filter
   * @returns Array of command receipts
   */
  async getCommandReceiptsByExitCode(sessionId: string, exitCode: number): Promise<CommandReceipt[]> {
    const rows = await this.db.query<CommandReceiptRow>(
      `SELECT cr.* FROM command_receipts cr
       JOIN actions a ON cr.action_id = a.action_id
       WHERE a.session_id = ? AND cr.exit_code = ?
       ORDER BY cr.created_at DESC`,
      [sessionId, exitCode]
    );

    return rows.map(row => this.rowToCommandReceipt(row));
  }

  /**
   * Check if a command matching pattern was executed successfully
   *
   * @param sessionId - Session ID
   * @param pattern - Pattern to match in command
   * @returns True if matching command succeeded (exit code 0)
   */
  async wasCommandSuccessful(sessionId: string, pattern: string): Promise<boolean> {
    const rows = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM command_receipts cr
       JOIN actions a ON cr.action_id = a.action_id
       WHERE a.session_id = ? AND cr.command LIKE ? AND cr.exit_code = 0`,
      [sessionId, `%${pattern}%`]
    );
    return (rows[0]?.cnt ?? 0) > 0;
  }

  // ========== Statistics ==========

  /**
   * Get receipt statistics for a session
   *
   * @param sessionId - Session ID
   * @returns Statistics object
   */
  async getStats(sessionId: string): Promise<{
    totalActions: number;
    successfulActions: number;
    failedActions: number;
    fileReceipts: number;
    commandReceipts: number;
    uniqueFilesModified: number;
  }> {
    const actionStats = await this.db.query<{ status: string; cnt: number }>(
      `SELECT status, COUNT(*) as cnt FROM actions WHERE session_id = ? GROUP BY status`,
      [sessionId]
    );

    const fileReceiptCount = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM file_receipts fr
       JOIN actions a ON fr.action_id = a.action_id
       WHERE a.session_id = ?`,
      [sessionId]
    );

    const commandReceiptCount = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM command_receipts cr
       JOIN actions a ON cr.action_id = a.action_id
       WHERE a.session_id = ?`,
      [sessionId]
    );

    const uniqueFiles = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(DISTINCT fr.file_path) as cnt FROM file_receipts fr
       JOIN actions a ON fr.action_id = a.action_id
       WHERE a.session_id = ?`,
      [sessionId]
    );

    let totalActions = 0;
    let successfulActions = 0;
    let failedActions = 0;

    for (const row of actionStats) {
      totalActions += row.cnt;
      if (row.status === 'success') {
        successfulActions = row.cnt;
      } else if (row.status === 'error') {
        failedActions = row.cnt;
      }
    }

    return {
      totalActions,
      successfulActions,
      failedActions,
      fileReceipts: fileReceiptCount[0]?.cnt ?? 0,
      commandReceipts: commandReceiptCount[0]?.cnt ?? 0,
      uniqueFilesModified: uniqueFiles[0]?.cnt ?? 0,
    };
  }

  // ========== Private Helpers ==========

  private rowToAction(row: ActionRow): Action {
    return {
      action_id: row.action_id,
      session_id: row.session_id,
      task_id: row.task_id,
      tool_name: row.tool_name,
      tool_input: row.tool_input ? JSON.parse(row.tool_input) : null,
      tool_result: row.tool_result ? JSON.parse(row.tool_result) : null,
      created_at: new Date(row.created_at),
    };
  }

  private rowToFileReceipt(row: FileReceiptRow): FileReceipt {
    return {
      receipt_id: row.receipt_id,
      action_id: row.action_id,
      file_path: row.file_path,
      before_hash: row.before_hash ?? "",
      after_hash: row.after_hash ?? "",
      created_at: new Date(row.created_at),
    };
  }

  private rowToCommandReceipt(row: CommandReceiptRow): CommandReceipt {
    return {
      receipt_id: row.receipt_id,
      action_id: row.action_id,
      command: row.command,
      exit_code: row.exit_code,
      stdout_summary: row.stdout_summary,
      duration_ms: row.duration_ms,
      created_at: new Date(row.created_at),
    };
  }
}

/**
 * Database row types
 */
interface ActionRow {
  action_id: string;
  session_id: string;
  task_id: string | null;
  tool_name: string;
  tool_input: string | null;
  tool_result: string | null;
  status: string;
  duration_ms: number | null;
  created_at: string;
}

interface FileReceiptRow {
  receipt_id: string;
  action_id: string;
  file_path: string;
  operation: string;
  before_hash: string | null;
  after_hash: string | null;
  created_at: string;
}

interface CommandReceiptRow {
  receipt_id: string;
  action_id: string;
  command: string;
  exit_code: number | null;
  stdout_summary: string | null;
  duration_ms: number | null;
  created_at: string;
}

/**
 * Factory function to create a ReceiptStore instance
 */
export function createReceiptStore(db: Database): ReceiptStore {
  return new ReceiptStore(db);
}
