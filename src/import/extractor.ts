/**
 * History Extractor - Extract claims and entities from session messages
 */

import type {
  ParsedSession,
  ImportedClaim,
  ImportedEntity,
  ImportedRelationship,
} from "./types.js";

interface ClaimPattern {
  type: string;
  patterns: RegExp[];
  targetGroup?: number;
}

interface EntityPattern {
  type: ImportedEntity["type"];
  patterns: RegExp[];
}

const CLAIM_PATTERNS: ClaimPattern[] = [
  {
    type: "file_created",
    patterns: [
      /(?:created?|wrote)\s+(?:file)?\s*[`"']?([^\s`"']+\.[a-z]+)[`"']?/gi,
      /(?:new file)[:\s]+[`"']?([^\s`"']+\.[a-z]+)[`"']?/gi,
    ],
    targetGroup: 1,
  },
  {
    type: "file_modified",
    patterns: [
      /(?:updated?|modified?|changed?|edited?)\s+(?:file)?\s*[`"']?([^\s`"']+\.[a-z]+)[`"']?/gi,
    ],
    targetGroup: 1,
  },
  {
    type: "file_deleted",
    patterns: [
      /(?:deleted?|removed?)\s+(?:file)?\s*[`"']?([^\s`"']+\.[a-z]+)[`"']?/gi,
    ],
    targetGroup: 1,
  },
  {
    type: "code_added",
    patterns: [
      /(?:added?|created?)\s+(?:function|method|class|component)\s+[`"']?(\w+)[`"']?/gi,
    ],
    targetGroup: 1,
  },
  {
    type: "command_executed",
    patterns: [
      /(?:ran?|executed?)\s+[`"']?([^`"'\n]+)[`"']?/gi,
    ],
    targetGroup: 1,
  },
  {
    type: "package_installed",
    patterns: [
      /(?:installed?)\s+(?:package|dependency)?\s*[`"']?([^\s`"']+)[`"']?/gi,
      /npm\s+install\s+([^\s]+)/gi,
    ],
    targetGroup: 1,
  },
  {
    type: "test_passed",
    patterns: [/(?:tests?\s+)?pass(?:ed|ing)?/gi],
  },
  {
    type: "test_failed",
    patterns: [/(?:tests?\s+)?fail(?:ed|ing)?/gi],
  },
  {
    type: "bug_fixed",
    patterns: [/(?:fixed?)\s+(?:the\s+)?(?:bug|issue|error)/gi],
  },
  {
    type: "task_completed",
    patterns: [/(?:completed?|finished?|done)/gi],
  },
];

const ENTITY_PATTERNS: EntityPattern[] = [
  {
    type: "file",
    patterns: [/[`"']?([a-zA-Z0-9_\-./]+\.[a-z]{1,5})[`"']?/g],
  },
  {
    type: "function",
    patterns: [/(?:function|method)\s+[`"']?(\w+)\s*\(/gi],
  },
  {
    type: "class",
    patterns: [/(?:class)\s+[`"']?(\w+)[`"']?/gi],
  },
  {
    type: "package",
    patterns: [/(?:import|require)\s*\(?[`"']([^`"']+)[`"']\)?/g],
  },
  {
    type: "command",
    patterns: [/(?:npm|pnpm|yarn|npx)\s+\w+(?:\s+[^\n`"']+)?/g],
  },
  {
    type: "component",
    patterns: [/<([A-Z][a-zA-Z0-9]*)\s*/g],
  },
];

const COMMON_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "to", "of", "in",
  "for", "on", "with", "at", "by", "from", "as", "into", "through",
  "and", "but", "or", "if", "this", "that", "these", "those", "it",
  "you", "we", "they", "he", "she", "i", "me", "my", "true", "false",
  "null", "undefined", "return", "const", "let", "var", "function",
  "class", "import", "export", "default", "async", "await", "new",
  "try", "catch", "throw", "error", "Error",
]);

export class HistoryExtractor {
  extractClaimsFromMessage(
    content: string,
    sessionId: string,
    timestamp: number
  ): ImportedClaim[] {
    const claims: ImportedClaim[] = [];

    for (const { type, patterns, targetGroup } of CLAIM_PATTERNS) {
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;

        while ((match = pattern.exec(content)) !== null) {
          const target = targetGroup ? match[targetGroup] : undefined;

          if (target && (target.length < 2 || target.startsWith("."))) {
            continue;
          }

          claims.push({
            type,
            content: match[0].trim(),
            target: target?.trim(),
            sessionId,
            timestamp,
            source: "import",
          });
        }
      }
    }

    const seen = new Set<string>();
    return claims.filter((claim) => {
      const key = `${claim.type}:${claim.target || claim.content}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  extractEntitiesFromMessage(
    content: string,
    sessionId: string,
    timestamp: number
  ): ImportedEntity[] {
    const entities: ImportedEntity[] = [];

    for (const { type, patterns } of ENTITY_PATTERNS) {
      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match;

        while ((match = pattern.exec(content)) !== null) {
          const name = match[1] || match[0];

          if (!name || name.length < 2 || name.length > 200) {
            continue;
          }

          if (COMMON_WORDS.has(name.toLowerCase())) {
            continue;
          }

          entities.push({
            type,
            name: name.trim(),
            sessionId,
            firstSeenAt: timestamp,
          });
        }
      }
    }

    const seen = new Set<string>();
    return entities.filter((entity) => {
      const key = `${entity.type}:${entity.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  extractRelationshipsFromToolCalls(
    toolCalls: ParsedSession["toolCalls"],
    sessionId: string
  ): ImportedRelationship[] {
    const relationships: ImportedRelationship[] = [];

    for (const call of toolCalls) {
      if (call.name === "read_file" || call.name === "Read") {
        const path = (call.input.path || call.input.file_path) as string;
        if (typeof path === "string") {
          relationships.push({
            fromEntity: "agent",
            toEntity: path,
            type: "IMPORTS",
            sessionId,
          });
        }
      }

      if (call.name === "write_file" || call.name === "Write") {
        const path = (call.input.path || call.input.file_path) as string;
        if (typeof path === "string") {
          relationships.push({
            fromEntity: "agent",
            toEntity: path,
            type: "CREATES",
            sessionId,
          });
        }
      }

      if (call.name === "edit_file" || call.name === "Edit") {
        const path = (call.input.path || call.input.file_path) as string;
        if (typeof path === "string") {
          relationships.push({
            fromEntity: "agent",
            toEntity: path,
            type: "MODIFIES",
            sessionId,
          });
        }
      }
    }

    return relationships;
  }

  extractFromSession(session: ParsedSession): {
    claims: ImportedClaim[];
    entities: ImportedEntity[];
    relationships: ImportedRelationship[];
  } {
    const claims: ImportedClaim[] = [];
    const entities: ImportedEntity[] = [];
    const relationships: ImportedRelationship[] = [];

    for (const message of session.messages) {
      if (message.role === "assistant" && message.content) {
        const timestamp = message.timestamp || session.timestamp;

        claims.push(
          ...this.extractClaimsFromMessage(
            message.content,
            session.sessionId,
            timestamp
          )
        );

        entities.push(
          ...this.extractEntitiesFromMessage(
            message.content,
            session.sessionId,
            timestamp
          )
        );
      }
    }

    relationships.push(
      ...this.extractRelationshipsFromToolCalls(
        session.toolCalls,
        session.sessionId
      )
    );

    return { claims, entities, relationships };
  }

  extractFromSessions(sessions: ParsedSession[]): {
    claims: ImportedClaim[];
    entities: ImportedEntity[];
    relationships: ImportedRelationship[];
  } {
    const allClaims: ImportedClaim[] = [];
    const allEntities: ImportedEntity[] = [];
    const allRelationships: ImportedRelationship[] = [];

    for (const session of sessions) {
      const { claims, entities, relationships } = this.extractFromSession(session);
      allClaims.push(...claims);
      allEntities.push(...entities);
      allRelationships.push(...relationships);
    }

    const seenClaims = new Set<string>();
    const uniqueClaims = allClaims.filter((c) => {
      const key = `${c.type}:${c.target || c.content}`;
      if (seenClaims.has(key)) return false;
      seenClaims.add(key);
      return true;
    });

    const seenEntities = new Set<string>();
    const uniqueEntities = allEntities.filter((e) => {
      const key = `${e.type}:${e.name}`;
      if (seenEntities.has(key)) return false;
      seenEntities.add(key);
      return true;
    });

    console.log(
      `  Extracted: ${uniqueClaims.length} claims, ${uniqueEntities.length} entities, ${allRelationships.length} relationships`
    );

    return {
      claims: uniqueClaims,
      entities: uniqueEntities,
      relationships: allRelationships,
    };
  }
}
