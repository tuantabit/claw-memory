/**
 * @module memory
 * @description Vector-based semantic memory for similarity search
 *
 * Enables semantic search across memories without exact keyword matching.
 * Uses hash-based local embeddings (128 dimensions) for efficient storage.
 *
 * Flow:
 * ```
 * Text -> EmbeddingService.embed() -> Float32Array[128]
 *                                           |
 *                                    VectorStore.store()
 *                                           |
 *                                      SQLite BLOB
 *                                           |
 * Query -> embed() -> VectorStore.search() -> Cosine Similarity -> Results
 * ```
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

export * from "./types.js";
export * from "./embedding-service.js";
export * from "./vector-store.js";
