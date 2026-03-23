/**
 * Types for OpenClaw history import
 */

export interface SessionHeader {
  type: "header";
  version: string;
  sessionId: string;
  timestamp: number;
  cwd?: string;
}

export interface SessionMessage {
  type: "message";
  role: "user" | "assistant" | "system";
  content: string;
  messageId?: string;
  timestamp?: number;
}

export interface SessionToolUse {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface SessionToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string;
}

export type SessionEvent =
  | SessionHeader
  | SessionMessage
  | SessionToolUse
  | SessionToolResult
  | { type: string; [key: string]: unknown };

export interface ParsedSession {
  sessionId: string;
  agentId: string;
  filePath: string;
  messages: SessionMessage[];
  toolCalls: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    result?: string;
  }>;
  timestamp: number;
}

export interface ImportedClaim {
  type: string;
  content: string;
  target?: string;
  sessionId: string;
  timestamp: number;
  source: "import";
}

export interface ImportedEntity {
  type: "file" | "function" | "class" | "package" | "command" | "component";
  name: string;
  sessionId: string;
  firstSeenAt: number;
}

export interface ImportedRelationship {
  fromEntity: string;
  toEntity: string;
  type: "CONTAINS" | "IMPORTS" | "CALLS" | "DEPENDS_ON" | "CREATES" | "MODIFIES";
  sessionId: string;
}

export interface MigrationResult {
  success: boolean;
  stats: {
    sessionsScanned: number;
    messagesProcessed: number;
    claimsExtracted: number;
    entitiesExtracted: number;
    relationshipsCreated: number;
    embeddingsGenerated: number;
    errors: number;
  };
  duration: number;
  error?: string;
}

export interface MigrationMeta {
  id: string;
  migratedAt: number;
  sourcePath: string;
  stats: MigrationResult["stats"];
}
