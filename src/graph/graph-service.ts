/**
 * Graph Service - High-level API for knowledge graph operations
 *
 * Combines EntityStore and RelationshipStore for:
 * - Entity and relationship management
 * - Graph traversal
 * - Entity extraction from claims
 * - Statistics and analysis
 */

import type { Database } from "../core/database.js";
import type { Claim, ClaimEntity } from "../types.js";
import type {
  Entity,
  Relationship,
  EntityType,
  RelationshipType,
  EntityWithRelationships,
  GraphPath,
  GraphStats,
  ExtractedEntity,
  InferredRelationship,
} from "./types.js";
import { EntityStore, createEntityStore } from "./entity-store.js";
import { RelationshipStore, createRelationshipStore } from "./relationship-store.js";

/**
 * Map claim entity types to graph entity types
 */
function mapClaimEntityType(type: ClaimEntity["type"]): EntityType {
  const mapping: Record<ClaimEntity["type"], EntityType> = {
    file: "file",
    function: "function",
    class: "class",
    component: "component",
    command: "command",
    package: "package",
    test: "test",
    error: "error",
  };
  return mapping[type] || "file";
}

/**
 * Infer relationship type from claim type
 */
function inferRelationshipType(claimType: string): RelationshipType | null {
  const mapping: Record<string, RelationshipType> = {
    file_created: "CREATED_BY",
    file_modified: "MODIFIED_BY",
    code_added: "CONTAINS",
    dependency_added: "DEPENDS_ON",
    test_passed: "TESTS",
    test_failed: "TESTS",
    error_fixed: "FIXES",
  };
  return mapping[claimType] || null;
}

/**
 * Graph Service for managing the knowledge graph
 */
export class GraphService {
  private db: Database;
  private entityStore: EntityStore;
  private relationshipStore: RelationshipStore;

  constructor(db: Database) {
    this.db = db;
    this.entityStore = createEntityStore(db);
    this.relationshipStore = createRelationshipStore(db);
  }

  /**
   * Process a claim to extract entities and relationships
   */
  async processClaim(claim: Claim): Promise<{
    entities: Entity[];
    relationships: Relationship[];
  }> {
    const entities: Entity[] = [];
    const relationships: Relationship[] = [];

    // Extract entities from claim
    for (const claimEntity of claim.entities) {
      const entity = await this.entityStore.create({
        sessionId: claim.session_id,
        type: mapClaimEntityType(claimEntity.type),
        name: claimEntity.value,
        metadata: {
          sourceClaimId: claim.claim_id,
          claimType: claim.claim_type,
        },
      });
      entities.push(entity);
    }

    // Infer relationships between entities
    if (entities.length >= 2) {
      const relType = inferRelationshipType(claim.claim_type);
      if (relType) {
        // Create relationship between first two entities
        const relationship = await this.relationshipStore.create({
          sessionId: claim.session_id,
          fromEntityId: entities[0].entityId,
          toEntityId: entities[1].entityId,
          type: relType,
          sourceClaimId: claim.claim_id,
          confidence: claim.confidence,
        });
        relationships.push(relationship);
      }
    }

    // Special handling for file/function relationships
    if (entities.length >= 2) {
      const fileEntity = entities.find((e) => e.type === "file");
      const funcEntity = entities.find((e) => e.type === "function");

      if (fileEntity && funcEntity && claim.claim_type === "code_added") {
        const containsRel = await this.relationshipStore.create({
          sessionId: claim.session_id,
          fromEntityId: fileEntity.entityId,
          toEntityId: funcEntity.entityId,
          type: "CONTAINS",
          sourceClaimId: claim.claim_id,
          confidence: claim.confidence,
        });
        relationships.push(containsRel);
      }
    }

    return { entities, relationships };
  }

  /**
   * Get entity with all its relationships
   */
  async getEntityWithRelationships(entityId: string): Promise<EntityWithRelationships | null> {
    const entity = await this.entityStore.getById(entityId);
    if (!entity) return null;

    const { outgoing, incoming } = await this.relationshipStore.getForEntity(entityId);

    return { entity, outgoing, incoming };
  }

  /**
   * Find path between two entities (BFS)
   */
  async findPath(
    fromEntityId: string,
    toEntityId: string,
    maxDepth = 5
  ): Promise<GraphPath | null> {
    // BFS to find shortest path
    const queue: Array<{ entityId: string; path: string[]; edges: string[] }> = [
      { entityId: fromEntityId, path: [fromEntityId], edges: [] },
    ];
    const visited = new Set<string>([fromEntityId]);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.entityId === toEntityId) {
        // Found path - fetch full entities and relationships
        const nodes = await Promise.all(
          current.path.map((id) => this.entityStore.getById(id))
        );
        const edges = await Promise.all(
          current.edges.map((id) => this.relationshipStore.getById(id))
        );

        return {
          nodes: nodes.filter((n): n is Entity => n !== null),
          edges: edges.filter((e): e is Relationship => e !== null),
          depth: current.path.length - 1,
        };
      }

