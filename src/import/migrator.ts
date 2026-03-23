/**
 * History Migrator - Orchestrate import of OpenClaw history into claw-memory
 */

import { nanoid } from "nanoid";
import { SessionScanner } from "./scanner.js";
import { HistoryExtractor } from "./extractor.js";
import type {
  MigrationResult,
  MigrationMeta,
  ImportedClaim,
  ImportedEntity,
  ImportedRelationship,
} from "./types.js";
import type { Database } from "../core/database.js";

const MIGRATION_SCHEMA = `
CREATE TABLE IF NOT EXISTS migration_meta (
    id TEXT PRIMARY KEY,
    migrated_at INTEGER NOT NULL,
    source_path TEXT NOT NULL,
    stats TEXT NOT NULL
);
`;

const ADD_SOURCE_COLUMN = `
ALTER TABLE claims ADD COLUMN source TEXT DEFAULT 'realtime';
`;

export class HistoryMigrator {
  private db: Database;
  private scanner: SessionScanner;
  private extractor: HistoryExtractor;
  private openclawDir: string;

  constructor(db: Database, openclawDir?: string) {
    this.db = db;
    this.openclawDir = openclawDir || `${process.env.HOME}/.openclaw`;
    this.scanner = new SessionScanner(this.openclawDir);
    this.extractor = new HistoryExtractor();
  }

  async hasMigrated(): Promise<boolean> {
    try {
      const result = await this.db.query<{ count: number }>(
        "SELECT COUNT(*) as count FROM migration_meta"
      );
      return result.length > 0 && result[0].count > 0;
    } catch {
      return false;
    }
  }

  async getMigrationMeta(): Promise<MigrationMeta | null> {
    try {
      const results = await this.db.query<{
        id: string;
        migrated_at: number;
        source_path: string;
        stats: string;
      }>("SELECT * FROM migration_meta ORDER BY migrated_at DESC LIMIT 1");

      if (results.length === 0) return null;

      const row = results[0];
      return {
        id: row.id,
        migratedAt: row.migrated_at,
        sourcePath: row.source_path,
        stats: JSON.parse(row.stats),
      };
    } catch {
      return null;
    }
  }

  private async initMigrationSchema(): Promise<void> {
    await this.db.execute(MIGRATION_SCHEMA);

    try {
      await this.db.execute(ADD_SOURCE_COLUMN);
    } catch {
      // Column already exists
    }
  }

  async migrate(options?: {
    force?: boolean;
    skipEmbeddings?: boolean;
  }): Promise<MigrationResult> {
    const startTime = Date.now();
    const stats: MigrationResult["stats"] = {
      sessionsScanned: 0,
      messagesProcessed: 0,
      claimsExtracted: 0,
      entitiesExtracted: 0,
      relationshipsCreated: 0,
      embeddingsGenerated: 0,
      errors: 0,
    };

    try {
      await this.initMigrationSchema();

      if (!options?.force && (await this.hasMigrated())) {
        console.log("  Migration already completed. Use --force to re-run.");
        const meta = await this.getMigrationMeta();
        return {
          success: true,
          stats: meta?.stats || stats,
          duration: 0,
        };
      }

      console.log("  Starting migration...");

      console.log("  [1/4] Scanning session files...");
      const sessions = this.scanner.scanAndParseAll();
      stats.sessionsScanned = sessions.length;

      if (sessions.length === 0) {
        console.log("  No sessions found to import.");
        return {
          success: true,
          stats,
          duration: Date.now() - startTime,
        };
      }

      for (const session of sessions) {
        stats.messagesProcessed += session.messages.length;
      }
      console.log(`  Found ${stats.messagesProcessed} messages`);

      console.log("  [2/4] Extracting claims and entities...");
      const { claims, entities, relationships } =
        this.extractor.extractFromSessions(sessions);

      stats.claimsExtracted = claims.length;
      stats.entitiesExtracted = entities.length;
      stats.relationshipsCreated = relationships.length;

      console.log("  [3/4] Storing to database...");
      await this.storeClaims(claims);
      await this.storeEntities(entities);
      await this.storeRelationships(relationships);

      console.log("  [4/4] Recording migration...");
      await this.recordMigration(stats);

      const duration = Date.now() - startTime;
      console.log(`  Migration completed in ${duration}ms`);

      return {
        success: true,
        stats,
        duration,
      };
    } catch (error) {
      stats.errors++;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      console.error(`  Migration failed: ${errorMessage}`);

      return {
        success: false,
        stats,
        duration: Date.now() - startTime,
        error: errorMessage,
      };
    }
  }

  private async storeClaims(claims: ImportedClaim[]): Promise<void> {
    let stored = 0;

    for (const claim of claims) {
      try {
        const claimId = nanoid();
        await this.db.execute(
          `INSERT OR IGNORE INTO claims
           (claim_id, session_id, claim_type, original_text, confidence, created_at, source)
           VALUES (?, ?, ?, ?, ?, datetime(?, 'unixepoch'), 'import')`,
          [
            claimId,
            claim.sessionId,
            claim.type,
            claim.content,
            0.8,
            Math.floor(claim.timestamp / 1000),
          ]
        );
        stored++;
      } catch {
        continue;
      }
    }

    console.log(`    Stored ${stored}/${claims.length} claims`);
  }

  private async storeEntities(entities: ImportedEntity[]): Promise<void> {
    let stored = 0;

    for (const entity of entities) {
      try {
        const entityId = nanoid();
        await this.db.execute(
          `INSERT OR IGNORE INTO entities
           (entity_id, entity_type, name, first_seen_at, last_seen_at, occurrence_count)
           VALUES (?, ?, ?, datetime(?, 'unixepoch'), datetime(?, 'unixepoch'), 1)`,
          [
            entityId,
            entity.type,
            entity.name,
            Math.floor(entity.firstSeenAt / 1000),
            Math.floor(entity.firstSeenAt / 1000),
          ]
        );
        stored++;
      } catch {
        try {
          await this.db.execute(
            `UPDATE entities SET occurrence_count = occurrence_count + 1
             WHERE entity_type = ? AND name = ?`,
            [entity.type, entity.name]
          );
        } catch {
          // Ignore
        }
      }
    }

    console.log(`    Stored ${stored}/${entities.length} entities`);
  }

  private async storeRelationships(
    relationships: ImportedRelationship[]
  ): Promise<void> {
    let stored = 0;

    for (const rel of relationships) {
      try {
        const relationshipId = nanoid();
        await this.db.execute(
          `INSERT OR IGNORE INTO relationships
           (relationship_id, from_entity_id, to_entity_id, relationship_type, confidence, observation_count)
           VALUES (?, ?, ?, ?, ?, 1)`,
          [relationshipId, rel.fromEntity, rel.toEntity, rel.type, 0.8]
        );
        stored++;
      } catch {
        continue;
      }
    }

    console.log(`    Stored ${stored}/${relationships.length} relationships`);
  }

  private async recordMigration(
    stats: MigrationResult["stats"]
  ): Promise<void> {
    const id = nanoid();
    const now = Date.now();

    await this.db.execute(
      `INSERT INTO migration_meta (id, migrated_at, source_path, stats)
       VALUES (?, ?, ?, ?)`,
      [id, now, this.openclawDir, JSON.stringify(stats)]
    );
  }

  getStats(): ReturnType<SessionScanner["getStats"]> {
    return this.scanner.getStats();
  }
}
