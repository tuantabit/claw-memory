/**
 * SQLite database adapter using Node.js built-in sqlite module
 *
 * Requires Node.js 22.5.0+ for the node:sqlite module
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** SQLite-compatible value types */
type SqlValue = string | number | bigint | Buffer | null;

/**
 * Database interface for persistence operations
 */
export interface Database {
  /** Execute a SQL statement (INSERT, UPDATE, DELETE, CREATE, etc.) */
  execute(sql: string, params?: unknown[]): Promise<void>;

  /** Query rows from the database */
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;

  /** Insert a record into a table */
  insert<T extends Record<string, unknown>>(
    table: string,
    data: Partial<T>
  ): Promise<void>;

  /** Close the database connection */
  close(): Promise<void>;
}

/**
 * SQLite database implementation using node:sqlite
 *
 * @example
 * ```typescript
 * const db = new SQLiteDatabase(":memory:");
 * await db.execute("CREATE TABLE test (id INTEGER PRIMARY KEY)");
 * await db.insert("test", { id: 1 });
 * const rows = await db.query("SELECT * FROM test");
 * ```
 */
export class SQLiteDatabase implements Database {
  private db: DatabaseSync | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  /**
   * Get or create the database connection
   * Creates parent directories if needed
   */
  private getDb(): DatabaseSync {
    if (!this.db) {
      // Create parent directories for file-based databases
      if (this.dbPath !== ":memory:") {
        mkdirSync(dirname(this.dbPath), { recursive: true });
      }

      this.db = new DatabaseSync(this.dbPath);

      // Enable WAL mode for better concurrent access
      this.db.exec("PRAGMA journal_mode = WAL");

      // Enable foreign key constraints
      this.db.exec("PRAGMA foreign_keys = ON");
    }
    return this.db;
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    const db = this.getDb();
    if (params && params.length > 0) {
      db.prepare(sql).run(...(params as SqlValue[]));
    } else {
      db.exec(sql);
    }
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const db = this.getDb();
    if (params && params.length > 0) {
      return db.prepare(sql).all(...(params as SqlValue[])) as T[];
    }
    return db.prepare(sql).all() as T[];
  }

  async insert<T extends Record<string, unknown>>(
    table: string,
    data: Partial<T>
  ): Promise<void> {
    const db = this.getDb();
    const keys = Object.keys(data);
    const values = Object.values(data) as SqlValue[];
    const placeholders = keys.map(() => "?").join(", ");
    const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`;
    db.prepare(sql).run(...values);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

/**
 * Factory function to create a database instance
 */
export function createDatabase(dbPath: string): Database {
  return new SQLiteDatabase(dbPath);
}

/**
 * Get the default database path (~/.openclaw/claw-memory.db)
 */
export function getDefaultDbPath(): string {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return `${homeDir}/.openclaw/claw-memory.db`;
}
