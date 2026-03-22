/**
 * Re-export database from @openclaw/memory-core
 */

export type { Database, SqlValue } from "memory-core";
export {
  SQLiteDatabase,
  createDatabase,
  getDefaultDbPath,
} from "memory-core";
