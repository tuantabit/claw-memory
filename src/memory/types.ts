/**
 * Types for Vector Search (Semantic Memory)
 *
 * Vector search allows finding memories by meaning, not just keywords.
 * Text -> Embedding (numbers) -> Cosine Similarity -> Similar results
 */

/**
 * A vector embedding - array of numbers representing text meaning
 */
export type Embedding = Float32Array;

/**
 * Configuration for embedding service
 */
export interface EmbeddingConfig {
  /** Number of dimensions in embedding vectors */
  dimension: number;

  /** Model name for tracking */
  modelName: string;

  /** Whether to normalize vectors */
  normalize: boolean;
}

/**
 * Default embedding configuration
 * Uses 128 dimensions for lightweight local embedding
 */
export const DEFAULT_EMBEDDING_CONFIG: EmbeddingConfig = {
  dimension: 128,
  modelName: "local-hash",
  normalize: true,
};

/**
 * Result of embedding a text
 */
export interface EmbeddingResult {
  text: string;
  embedding: Embedding;
  model: string;
  createdAt: Date;
}

/**
 * Stored vector in database
 */
export interface StoredVector {
  vectorId: string;
  memoryId: string;
  sessionId: string;
  embedding: Embedding;
  embeddingModel: string;
  createdAt: Date;
}

/**
 * Result of similarity search
 */
export interface SimilarityResult {
  memoryId: string;
  similarity: number; // 0.0 - 1.0
  distance: number;   // Lower is more similar
}

/**
 * Options for vector search
 */
export interface VectorSearchOptions {
  /** Maximum results to return */
  limit: number;

  /** Minimum similarity threshold (0.0 - 1.0) */
  minSimilarity: number;

  /** Filter by session */
  sessionId?: string;
}

/**
 * Default vector search options
 */
export const DEFAULT_VECTOR_SEARCH_OPTIONS: VectorSearchOptions = {
  limit: 10,
  minSimilarity: 0.5,
};

/**
 * Statistics for vector store
 */
export interface VectorStoreStats {
  totalVectors: number;
  bySession: Record<string, number>;
  avgDimension: number;
  modelCounts: Record<string, number>;
}
