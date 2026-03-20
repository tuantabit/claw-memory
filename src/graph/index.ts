/**
 * @module graph
 * @description Knowledge graph for entity relationships
 *
 * Tracks entities (files, functions, tests, etc.) and their relationships.
 * Supports path finding between entities using BFS traversal.
 *
 * Entity Types:
 * - file, function, class, component, command, package, test, error
 *
 * Relationship Types:
 * - CONTAINS: file contains function
 * - IMPORTS: file imports another
 * - DEPENDS_ON: package depends on another
 * - CALLS: function calls another
 * - TESTS: test tests a function
 * - FIXES: fix resolves an error
 *
 * @example
 * ```typescript
 * import { createGraphService } from './graph';
 *
 * const graph = createGraphService(db);
 *
 * // Process a claim to extract entities and relationships
 * const { entities, relationships } = await graph.processClaim(claim);
 *
 * // Find path between entities
 * const path = await graph.findPath(entityA.entityId, entityB.entityId);
 *
 * // Get neighbors within 2 hops
 * const neighbors = await graph.getNeighbors(entityId, 2);
 * ```
 */

export * from "./types.js";
export * from "./entity-store.js";
export * from "./relationship-store.js";
export * from "./graph-service.js";
