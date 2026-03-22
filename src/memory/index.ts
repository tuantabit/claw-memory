/**
 * @module memory
 * @description Vector-based semantic memory for similarity search
 *
 * Re-exports from @openclaw/memory-core with plugin-specific extensions.
 *
 * @example
 * ```typescript
 * import { createEmbeddingService, createVectorStore } from './memory';
 *
 * const embedder = createEmbeddingService();
 * const store = createVectorStore(db);
 *
 * // Store a memory
 * const embedding = await embedder.embed("Created authentication service");
 * await store.store(memoryId, sessionId, embedding, "local");
 *
 * // Search semantically
 * const queryEmbed = await embedder.embed("auth login");
 * const results = await store.search(queryEmbed, { limit: 5 });
 * ```
 */

// Re-export types from core
export type {
  Embedding,
  EmbeddingConfig,
  EmbeddingResult,
  StoredVector,
  SimilarityResult,
  VectorSearchOptions,
  VectorStoreStats,
  EmbeddingService,
} from "memory-core";

// Re-export implementations from core
export {
  DEFAULT_EMBEDDING_CONFIG,
  DEFAULT_VECTOR_SEARCH_OPTIONS,
  LocalEmbeddingService,
  cosineSimilarity,
  euclideanDistance,
  createEmbeddingService,
  VectorStore,
  createVectorStore,
} from "memory-core";
