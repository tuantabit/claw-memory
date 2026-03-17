
import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type {
  Claim,
  ClaimType,
  ClaimEntity,
  ClaimFilter,
  QueryOptions,
} from "../types.js";

export class ClaimStore {
  constructor(private db: Database) {}

  
  async create(
    sessionId: string,
    claimType: ClaimType,
    originalText: string,
    entities: ClaimEntity[],
    confidence: number,
    taskId?: string | null,
    responseId?: string | null
  ): Promise<Claim> {
    const claim: Claim = {
      claim_id: nanoid(),
      session_id: sessionId,
      task_id: taskId ?? null,
      response_id: responseId ?? null,
      claim_type: claimType,
      original_text: originalText,
      entities,
      confidence,
      created_at: new Date(),
    };

    await this.db.insert("claims", {
      claim_id: claim.claim_id,
      session_id: claim.session_id,
      task_id: claim.task_id,
      response_id: claim.response_id,
      claim_type: claim.claim_type,
      original_text: claim.original_text,
      entities: JSON.stringify(claim.entities),
      confidence: claim.confidence,
    });

    return claim;
  }

  
  async getById(claimId: string): Promise<Claim | null> {
    const rows = await this.db.query<Claim>(
      `SELECT * FROM claims WHERE claim_id = ?`,
      [claimId]
    );

    if (rows.length === 0) return null;

    return this.hydrate(rows[0]);
  }

  
  async getBySession(
    sessionId: string,
    options?: QueryOptions
  ): Promise<Claim[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const orderBy = options?.orderBy ?? "created_at";
    const orderDir = options?.orderDir ?? "desc";

    const rows = await this.db.query<Claim>(
      `SELECT * FROM claims
       WHERE session_id = ?
       ORDER BY ${orderBy} ${orderDir}
       LIMIT ? OFFSET ?`,
      [sessionId, limit, offset]
    );

    return rows.map((r) => this.hydrate(r));
  }

  
  async getByTask(taskId: string, options?: QueryOptions): Promise<Claim[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;

    const rows = await this.db.query<Claim>(
      `SELECT * FROM claims
       WHERE task_id = ?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [taskId, limit, offset]
    );

    return rows.map((r) => this.hydrate(r));
  }

  
  async getByFilter(
    filter: ClaimFilter,
    options?: QueryOptions
  ): Promise<Claim[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter.session_id) {
      conditions.push("session_id = ?");
      params.push(filter.session_id);
    }

    if (filter.task_id) {
      conditions.push("task_id = ?");
      params.push(filter.task_id);
    }

    if (filter.claim_type) {
      conditions.push("claim_type = ?");
      params.push(filter.claim_type);
    }

    if (filter.min_confidence !== undefined) {
      conditions.push("confidence >= ?");
      params.push(filter.min_confidence);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const limit = options?.limit ?? 100;
    const offset = options?.offset ?? 0;
    const orderBy = options?.orderBy ?? "created_at";
    const orderDir = options?.orderDir ?? "desc";

    params.push(limit, offset);

    const rows = await this.db.query<Claim>(
      `SELECT * FROM claims
       ${whereClause}
       ORDER BY ${orderBy} ${orderDir}
       LIMIT ? OFFSET ?`,
      params
    );

    return rows.map((r) => this.hydrate(r));
  }

  
  async getUnverified(sessionId: string, limit = 50): Promise<Claim[]> {
    const rows = await this.db.query<Claim>(
      `SELECT c.* FROM claims c
       LEFT JOIN verifications v ON c.claim_id = v.claim_id
       WHERE c.session_id = ? AND v.verification_id IS NULL
       ORDER BY c.created_at DESC
       LIMIT ?`,
      [sessionId, limit]
    );

    return rows.map((r) => this.hydrate(r));
  }

  
  async getByType(
    sessionId: string,
    claimType: ClaimType,
    limit = 50
  ): Promise<Claim[]> {
    const rows = await this.db.query<Claim>(
      `SELECT * FROM claims
       WHERE session_id = ? AND claim_type = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [sessionId, claimType, limit]
    );

    return rows.map((r) => this.hydrate(r));
  }

  
  async countBySession(sessionId: string): Promise<number> {
    const rows = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM claims WHERE session_id = ?`,
      [sessionId]
    );

    return Number(rows[0]?.count ?? 0);
  }

  
  async getStats(sessionId: string): Promise<{
    total: number;
    by_type: Record<string, number>;
    by_confidence: { high: number; medium: number; low: number };
  }> {
    const total = await this.countBySession(sessionId);

    const byType = await this.db.query<{ claim_type: string; count: number }>(
      `SELECT claim_type, COUNT(*) as count
       FROM claims
       WHERE session_id = ?
       GROUP BY claim_type`,
      [sessionId]
    );

    const byConfidence = await this.db.query<{
      level: string;
      count: number;
    }>(
      `SELECT
         CASE
           WHEN confidence >= 0.8 THEN 'high'
           WHEN confidence >= 0.5 THEN 'medium'
           ELSE 'low'
         END as level,
         COUNT(*) as count
       FROM claims
       WHERE session_id = ?
       GROUP BY level`,
      [sessionId]
    );

    const confMap = { high: 0, medium: 0, low: 0 };
    for (const row of byConfidence) {
      confMap[row.level as keyof typeof confMap] = Number(row.count);
    }

    return {
      total,
      by_type: Object.fromEntries(
        byType.map((r) => [r.claim_type, Number(r.count)])
      ),
      by_confidence: confMap,
    };
  }

  
  async search(sessionId: string, query: string, limit = 20): Promise<Claim[]> {
    const rows = await this.db.query<Claim>(
      `SELECT * FROM claims
       WHERE session_id = ? AND original_text LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [sessionId, `%${query}%`, limit]
    );

    return rows.map((r) => this.hydrate(r));
  }

  async searchFTS(
    query: string,
    options?: {
      sessionId?: string;
      claimType?: ClaimType;
      limit?: number;
      offset?: number;
    }
  ): Promise<Claim[]> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (options?.sessionId) {
      conditions.push("session_id = ?");
      params.push(options.sessionId);
    }

    if (options?.claimType) {
      conditions.push("claim_type = ?");
      params.push(options.claimType);
    }

    conditions.push("original_text LIKE ?");
    params.push(`%${query}%`);

    const whereClause = conditions.join(" AND ");
    params.push(limit, offset);

    const rows = await this.db.query<Claim>(
      `SELECT * FROM claims
       WHERE ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      params
    );

    return rows.map((r) => this.hydrate(r));
  }

  
  async getSearchSuggestions(
    prefix: string,
    limit = 10
  ): Promise<{ text: string; count: number }[]> {
    const rows = await this.db.query<{ text: string; count: number }>(
      `SELECT original_text as text, COUNT(*) as count
       FROM claims
       WHERE original_text LIKE ?
       GROUP BY original_text
       ORDER BY count DESC
       LIMIT ?`,
      [`${prefix}%`, limit]
    );

    return rows;
  }

  
  async delete(claimId: string): Promise<void> {
    await this.db.execute(`DELETE FROM claims WHERE claim_id = ?`, [claimId]);
  }

  
  private hydrate(row: Claim): Claim {
    return {
      ...row,
      entities:
        typeof row.entities === "string"
          ? JSON.parse(row.entities)
          : row.entities ?? [],
      created_at: new Date(row.created_at),
    };
  }
}
