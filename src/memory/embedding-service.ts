/**
 * Embedding Service - Converts text to vector embeddings
 *
 * Implements a lightweight local embedding using hash trick + TF-IDF style features.
 * No external API required - runs entirely locally.
 *
 * For production use with better semantic understanding, can be extended to use:
 * - OpenAI text-embedding-3-small
 * - Local transformer models via Xenova/transformers
 */

import type { Embedding, EmbeddingConfig, EmbeddingResult } from "./types.js";
import { DEFAULT_EMBEDDING_CONFIG } from "./types.js";

/**
 * Interface for embedding services
 */
export interface EmbeddingService {
  /** Embed a single text */
  embed(text: string): Promise<Embedding>;

  /** Embed multiple texts */
  embedBatch(texts: string[]): Promise<Embedding[]>;

  /** Get configuration */
  getConfig(): EmbeddingConfig;

  /** Get model name */
  getModelName(): string;
}

/**
 * Local embedding service using hash trick
 *
 * Creates embeddings by:
 * 1. Tokenizing text into words
 * 2. Hashing words to fixed positions in vector
 * 3. Applying TF-IDF-like weighting
 * 4. Normalizing the final vector
 *
 * This is a lightweight approach suitable for:
 * - Fast local execution
 * - No external dependencies
 * - Reasonable semantic similarity for short texts
 */
export class LocalEmbeddingService implements EmbeddingService {
  private config: EmbeddingConfig;

  constructor(config?: Partial<EmbeddingConfig>) {
    this.config = { ...DEFAULT_EMBEDDING_CONFIG, ...config };
  }

  /**
   * Embed a single text
   */
  async embed(text: string): Promise<Embedding> {
    const embedding = new Float32Array(this.config.dimension);

    // Tokenize text
    const tokens = this.tokenize(text);

    // Build term frequency map
    const termFreq = new Map<string, number>();
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) || 0) + 1);
    }

    // Hash tokens to vector positions with TF weighting
    for (const [token, freq] of termFreq) {
      // Hash to multiple positions for better distribution
      const positions = this.hashToPositions(token, 3);
      const weight = 1 + Math.log(freq); // TF weight

      for (const pos of positions) {
        // Use sign from secondary hash to allow negative values
        const sign = this.hashSign(token + pos.toString());
        embedding[pos] += sign * weight;
      }
    }

    // Add n-gram features for better semantic capture
    this.addNgramFeatures(embedding, tokens);

    // Normalize if configured
    if (this.config.normalize) {
      this.normalize(embedding);
    }

    return embedding;
  }

  /**
   * Embed multiple texts in batch
   */
  async embedBatch(texts: string[]): Promise<Embedding[]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }

  /**
   * Get current configuration
   */
  getConfig(): EmbeddingConfig {
    return { ...this.config };
  }

  /**
   * Get model name
   */
  getModelName(): string {
    return this.config.modelName;
  }

  /**
   * Tokenize text into words
   */
  private tokenize(text: string): string[] {
    // Lowercase and split on non-word characters
    const words = text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1); // Remove single characters

    return words;
  }

  /**
   * Hash a string to multiple positions in the embedding
   */
  private hashToPositions(str: string, count: number): number[] {
    const positions: number[] = [];
    let hash = this.simpleHash(str);

    for (let i = 0; i < count; i++) {
      positions.push(Math.abs(hash) % this.config.dimension);
      hash = this.simpleHash(str + i.toString());
    }

    return positions;
  }

  /**
   * Get sign (+1 or -1) for a token
   */
  private hashSign(str: string): number {
    return this.simpleHash(str) % 2 === 0 ? 1 : -1;
  }

  /**
   * Simple hash function for strings
   */
  private simpleHash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 33) ^ str.charCodeAt(i);
    }
    return hash >>> 0; // Convert to unsigned
  }

  /**
   * Add bigram and trigram features
   */
  private addNgramFeatures(embedding: Embedding, tokens: string[]): void {
    // Bigrams
    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = tokens[i] + "_" + tokens[i + 1];
      const pos = Math.abs(this.simpleHash(bigram)) % this.config.dimension;
      const sign = this.hashSign(bigram);
      embedding[pos] += sign * 0.5; // Lower weight for n-grams
    }

    // Trigrams
    for (let i = 0; i < tokens.length - 2; i++) {
      const trigram = tokens[i] + "_" + tokens[i + 1] + "_" + tokens[i + 2];
      const pos = Math.abs(this.simpleHash(trigram)) % this.config.dimension;
      const sign = this.hashSign(trigram);
      embedding[pos] += sign * 0.25;
    }
  }

  /**
   * Normalize embedding to unit length
   */
  private normalize(embedding: Embedding): void {
    let norm = 0;
    for (let i = 0; i < embedding.length; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
    }
  }
}

/**
 * Calculate cosine similarity between two embeddings
 */
export function cosineSimilarity(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) {
    throw new Error("Embeddings must have same dimension");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (normA * normB);
}

/**
 * Calculate Euclidean distance between two embeddings
 */
export function euclideanDistance(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) {
    throw new Error("Embeddings must have same dimension");
  }

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }

  return Math.sqrt(sum);
}

/**
 * Factory function to create an embedding service
 */
export function createEmbeddingService(
  config?: Partial<EmbeddingConfig>
): EmbeddingService {
  return new LocalEmbeddingService(config);
}
