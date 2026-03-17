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
  private db: import("better-sqlite3").Database | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private async getDb(): Promise<import("better-sqlite3").Database> {
    if (!this.db) {
      const BetterSqlite3 = (await import("better-sqlite3")).default;
      this.db = new BetterSqlite3(this.dbPath);
    }
    return this.db;
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    const db = await this.getDb();
    if (params && params.length > 0) {
      db.prepare(sql).run(...params);
    } else {
      db.exec(sql);
    }
  }

  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    const db = await this.getDb();
    if (params && params.length > 0) {
      return db.prepare(sql).all(...params) as T[];
    }
    return db.prepare(sql).all() as T[];
  }

  async insert<T extends Record<string, unknown>>(
    table: string,
    data: Partial<T>
  ): Promise<void> {
    const db = await this.getDb();
    const keys = Object.keys(data);
    const values = Object.values(data);
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
