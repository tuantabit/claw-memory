/**
 * Types for Knowledge Graph
 *
 * Knowledge graph stores entities and their relationships.
 * Entity -> Relationship -> Entity
 *
 * Example:
 *   file:src/index.ts --CONTAINS--> function:main
 *   file:src/index.ts --IMPORTS--> file:src/utils.ts
 */

/**
 * Entity types that can be stored in the graph
 */
export type EntityType =
  | "file"
  | "function"
  | "class"
  | "component"
  | "command"
  | "package"
  | "test"
  | "error";

/**
 * Relationship types between entities
 */
export type RelationshipType =
  | "CONTAINS"      // File contains function/class
  | "IMPORTS"       // File imports from another file
  | "DEPENDS_ON"    // Package depends on another package
  | "CALLS"         // Function calls another function
  | "TESTS"         // Test tests a function/file
  | "FIXES"         // Fix resolves an error
  | "CREATED_BY"    // Entity created by action
  | "MODIFIED_BY";  // Entity modified by action

/**
 * An entity in the knowledge graph
 */
export interface Entity {
  entityId: string;
  sessionId: string;
  type: EntityType;
  name: string;
  normalizedName: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrenceCount: number;
  metadata?: Record<string, unknown>;
}

/**
 * A relationship between two entities
 */
export interface Relationship {
  relationshipId: string;
  sessionId: string;
  fromEntityId: string;
  toEntityId: string;
  type: RelationshipType;
  sourceClaimId?: string;
  confidence: number;
  firstObservedAt: Date;
  lastObservedAt: Date;
  observationCount: number;
  metadata?: Record<string, unknown>;
}

/**
 * Entity with its relationships
 */
export interface EntityWithRelationships {
  entity: Entity;
  outgoing: Relationship[];
  incoming: Relationship[];
}

/**
 * Graph traversal result
 */
export interface GraphPath {
  nodes: Entity[];
  edges: Relationship[];
  depth: number;
}

/**
 * Options for entity queries
 */
export interface EntityQueryOptions {
  sessionId?: string;
  type?: EntityType;
  limit?: number;
  offset?: number;
  orderBy?: "first_seen" | "last_seen" | "occurrence_count" | "name";
  orderDir?: "asc" | "desc";
}

/**
 * Options for relationship queries
 */
export interface RelationshipQueryOptions {
  sessionId?: string;
  type?: RelationshipType;
  fromEntityId?: string;
  toEntityId?: string;
  limit?: number;
}

/**
 * Statistics for the knowledge graph
 */
export interface GraphStats {
  totalEntities: number;
  totalRelationships: number;
  byEntityType: Record<EntityType, number>;
  byRelationshipType: Record<RelationshipType, number>;
  avgRelationshipsPerEntity: number;
}

/**
 * Input for creating an entity
 */
export interface CreateEntityInput {
  sessionId: string;
  type: EntityType;
  name: string;
  metadata?: Record<string, unknown>;
}

/**
 * Input for creating a relationship
 */
export interface CreateRelationshipInput {
  sessionId: string;
  fromEntityId: string;
  toEntityId: string;
  type: RelationshipType;
  sourceClaimId?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Result of entity extraction from text
 */
export interface ExtractedEntity {
  type: EntityType;
  name: string;
  confidence: number;
  position: { start: number; end: number };
}

/**
 * Result of relationship inference
 */
export interface InferredRelationship {
  fromEntity: ExtractedEntity;
  toEntity: ExtractedEntity;
  type: RelationshipType;
  confidence: number;
}