      if (current.path.length > maxDepth) continue;

      // Get neighbors
      const { outgoing, incoming } = await this.relationshipStore.getForEntity(current.entityId);

      for (const rel of outgoing) {
        if (!visited.has(rel.toEntityId)) {
          visited.add(rel.toEntityId);
          queue.push({
            entityId: rel.toEntityId,
            path: [...current.path, rel.toEntityId],
            edges: [...current.edges, rel.relationshipId],
          });
        }
      }

      for (const rel of incoming) {
        if (!visited.has(rel.fromEntityId)) {
          visited.add(rel.fromEntityId);
          queue.push({
            entityId: rel.fromEntityId,
            path: [...current.path, rel.fromEntityId],
            edges: [...current.edges, rel.relationshipId],
          });
        }
      }
    }

    return null; // No path found
  }

  /**
   * Get neighbors of an entity up to a certain depth
   */
  async getNeighbors(
    entityId: string,
    depth = 1
  ): Promise<Map<string, { entity: Entity; distance: number }>> {
    const result = new Map<string, { entity: Entity; distance: number }>();
    const queue: Array<{ entityId: string; distance: number }> = [
      { entityId, distance: 0 },
    ];
    const visited = new Set<string>([entityId]);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current.distance > 0) {
        const entity = await this.entityStore.getById(current.entityId);
        if (entity) {
          result.set(current.entityId, { entity, distance: current.distance });
        }
      }

      if (current.distance >= depth) continue;

      const { outgoing, incoming } = await this.relationshipStore.getForEntity(current.entityId);

      for (const rel of outgoing) {
        if (!visited.has(rel.toEntityId)) {
          visited.add(rel.toEntityId);
          queue.push({ entityId: rel.toEntityId, distance: current.distance + 1 });
        }
      }

      for (const rel of incoming) {
        if (!visited.has(rel.fromEntityId)) {
          visited.add(rel.fromEntityId);
          queue.push({ entityId: rel.fromEntityId, distance: current.distance + 1 });
        }
      }
    }

    return result;
  }

  /**
   * Get graph statistics for a session
   */
  async getStats(sessionId: string): Promise<GraphStats> {
    const totalEntities = await this.entityStore.count(sessionId);
    const totalRelationships = await this.relationshipStore.count(sessionId);

    // Count by entity type
    const entityTypeRows = await this.db.query<{ type: EntityType; count: number }>(
      `SELECT type, COUNT(*) as count FROM entities WHERE session_id = ? GROUP BY type`,
      [sessionId]
    );

    const byEntityType: Partial<Record<EntityType, number>> = {};
    for (const row of entityTypeRows) {
      byEntityType[row.type] = row.count;
    }

    // Count by relationship type
    const relTypeRows = await this.db.query<{ type: RelationshipType; count: number }>(
      `SELECT type, COUNT(*) as count FROM relationships WHERE session_id = ? GROUP BY type`,
      [sessionId]
    );

    const byRelationshipType: Partial<Record<RelationshipType, number>> = {};
    for (const row of relTypeRows) {
      byRelationshipType[row.type] = row.count;
    }

    const avgRelationshipsPerEntity =
      totalEntities > 0 ? totalRelationships / totalEntities : 0;

    return {
      totalEntities,
      totalRelationships,
      byEntityType: byEntityType as Record<EntityType, number>,
      byRelationshipType: byRelationshipType as Record<RelationshipType, number>,
      avgRelationshipsPerEntity,
    };
  }

  /**
   * Search entities by name
   */
  async searchEntities(sessionId: string, pattern: string): Promise<Entity[]> {
    return this.entityStore.search(sessionId, pattern);
  }

  /**
   * Find entity by name and type
   */
  async findEntity(
    sessionId: string,
    type: EntityType,
    name: string
  ): Promise<Entity | null> {
    return this.entityStore.findByName(sessionId, type, name);
  }

  /**
   * Get related entities of a specific type
   */
  async getRelatedByType(
    entityId: string,
    relationshipType: RelationshipType
  ): Promise<Entity[]> {
    const relationships = await this.relationshipStore.query({
      fromEntityId: entityId,
      type: relationshipType,
    });

    const entities: Entity[] = [];
    for (const rel of relationships) {
      const entity = await this.entityStore.getById(rel.toEntityId);
      if (entity) {
        entities.push(entity);
      }
    }

    return entities;
  }

  /**
   * Clear all graph data for a session
   */
  async clearSession(sessionId: string): Promise<void> {
    await this.relationshipStore.deleteBySession(sessionId);
    await this.entityStore.deleteBySession(sessionId);
  }

  /**
   * Get direct access to stores
   */
  getEntityStore(): EntityStore {
    return this.entityStore;
  }

  getRelationshipStore(): RelationshipStore {
    return this.relationshipStore;
  }
}

/**
 * Factory function to create a GraphService
 */
export function createGraphService(db: Database): GraphService {
  return new GraphService(db);
}
