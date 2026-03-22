/**
 * Vector Store - Stores and retrieves vector embeddings
 *
 * Stores embeddings in SQLite as BLOBs for persistence.
 * Performs similarity search by loading vectors and computing cosine similarity.
 *
 * For large-scale deployments, consider using sqlite-vec or sqlite-vss extensions.
 */

import { nanoid } from "nanoid";
import type { Database } from "../core/database.js";
import type {
  Embedding,
  StoredVector,
  SimilarityResult,
  VectorSearchOptions,
  VectorStoreStats,
} from "./types.js";
import { DEFAULT_VECTOR_SEARCH_OPTIONS } from "./types.js";
import { cosineSimilarity } from "./embedding-service.js";

/**
 * Vector Store for storing and querying embeddings
 */
export class VectorStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Store a vector embedding for a memory entry
   *
   * @param memoryId - ID of the memory entry
   * @param sessionId - Session ID
   * @param embedding - Vector embedding
   * @param model - Model name used to create embedding
   * @returns Vector ID
   */
  async store(
    memoryId: string,
    sessionId: string,
    embedding: Embedding,
    model: string
  ): Promise<string> {
    const vectorId = nanoid();

    // Convert Float32Array to Buffer for SQLite BLOB storage
    const embeddingBuffer = Buffer.from(embedding.buffer);

    await this.db.execute(
      `INSERT INTO memory_vectors (vector_id, memory_id, session_id, embedding, embedding_model, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [vectorId, memoryId, sessionId, embeddingBuffer, model, new Date().toISOString()]
    );

    return vectorId;
  }

  /**
   * Get vector by memory ID
   */
  async getByMemoryId(memoryId: string): Promise<StoredVector | null> {
    const rows = await this.db.query<{
      vector_id: string;
      memory_id: string;
      session_id: string;
      embedding: Buffer;
      embedding_model: string;
      created_at: string;
    }>(
      `SELECT vector_id, memory_id, session_id, embedding, embedding_model, created_at
       FROM memory_vectors WHERE memory_id = ?`,
      [memoryId]
    );

    if (rows.length === 0) return null;

    const row = rows[0];
    return {
      vectorId: row.vector_id,
      memoryId: row.memory_id,
      sessionId: row.session_id,
      embedding: this.bufferToEmbedding(row.embedding),
      embeddingModel: row.embedding_model,
      createdAt: new Date(row.created_at),
    };
  }

  /**
   * Search for similar vectors using cosine similarity
   *
   * @param queryEmbedding - Query vector
   * @param options - Search options
   * @returns Sorted array of similar memory IDs with similarity scores
   */
  async search(
    queryEmbedding: Embedding,
    options?: Partial<VectorSearchOptions>
  ): Promise<SimilarityResult[]> {
    const opts = { ...DEFAULT_VECTOR_SEARCH_OPTIONS, ...options };

    // Build query based on options
    let query = `SELECT vector_id, memory_id, session_id, embedding FROM memory_vectors`;
    const params: unknown[] = [];

    if (opts.sessionId) {
      query += ` WHERE session_id = ?`;
      params.push(opts.sessionId);
    }

    const rows = await this.db.query<{
      vector_id: string;
      memory_id: string;
      session_id: string;
      embedding: Buffer;
    }>(query, params);

    // Calculate similarities
    const results: SimilarityResult[] = [];

    for (const row of rows) {
      const embedding = this.bufferToEmbedding(row.embedding);
      const similarity = cosineSimilarity(queryEmbedding, embedding);

      if (similarity >= opts.minSimilarity) {
        results.push({
          memoryId: row.memory_id,
          similarity,
          distance: 1 - similarity,
        });
      }
    }

    // Sort by similarity (highest first) and limit
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, opts.limit);
  }

  /**
   * Search within a session
   */
  async searchInSession(
    sessionId: string,
    queryEmbedding: Embedding,
    limit = 10
  ): Promise<SimilarityResult[]> {
    return this.search(queryEmbedding, { sessionId, limit });
  }

  /**
   * Delete vector by memory ID
   */
  async deleteByMemoryId(memoryId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM memory_vectors WHERE memory_id = ?`,
      [memoryId]
    );
  }

  /**
   * Delete all vectors for a session
   */
  async deleteBySession(sessionId: string): Promise<void> {
    await this.db.execute(
      `DELETE FROM memory_vectors WHERE session_id = ?`,
      [sessionId]
    );
  }

  /**
   * Get statistics about stored vectors
   */
  async getStats(): Promise<VectorStoreStats> {
    // Total count
    const countResult = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM memory_vectors`
    );
    const totalVectors = countResult[0]?.count ?? 0;

    // Count by session
    const sessionCounts = await this.db.query<{
      session_id: string;
      count: number;
    }>(
      `SELECT session_id, COUNT(*) as count FROM memory_vectors GROUP BY session_id`
    );

    const bySession: Record<string, number> = {};
    for (const row of sessionCounts) {
      bySession[row.session_id] = row.count;
    }

    // Count by model
    const modelCounts = await this.db.query<{
      embedding_model: string;
      count: number;
    }>(
      `SELECT embedding_model, COUNT(*) as count FROM memory_vectors GROUP BY embedding_model`
    );

    const modelCountsMap: Record<string, number> = {};
    for (const row of modelCounts) {
      modelCountsMap[row.embedding_model] = row.count;
    }

    // Get one vector to determine dimension
    let avgDimension = 0;
    if (totalVectors > 0) {
      const sampleRow = await this.db.query<{ embedding: Buffer }>(
        `SELECT embedding FROM memory_vectors LIMIT 1`
      );
      if (sampleRow.length > 0 && sampleRow[0].embedding) {
        avgDimension = sampleRow[0].embedding.length / 4; // Float32 = 4 bytes
      }
    }

    return {
      totalVectors,
      bySession,
      avgDimension,
      modelCounts: modelCountsMap,
    };
  }

  /**
   * Check if vector exists for memory
   */
  async exists(memoryId: string): Promise<boolean> {
    const result = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM memory_vectors WHERE memory_id = ?`,
      [memoryId]
    );
    return (result[0]?.count ?? 0) > 0;
  }

  /**
   * Update vector for existing memory
   */
  async update(
    memoryId: string,
    embedding: Embedding,
    model: string
  ): Promise<void> {
    const embeddingBuffer = Buffer.from(embedding.buffer);

    await this.db.execute(
      `UPDATE memory_vectors SET embedding = ?, embedding_model = ? WHERE memory_id = ?`,
      [embeddingBuffer, model, memoryId]
    );
  }

  /**
   * Convert Buffer to Float32Array embedding
   */
  private bufferToEmbedding(buffer: Buffer): Embedding {
    // Create a new ArrayBuffer and copy data
    const arrayBuffer = new ArrayBuffer(buffer.length);
    const view = new Uint8Array(arrayBuffer);
    for (let i = 0; i < buffer.length; i++) {
      view[i] = buffer[i];
    }
    return new Float32Array(arrayBuffer);
  }
}

/**
 * Factory function to create a VectorStore
 */
export function createVectorStore(db: Database): VectorStore {
  return new VectorStore(db);
}
