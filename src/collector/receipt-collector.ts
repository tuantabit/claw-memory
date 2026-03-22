/**
 * Receipt Collector - Captures receipts from tool calls
 *
 * This module hooks into agent tool calls to create immutable
 * evidence of what actually happened:
 *
 * - File operations → file_receipts (with before/after hashes)
 * - Command executions → command_receipts (with exit codes, output)
 * - General tool calls → actions (with input/output)
 *
 * These receipts are then used by ClawMemory to verify agent claims.
 * When an agent says "I created src/index.ts", we check file_receipts
 * to verify the file was actually created.
 */

import * as crypto from "crypto";
import * as fs from "fs/promises";
import type { Database } from "../core/database.js";
import { ReceiptStore } from "../store/receipt-store.js";

/**
 * Options for creating a file receipt
 */
export interface FileReceiptOptions {
  /** Action ID this receipt belongs to */
  actionId: string;
  /** Path to the file */
  filePath: string;
  /** Type of operation */
  operation: "create" | "modify" | "delete" | "read";
  /** Hash before operation (computed if not provided) */
  beforeHash?: string;
  /** Hash after operation (computed if not provided) */
  afterHash?: string;
}

/**
 * Options for creating a command receipt
 */
export interface CommandReceiptOptions {
  /** Action ID this receipt belongs to */
  actionId: string;
  /** Command that was executed */
  command: string;
  /** Exit code (0 = success) */
  exitCode: number | null;
  /** Standard output (truncated if long) */
  stdout: string;
  /** Standard error (truncated if long) */
  stderr: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Working directory */
  workingDir?: string;
}

/**
 * ReceiptCollector - Captures immutable evidence from tool calls
 *
 * @example
 * ```typescript
 * const collector = new ReceiptCollector(db);
 *
 * // When a tool call starts
 * const actionId = await collector.startAction(
 *   "session-123",
 *   "Edit",
 *   { file: "src/index.ts", content: "..." }
 * );
 *
 * // After file operation
 * await collector.createFileReceipt({
 *   actionId,
 *   filePath: "src/index.ts",
 *   operation: "modify"
 * });
 *
 * // When tool call completes
 * await collector.completeAction(actionId, { success: true }, 150);
 * ```
 */
export class ReceiptCollector {
  private store: ReceiptStore;
  private maxOutputLength = 1000;

  constructor(db: Database) {
    this.store = new ReceiptStore(db);
  }

  /**
   * Start tracking an action (tool call)
   *
   * Call this when a tool call begins. Returns an action ID
   * that should be passed to receipt creation methods.
   *
   * @param sessionId - Current session ID
   * @param toolName - Name of the tool being called
   * @param toolInput - Input parameters to the tool
   * @param taskId - Optional task ID
   * @returns Generated action ID
   */
  async startAction(
    sessionId: string,
    toolName: string,
    toolInput: unknown,
    taskId?: string
  ): Promise<string> {
    return this.store.createAction(sessionId, toolName, toolInput, taskId);
  }

  /**
   * Complete an action with result
   *
   * Call this when a tool call finishes.
   *
   * @param actionId - Action ID from startAction
   * @param result - Tool result (success data or error)
   * @param durationMs - Duration in milliseconds
   * @param error - Error message if failed
   */
  async completeAction(
    actionId: string,
    result: unknown,
    durationMs: number,
    error?: string
  ): Promise<void> {
    await this.store.completeAction(actionId, result, durationMs, error);
  }

  /**
   * Create a file receipt
   *
   * Captures before/after hashes of a file operation.
   * Automatically computes hashes if not provided.
   *
   * @param options - File receipt options
   * @returns Generated receipt ID
   */
  async createFileReceipt(options: FileReceiptOptions): Promise<string> {
    const { actionId, filePath, operation } = options;
    let { beforeHash, afterHash } = options;
    let beforeSize: number | undefined;
    let afterSize: number | undefined;

    // Compute before hash if file exists and not provided
    if (!beforeHash && operation !== "create") {
      try {
        const beforeContent = await fs.readFile(filePath);
        beforeHash = this.computeHash(beforeContent);
        beforeSize = beforeContent.length;
      } catch {
        // File didn't exist before
      }
    }

    // Compute after hash if file exists and not provided
    if (!afterHash && operation !== "delete") {
      try {
        const afterContent = await fs.readFile(filePath);
        afterHash = this.computeHash(afterContent);
        afterSize = afterContent.length;
      } catch {
        // File doesn't exist after
      }
    }

    return this.store.createFileReceipt(
      actionId,
      filePath,
      operation,
      beforeHash,
      afterHash,
      beforeSize,
      afterSize
    );
  }

