/**
 * Session Scanner - Scan and parse OpenClaw session files
 */

import { readFileSync, readdirSync, existsSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import type {
  SessionEvent,
  SessionMessage,
  ParsedSession,
  SessionHeader,
  SessionToolUse,
  SessionToolResult,
} from "./types.js";

export class SessionScanner {
  private openclawDir: string;

  constructor(openclawDir?: string) {
    this.openclawDir = openclawDir || join(homedir(), ".openclaw");
  }

  /**
   * Scan all session files across all agents
   */
  scanSessionFiles(): string[] {
    const agentsDir = join(this.openclawDir, "agents");

    if (!existsSync(agentsDir)) {
      console.log(`  No agents directory found at ${agentsDir}`);
      return [];
    }

    const sessionFiles: string[] = [];

    try {
      const agents = readdirSync(agentsDir).filter((name) => {
        const agentPath = join(agentsDir, name);
        return statSync(agentPath).isDirectory();
      });

      for (const agent of agents) {
        const sessionsDir = join(agentsDir, agent, "sessions");

        if (!existsSync(sessionsDir)) {
          continue;
        }

        const files = readdirSync(sessionsDir).filter((name) =>
          name.endsWith(".jsonl")
        );

        for (const file of files) {
          sessionFiles.push(join(sessionsDir, file));
        }
      }
    } catch (error) {
      console.error(`  Error scanning session files:`, error);
    }

    return sessionFiles.sort();
  }

  /**
   * Parse a single JSONL session file
   */
  parseSessionFile(filePath: string): ParsedSession | null {
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim());

      const messages: SessionMessage[] = [];
      const toolCalls: ParsedSession["toolCalls"] = [];
      let sessionId = basename(filePath, ".jsonl");
      let timestamp = Date.now();

      const pathParts = filePath.split("/");
      const agentsIndex = pathParts.indexOf("agents");
      const agentId =
        agentsIndex >= 0 ? pathParts[agentsIndex + 1] : "unknown";

      const pendingToolCalls = new Map<
        string,
        { name: string; input: Record<string, unknown> }
      >();

      for (const line of lines) {
        try {
          const event = JSON.parse(line) as SessionEvent;

          switch (event.type) {
            case "header":
            case "session": {
              // Handle both "header" and "session" types
              const header = event as Record<string, unknown>;
              sessionId = (header.sessionId || header.id || sessionId) as string;
              const ts = header.timestamp;
              if (typeof ts === "number") {
                timestamp = ts;
              } else if (typeof ts === "string") {
                timestamp = new Date(ts).getTime();
              }
              break;
            }

            case "message": {
              // Handle OpenClaw message format: { message: { role, content: [...] } }
              const eventData = event as Record<string, unknown>;
              const msgData = eventData.message as Record<string, unknown> | undefined;

              if (msgData) {
                const role = msgData.role as string;
                let content = "";

                // Content can be string or array of content blocks
                if (typeof msgData.content === "string") {
                  content = msgData.content;
                } else if (Array.isArray(msgData.content)) {
                  content = (msgData.content as Array<{type: string; text?: string}>)
                    .filter(c => c.type === "text" && c.text)
                    .map(c => c.text)
                    .join("\n");
                }

                if ((role === "assistant" || role === "user") && content) {
                  messages.push({
                    type: "message",
                    role: role as "assistant" | "user",
                    content,
                    messageId: eventData.id as string,
                    timestamp: new Date(eventData.timestamp as string).getTime() || timestamp,
                  });
                }
              }
              break;
            }

            case "tool_use": {
              const toolUse = event as SessionToolUse;
              pendingToolCalls.set(toolUse.id, {
                name: toolUse.name,
                input: toolUse.input || {},
              });
              break;
            }

            case "tool_result": {
              const toolResult = event as SessionToolResult;
              const pending = pendingToolCalls.get(toolResult.tool_use_id);
              if (pending) {
                toolCalls.push({
                  id: toolResult.tool_use_id,
                  name: pending.name,
                  input: pending.input,
                  result: toolResult.content,
                });
                pendingToolCalls.delete(toolResult.tool_use_id);
              }
              break;
            }
          }
        } catch {
          continue;
        }
      }

      for (const [id, call] of pendingToolCalls) {
        toolCalls.push({
          id,
          name: call.name,
          input: call.input,
        });
      }

      return {
        sessionId,
        agentId,
        filePath,
        messages,
        toolCalls,
        timestamp,
      };
    } catch (error) {
      console.error(`  Error parsing ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Scan and parse all session files
   */
  scanAndParseAll(): ParsedSession[] {
    const files = this.scanSessionFiles();
    console.log(`  Found ${files.length} session files`);

    const sessions: ParsedSession[] = [];

    for (const file of files) {
      const session = this.parseSessionFile(file);
      if (session && session.messages.length > 0) {
        sessions.push(session);
      }
    }

    console.log(`  Parsed ${sessions.length} sessions with messages`);

    return sessions;
  }

  /**
   * Get statistics about available session data
   */
  getStats(): {
    totalFiles: number;
    totalMessages: number;
    totalToolCalls: number;
    agents: string[];
  } {
    const sessions = this.scanAndParseAll();

    const agents = new Set<string>();
    let totalMessages = 0;
    let totalToolCalls = 0;

    for (const session of sessions) {
      agents.add(session.agentId);
      totalMessages += session.messages.length;
      totalToolCalls += session.toolCalls.length;
    }

    return {
      totalFiles: sessions.length,
      totalMessages,
      totalToolCalls,
      agents: Array.from(agents),
    };
  }
}
