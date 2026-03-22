/**
 * @module graph
 * @description Knowledge graph for entity relationships
 *
 * Re-exports from @openclaw/memory-core with plugin-specific extensions
 * for development entity types and claim processing.
 *
 * @example
 * ```typescript
 * import { createGraphService, DEV_ENTITY_TYPES } from './graph';
 *
 * const graph = createGraphService(db);
 *
 * // Use dev-specific entity types
 * const entity = await graph.getEntityStore().create({
 *   sessionId,
 *   type: 'file',
 *   name: 'src/index.ts'
 * });
 *
 * // Find path between entities
 * const path = await graph.findPath(entityA.entityId, entityB.entityId);
 * ```
 */

// Re-export types from core
export type {
  Entity,
  Relationship,
  EntityWithRelationships,
  GraphPath,
  EntityQueryOptions,
  RelationshipQueryOptions,
  GraphStats,
  CreateEntityInput,
  CreateRelationshipInput,
  ExtractedEntity,
  InferredRelationship,
} from "memory-core";

// Re-export implementations from core
export {
  EntityStore,
  createEntityStore,
  RelationshipStore,
  createRelationshipStore,
  GraphService,
  createGraphService,
} from "memory-core";

// ============================================
// Plugin-Specific: Development Entity Types
// ============================================

/**
 * Entity types for development context
 */
export const DEV_ENTITY_TYPES = [
  "file",
  "function",
  "class",
  "component",
  "command",
  "package",
  "test",
  "error",
] as const;

export type DevEntityType = (typeof DEV_ENTITY_TYPES)[number];

/**
 * Relationship types for development context
 */
export const DEV_RELATIONSHIP_TYPES = [
  "CONTAINS", // File contains function/class
  "IMPORTS", // File imports from another file
  "DEPENDS_ON", // Package depends on another package
  "CALLS", // Function calls another function
  "TESTS", // Test tests a function/file
  "FIXES", // Fix resolves an error
  "CREATED_BY", // Entity created by action
  "MODIFIED_BY", // Entity modified by action
] as const;

export type DevRelationshipType = (typeof DEV_RELATIONSHIP_TYPES)[number];

/**
 * Legacy type alias for backward compatibility
 */
export type EntityType = DevEntityType;
export type RelationshipType = DevRelationshipType;
