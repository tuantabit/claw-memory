import type { Database } from "../core/database.js";
import type { FileReceipt, CommandReceipt, Action } from "../types.js";

export const INTEGRATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS claim_receipts (
  claim_id VARCHAR NOT NULL,
  receipt_type VARCHAR NOT NULL,
  receipt_id VARCHAR NOT NULL,
  match_confidence DOUBLE DEFAULT 1.0,
  linked_at TIMESTAMP DEFAULT current_timestamp,
  PRIMARY KEY (claim_id, receipt_type, receipt_id)
);

CREATE TABLE IF NOT EXISTS message_claims (
  message_id VARCHAR NOT NULL,
  claim_id VARCHAR NOT NULL,
  linked_at TIMESTAMP DEFAULT current_timestamp,
  PRIMARY KEY (message_id, claim_id)
);

CREATE TABLE IF NOT EXISTS verification_memories (
  verification_id VARCHAR NOT NULL,
  memory_id VARCHAR NOT NULL,
  layer VARCHAR NOT NULL,
  linked_at TIMESTAMP DEFAULT current_timestamp,
  PRIMARY KEY (verification_id, memory_id)
);

CREATE INDEX IF NOT EXISTS idx_claim_receipts_claim ON claim_receipts(claim_id);
CREATE INDEX IF NOT EXISTS idx_claim_receipts_receipt ON claim_receipts(receipt_type, receipt_id);
CREATE INDEX IF NOT EXISTS idx_message_claims_message ON message_claims(message_id);
CREATE INDEX IF NOT EXISTS idx_message_claims_claim ON message_claims(claim_id);
CREATE INDEX IF NOT EXISTS idx_verification_memories_verification ON verification_memories(verification_id);
CREATE INDEX IF NOT EXISTS idx_verification_memories_memory ON verification_memories(memory_id);
`;

export interface ClawMemoryReceipts {
  fileReceipts: FileReceipt[];
  commandReceipts: CommandReceipt[];
  actions: Action[];
}

export class SharedDatabaseAdapter {
  constructor(private db: Database) {}

  async initialize(): Promise<void> {
    await this.db.execute(INTEGRATION_SCHEMA);
  }

  async getFileReceiptByPath(filePath: string): Promise<FileReceipt | null> {
    try {
      const rows = await this.db.query<{
        receipt_id: string;
        action_id: string;
        file_path: string;
        before_hash: string | null;
        after_hash: string | null;
        created_at: string;
      }>(
        `SELECT receipt_id, action_id, file_path, before_hash, after_hash, created_at
         FROM file_receipts WHERE file_path = ? ORDER BY created_at DESC LIMIT 1`,
        [filePath]
      );

      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        receipt_id: row.receipt_id,
        action_id: row.action_id,
        file_path: row.file_path,
        before_hash: row.before_hash ?? "",
        after_hash: row.after_hash ?? "",
        created_at: new Date(row.created_at),
      };
    } catch {
      return null;
    }
  }

  async getFileReceiptsForSession(sessionId: string): Promise<FileReceipt[]> {
    try {
      const rows = await this.db.query<{
        receipt_id: string;
        action_id: string;
        file_path: string;
        before_hash: string | null;
        after_hash: string | null;
        created_at: string;
      }>(
        `SELECT fr.receipt_id, fr.action_id, fr.file_path, fr.before_hash, fr.after_hash, fr.created_at
         FROM file_receipts fr JOIN actions a ON fr.action_id = a.action_id
         WHERE a.session_id = ? ORDER BY fr.created_at DESC`,
        [sessionId]
      );

      return rows.map(row => ({
        receipt_id: row.receipt_id,
        action_id: row.action_id,
        file_path: row.file_path,
        before_hash: row.before_hash ?? "",
        after_hash: row.after_hash ?? "",
        created_at: new Date(row.created_at),
      }));
    } catch {
      return [];
    }
  }

  async getCommandReceiptByPattern(pattern: string): Promise<CommandReceipt | null> {
    try {
      const rows = await this.db.query<{
        receipt_id: string;
        action_id: string;
        command: string;
        exit_code: number | null;
        stdout_summary: string | null;
        duration_ms: number | null;
        created_at: string;
      }>(
        `SELECT receipt_id, action_id, command, exit_code, stdout_summary, duration_ms, created_at
         FROM command_receipts WHERE command LIKE ? ORDER BY created_at DESC LIMIT 1`,
        [`%${pattern}%`]
      );

      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        receipt_id: row.receipt_id,
        action_id: row.action_id,
        command: row.command,
        exit_code: row.exit_code,
        stdout_summary: row.stdout_summary,
        duration_ms: row.duration_ms,
        created_at: new Date(row.created_at),
      };
    } catch {
      return null;
    }
  }

  async getCommandReceiptsForSession(sessionId: string): Promise<CommandReceipt[]> {
    try {
      const rows = await this.db.query<{
        receipt_id: string;
        action_id: string;
        command: string;
        exit_code: number | null;
        stdout_summary: string | null;
        duration_ms: number | null;
        created_at: string;
      }>(
        `SELECT cr.receipt_id, cr.action_id, cr.command, cr.exit_code, cr.stdout_summary, cr.duration_ms, cr.created_at
         FROM command_receipts cr JOIN actions a ON cr.action_id = a.action_id
         WHERE a.session_id = ? ORDER BY cr.created_at DESC`,
        [sessionId]
      );

      return rows.map(row => ({
        receipt_id: row.receipt_id,
        action_id: row.action_id,
        command: row.command,
        exit_code: row.exit_code,
        stdout_summary: row.stdout_summary,
        duration_ms: row.duration_ms,
        created_at: new Date(row.created_at),
      }));
    } catch {
      return [];
    }
  }

  async getActionByToolName(sessionId: string, toolName: string): Promise<Action | null> {
    try {
      const rows = await this.db.query<{
        action_id: string;
        session_id: string;
        task_id: string | null;
        tool_name: string;
        tool_input: string | null;
        tool_result: string | null;
        created_at: string;
      }>(
        `SELECT action_id, session_id, task_id, tool_name, tool_input, tool_result, created_at
         FROM actions WHERE session_id = ? AND tool_name = ? ORDER BY created_at DESC LIMIT 1`,
        [sessionId, toolName]
      );

      if (rows.length === 0) return null;

      const row = rows[0];
      return {
        action_id: row.action_id,
        session_id: row.session_id,
        task_id: row.task_id,
        tool_name: row.tool_name,
        tool_input: row.tool_input ? JSON.parse(row.tool_input) : null,
        tool_result: row.tool_result ? JSON.parse(row.tool_result) : null,
        created_at: new Date(row.created_at),
      };
    } catch {
      return null;
    }
  }

  async getActionsForSession(sessionId: string): Promise<Action[]> {
    try {
      const rows = await this.db.query<{
        action_id: string;
        session_id: string;
        task_id: string | null;
        tool_name: string;
        tool_input: string | null;
        tool_result: string | null;
        created_at: string;
      }>(
        `SELECT action_id, session_id, task_id, tool_name, tool_input, tool_result, created_at
         FROM actions WHERE session_id = ? ORDER BY created_at DESC`,
        [sessionId]
      );

      return rows.map(row => ({
        action_id: row.action_id,
        session_id: row.session_id,
        task_id: row.task_id,
        tool_name: row.tool_name,
        tool_input: row.tool_input ? JSON.parse(row.tool_input) : null,
        tool_result: row.tool_result ? JSON.parse(row.tool_result) : null,
        created_at: new Date(row.created_at),
      }));
    } catch {
      return [];
    }
  }

  async getAllReceiptsForSession(sessionId: string): Promise<ClawMemoryReceipts> {
    const [fileReceipts, commandReceipts, actions] = await Promise.all([
      this.getFileReceiptsForSession(sessionId),
      this.getCommandReceiptsForSession(sessionId),
      this.getActionsForSession(sessionId),
    ]);
    return { fileReceipts, commandReceipts, actions };
  }

  async linkClaimToReceipt(
    claimId: string,
    receiptType: "file" | "command" | "action",
    receiptId: string,
    confidence = 1.0
  ): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO claim_receipts (claim_id, receipt_type, receipt_id, match_confidence) VALUES (?, ?, ?, ?)`,
      [claimId, receiptType, receiptId, confidence]
    );
  }

  async getReceiptsForClaim(claimId: string): Promise<Array<{
    receipt_type: string;
    receipt_id: string;
    match_confidence: number;
  }>> {
    return this.db.query(
      `SELECT receipt_type, receipt_id, match_confidence FROM claim_receipts WHERE claim_id = ?`,
      [claimId]
    );
  }

  async linkMessageToClaim(messageId: string, claimId: string): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO message_claims (message_id, claim_id) VALUES (?, ?)`,
      [messageId, claimId]
    );
  }

  async linkVerificationToMemory(verificationId: string, memoryId: string, layer: string): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO verification_memories (verification_id, memory_id, layer) VALUES (?, ?, ?)`,
      [verificationId, memoryId, layer]
    );
  }

  async hasClawMemoryTables(): Promise<boolean> {
    try {
      await this.db.query(`SELECT 1 FROM file_receipts LIMIT 1`);
      return true;
    } catch {
      return false;
    }
  }
}

export function createSharedDatabaseAdapter(db: Database): SharedDatabaseAdapter {
  return new SharedDatabaseAdapter(db);
}
