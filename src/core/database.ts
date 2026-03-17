import { DatabaseSync } from "node:sqlite";

type SqlValue = string | number | bigint | Buffer | null;
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface Database {
  execute(sql: string, params?: unknown[]): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  insert<T extends Record<string, unknown>>(
    table: string,
    data: Partial<T>
  ): Promise<void>;
  close(): Promise<void>;
}

export class SQLiteDatabase implements Database {
  private db: DatabaseSync | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private getDb(): DatabaseSync {
    if (!this.db) {
      if (this.dbPath !== ":memory:") {
        mkdirSync(dirname(this.dbPath), { recursive: true });
      }
      this.db = new DatabaseSync(this.dbPath);
      this.db.exec("PRAGMA journal_mode = WAL");
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

export function createDatabase(dbPath: string): Database {
  return new SQLiteDatabase(dbPath);
}

export function getDefaultDbPath(): string {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  return `${homeDir}/.openclaw/veridic-claw.db`;
}