  /**
   * Create a file receipt with explicit hashes
   *
   * Use this when you already have the file content hashes.
   *
   * @param actionId - Action ID
   * @param filePath - File path
   * @param operation - Operation type
   * @param beforeHash - Hash before operation
   * @param afterHash - Hash after operation
   * @returns Generated receipt ID
   */
  async createFileReceiptWithHashes(
    actionId: string,
    filePath: string,
    operation: "create" | "modify" | "delete" | "read",
    beforeHash?: string,
    afterHash?: string
  ): Promise<string> {
    return this.store.createFileReceipt(
      actionId,
      filePath,
      operation,
      beforeHash,
      afterHash
    );
  }

  /**
   * Create a command receipt
   *
   * Captures the result of a command execution.
   *
   * @param options - Command receipt options
   * @returns Generated receipt ID
   */
  async createCommandReceipt(options: CommandReceiptOptions): Promise<string> {
    const { actionId, command, exitCode, stdout, stderr, durationMs, workingDir } = options;

    // Truncate output if too long
    const stdoutSummary = this.truncateOutput(stdout);
    const stderrSummary = this.truncateOutput(stderr);

    return this.store.createCommandReceipt(
      actionId,
      command,
      exitCode,
      stdoutSummary,
      stderrSummary,
      durationMs,
      workingDir
    );
  }

  /**
   * Get the most recent file receipt for a path
   *
   * @param filePath - File path to look up
   * @returns File receipt or null
   */
  async getFileReceipt(filePath: string) {
    return this.store.getFileReceiptByPath(filePath);
  }

  /**
   * Get command receipt matching a pattern
   *
   * @param pattern - Pattern to search in command text
   * @returns Command receipt or null
   */
  async getCommandReceipt(pattern: string) {
    return this.store.getCommandReceiptByPattern(pattern);
  }

  /**
   * Check if a file was created in this session
   *
   * @param sessionId - Session ID
   * @param filePath - File path
   * @returns True if file was created
   */
  async wasFileCreated(sessionId: string, filePath: string): Promise<boolean> {
    return this.store.wasFileCreated(sessionId, filePath);
  }

  /**
   * Check if a file was modified in this session
   *
   * @param sessionId - Session ID
   * @param filePath - File path
   * @returns True if file was modified
   */
  async wasFileModified(sessionId: string, filePath: string): Promise<boolean> {
    return this.store.wasFileModified(sessionId, filePath);
  }

  /**
   * Check if a command was executed successfully
   *
   * @param sessionId - Session ID
   * @param pattern - Pattern to match in command
   * @returns True if matching command succeeded
   */
  async wasCommandSuccessful(sessionId: string, pattern: string): Promise<boolean> {
    return this.store.wasCommandSuccessful(sessionId, pattern);
  }

  /**
   * Get statistics for a session
   *
   * @param sessionId - Session ID
   * @returns Statistics object
   */
  async getStats(sessionId: string) {
    return this.store.getStats(sessionId);
  }

  /**
   * Compute SHA-256 hash of content
   */
  private computeHash(content: Buffer | string): string {
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  /**
   * Truncate output to maximum length
   */
  private truncateOutput(output: string): string {
    if (output.length <= this.maxOutputLength) {
      return output;
    }
    return output.slice(0, this.maxOutputLength) + "... (truncated)";
  }
}

/**
 * Factory function to create a ReceiptCollector
 *
 * @param db - Database instance
 * @returns ReceiptCollector instance
 */
export function createReceiptCollector(db: Database): ReceiptCollector {
  return new ReceiptCollector(db);
}
