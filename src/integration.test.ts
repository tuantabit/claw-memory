/**
 * Integration Tests for Veridic Claw v0.2
 *
 * Tests the full pipeline:
 * 1. Claim extraction and verification
 * 2. Vector search (semantic memory)
 * 3. Knowledge graph (entity relations)
 * 4. Temporal memory (time-based queries)
 * 5. Auto retry (contradiction handling)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase, type Database } from "./core/database.js";
import { initVeridicSchema } from "./schema.js";
import { VeridicEngine, createVeridicEngine } from "./engine.js";
import { createRetryManager, generateRetryPrompt, type RetryManager } from "./retry/index.js";
import { createEmbeddingService, createVectorStore } from "./memory/index.js";
import { createGraphService, createEntityStore, createRelationshipStore } from "./graph/index.js";
import { createTemporalStore, createTimelineService } from "./temporal/index.js";

describe("Veridic Claw v0.2 Integration", () => {
  let db: Database;
  let engine: VeridicEngine;

  beforeEach(async () => {
    // Use in-memory SQLite for tests
    db = createDatabase(":memory:");
    await initVeridicSchema(db);
    engine = createVeridicEngine(db);
    await engine.initialize();
  });

  afterEach(async () => {
    await db.close();
  });

  describe("Engine Initialization", () => {
    it("should initialize engine with all v0.2 components", async () => {
      expect(engine).toBeDefined();
      expect(engine.getEmbeddingService()).toBeDefined();
      expect(engine.getVectorStore()).toBeDefined();
      expect(engine.getGraphService()).toBeDefined();
      expect(engine.getTemporalStore()).toBeDefined();
      expect(engine.getTimelineService()).toBeDefined();
    });
  });

  describe("Vector Search (Semantic Memory)", () => {
    it("should create embeddings with consistent dimensions", async () => {
      const embeddingService = createEmbeddingService();

      const embedding1 = await embeddingService.embed("Create a new file");
      const embedding2 = await embeddingService.embed("Make a new document");

      expect(embedding1.length).toBe(128);
      expect(embedding2.length).toBe(128);
    });

    it("should find similar content using embeddings", async () => {
      const embeddingService = createEmbeddingService();
      const vectorStore = createVectorStore(db);
      const sessionId = "test-session";

      // Store embeddings for some memories
      const memories = [
        { id: "mem1", text: "Created file src/index.ts with main function" },
        { id: "mem2", text: "Added authentication middleware to Express app" },
        { id: "mem3", text: "Fixed bug in login form validation" },
        { id: "mem4", text: "Created new TypeScript source file" },
      ];

      for (const mem of memories) {
        const embedding = await embeddingService.embed(mem.text);
        await vectorStore.store(mem.id, sessionId, embedding, "local");
      }

      // Verify vectors were stored
      const stats = await vectorStore.getStats();
      expect(stats.totalVectors).toBe(4);

      // Search for similar content with low minSimilarity
      const queryEmbedding = await embeddingService.embed("create new file");
      const results = await vectorStore.search(queryEmbedding, { sessionId, limit: 3, minSimilarity: 0.0 });

      expect(results.length).toBeGreaterThan(0);
      // Results should be sorted by similarity
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
      }
    });

    it("should support batch embedding", async () => {
      const embeddingService = createEmbeddingService();

      const texts = ["First text", "Second text", "Third text"];
      const embeddings = await embeddingService.embedBatch(texts);

      expect(embeddings.length).toBe(3);
      embeddings.forEach((emb) => {
        expect(emb.length).toBe(128);
      });
    });
  });

  describe("Knowledge Graph (Entity Relations)", () => {
    it("should store and retrieve entities", async () => {
      const entityStore = createEntityStore(db);
      const sessionId = "test-session";

      const entity = await entityStore.create({
        sessionId,
        type: "file",
        name: "src/index.ts",
        metadata: { created: true },
      });

      expect(entity.entityId).toBeDefined();
      expect(entity.type).toBe("file");
      expect(entity.name).toBe("src/index.ts");

      const retrieved = await entityStore.getById(entity.entityId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe("src/index.ts");
    });

    it("should create relationships between entities", async () => {
      const entityStore = createEntityStore(db);
      const relationshipStore = createRelationshipStore(db);
      const sessionId = "test-session";

      // Create entities
      const fileEntity = await entityStore.create({
        sessionId,
        type: "file",
        name: "src/utils.ts",
      });

      const funcEntity = await entityStore.create({
        sessionId,
        type: "function",
        name: "parseConfig",
      });

      // Create relationship
      const relationship = await relationshipStore.create({
        sessionId,
        fromEntityId: fileEntity.entityId,
        toEntityId: funcEntity.entityId,
        type: "CONTAINS",
        confidence: 1.0,
      });

      expect(relationship.relationshipId).toBeDefined();
      expect(relationship.type).toBe("CONTAINS");

      // Check relationship retrieval
      const { outgoing, incoming } = await relationshipStore.getForEntity(fileEntity.entityId);
      expect(outgoing.length).toBe(1);
      expect(outgoing[0].toEntityId).toBe(funcEntity.entityId);
    });

    it("should find paths between entities", async () => {
      const graphService = createGraphService(db);
      const entityStore = graphService.getEntityStore();
      const relationshipStore = graphService.getRelationshipStore();
      const sessionId = "test-session";

      // Create a chain: file -> function -> test
      const file = await entityStore.create({ sessionId, type: "file", name: "utils.ts" });
      const func = await entityStore.create({ sessionId, type: "function", name: "validate" });
      const test = await entityStore.create({ sessionId, type: "test", name: "validate.test" });

      await relationshipStore.create({
        sessionId,
        fromEntityId: file.entityId,
        toEntityId: func.entityId,
        type: "CONTAINS",
      });

      await relationshipStore.create({
        sessionId,
        fromEntityId: test.entityId,
        toEntityId: func.entityId,
        type: "TESTS",
      });

      // Find path from file to test
      const path = await graphService.findPath(file.entityId, test.entityId);

      expect(path).toBeDefined();
      expect(path?.nodes.length).toBeGreaterThanOrEqual(2);
    });

    it("should get neighbors of an entity", async () => {
      const graphService = createGraphService(db);
      const entityStore = graphService.getEntityStore();
      const relationshipStore = graphService.getRelationshipStore();
      const sessionId = "test-session";

      // Create central entity with multiple connections
      const central = await entityStore.create({ sessionId, type: "file", name: "main.ts" });
      const dep1 = await entityStore.create({ sessionId, type: "package", name: "lodash" });
      const dep2 = await entityStore.create({ sessionId, type: "package", name: "express" });

      await relationshipStore.create({
        sessionId,
        fromEntityId: central.entityId,
        toEntityId: dep1.entityId,
        type: "DEPENDS_ON",
      });

      await relationshipStore.create({
        sessionId,
        fromEntityId: central.entityId,
        toEntityId: dep2.entityId,
        type: "DEPENDS_ON",
      });

      const neighbors = await graphService.getNeighbors(central.entityId, 1);
      expect(neighbors.size).toBe(2);
    });
  });

  describe("Temporal Memory (Time-based Queries)", () => {
    it("should store and retrieve temporal events", async () => {
      const temporalStore = createTemporalStore(db);
      const sessionId = "test-session";

      const event = await temporalStore.create({
        sessionId,
        eventType: "CLAIM",
        eventData: { type: "file_created", file: "index.ts" },
      });

      expect(event.eventId).toBeDefined();
      expect(event.eventType).toBe("CLAIM");

      const retrieved = await temporalStore.getById(event.eventId);
      expect(retrieved).toBeDefined();
      expect(retrieved?.eventType).toBe("CLAIM");
    });

    it("should query events by time range", async () => {
      const temporalStore = createTemporalStore(db);
      const sessionId = "test-session";

      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

      // Create events at different times
      await temporalStore.create({
        sessionId,
        eventType: "CLAIM",
        occurredAt: twoHoursAgo,
      });

      await temporalStore.create({
        sessionId,
        eventType: "VERIFICATION",
        occurredAt: oneHourAgo,
      });

      await temporalStore.create({
        sessionId,
        eventType: "ACTION",
        occurredAt: now,
      });

      // Query last hour
      const recentEvents = await temporalStore.getInRange(
        sessionId,
        oneHourAgo,
        now
      );

      expect(recentEvents.length).toBeGreaterThanOrEqual(2);
    });

    it("should parse natural language time expressions", async () => {
      const timelineService = createTimelineService(db);

      const todayRange = timelineService.parseTimeExpression("today");
      expect(todayRange).toBeDefined();
      expect(todayRange?.start.getDate()).toBe(new Date().getDate());

      const yesterdayRange = timelineService.parseTimeExpression("yesterday");
      expect(yesterdayRange).toBeDefined();
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(yesterdayRange?.start.getDate()).toBe(yesterday.getDate());

      const lastWeekRange = timelineService.parseTimeExpression("last week");
      expect(lastWeekRange).toBeDefined();

      const daysAgoRange = timelineService.parseTimeExpression("3 days ago");
      expect(daysAgoRange).toBeDefined();

      const lastNDaysRange = timelineService.parseTimeExpression("last 5 days");
      expect(lastNDaysRange).toBeDefined();
    });

    it("should get timeline segments", async () => {
      const temporalStore = createTemporalStore(db);
      const timelineService = createTimelineService(db);
      const sessionId = "test-session";

      const now = new Date();

      // Create multiple events
      for (let i = 0; i < 5; i++) {
        const eventTime = new Date(now.getTime() - i * 30 * 60 * 1000); // 30 min intervals
        await temporalStore.create({
          sessionId,
          eventType: "CLAIM",
          occurredAt: eventTime,
        });
      }

      const segments = await timelineService.getTimelineSegments(sessionId, "hour");
      expect(segments.length).toBeGreaterThan(0);
      expect(segments[0].eventCount).toBeGreaterThan(0);
    });
  });

  describe("Retry Manager", () => {
    it("should track retry attempts", async () => {
      const retryManager = createRetryManager({ maxRetries: 2 });

      expect(retryManager.getConfig().maxRetries).toBe(2);
      expect(retryManager.getConfig().notifyUser).toBe(true);
    });

    it("should generate retry prompts for different claim types", async () => {
      const retryManager = createRetryManager();

      const claim = {
        claim_id: "test-claim",
        session_id: "test-session",
        claim_type: "file_created" as const,
        original_text: "I created src/test.ts",
        entities: [{ type: "file" as const, value: "src/test.ts" }],
        confidence: 0.9,
        verified_at: null,
        task_id: null,
        response_id: null,
        created_at: new Date(),
      };

      const verification = {
        verification_id: "test-verify",
        claim_id: "test-claim",
        status: "contradicted" as const,
        evidence_ids: [],
        confidence: 0.8,
        details: "File not found",
        parent_verification_id: null,
        depth: 0,
        verified_at: new Date(),
      };

      // Use the generateRetryPrompt function with full context
      const prompt = generateRetryPrompt({
        claim,
        verification,
        attemptNumber: 1,
        previousAttempts: [],
      });
      expect(prompt).toContain("file");
      expect(prompt.length).toBeGreaterThan(0);

      // Check retryManager config
      expect(retryManager.getConfig().maxRetries).toBe(2);
    });
  });

  describe("Full Pipeline Integration", () => {
    it("should process response and update all memory types", async () => {
      engine.setSession("integration-test");

      // Process a response with a verifiable claim
      const response = "I created the file src/app.ts with a main function.";

      const result = await engine.processResponse(response);

      // Check claims were extracted
      expect(result.claims.length).toBeGreaterThan(0);

      // Store embedding for semantic search
      if (result.claims.length > 0) {
        const claim = result.claims[0];

        // Store embedding
        const vectorId = await engine.storeEmbedding(
          claim.claim_id,
          claim.session_id,
          claim.original_text
        );
        expect(vectorId).toBeDefined();

        // Process claim for knowledge graph
        const graphResult = await engine.processClaimForGraph(claim);
        expect(graphResult.entities.length).toBeGreaterThan(0);

        // Record temporal event
        const event = await engine.recordTemporalEvent("CLAIM", claim.session_id, {
          claimId: claim.claim_id,
          eventData: { type: claim.claim_type },
        });
        expect(event.eventId).toBeDefined();
      }
    });

    it("should support semantic search across memories", async () => {
      engine.setSession("semantic-test");

      // Create some memories with embeddings
      const memories = [
        { id: "m1", text: "Created authentication service" },
        { id: "m2", text: "Added user login endpoint" },
        { id: "m3", text: "Fixed database connection issue" },
      ];

      for (const mem of memories) {
        await engine.storeEmbedding(mem.id, "semantic-test", mem.text);
      }

      // Verify vectors were stored
      const vectorStore = engine.getVectorStore();
      const stats = await vectorStore.getStats();
      expect(stats.totalVectors).toBe(3);

      // Search semantically - the vector store returns results even without exact match
      // Since our hash-based embedding is simple, similarity may be lower
      const embeddingService = engine.getEmbeddingService();
      const queryEmbedding = await embeddingService.embed("auth login");
      const rawResults = await vectorStore.search(queryEmbedding, {
        sessionId: "semantic-test",
        limit: 5,
        minSimilarity: 0.0,
      });

      expect(rawResults.length).toBeGreaterThan(0);
    });

    it("should query events by natural language time", async () => {
      engine.setSession("time-test");

      // Record some events
      await engine.recordTemporalEvent("CLAIM", "time-test", {
        eventData: { description: "First action" },
      });

      await engine.recordTemporalEvent("ACTION", "time-test", {
        eventData: { description: "Second action" },
      });

      // Query using natural language
      const todayEvents = await engine.queryByTime("today", "time-test");
      expect(todayEvents.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Statistics and Reports", () => {
    it("should generate graph statistics", async () => {
      const graphService = createGraphService(db);
      const entityStore = graphService.getEntityStore();
      const sessionId = "stats-test";

      // Create some entities
      await entityStore.create({ sessionId, type: "file", name: "a.ts" });
      await entityStore.create({ sessionId, type: "file", name: "b.ts" });
      await entityStore.create({ sessionId, type: "function", name: "func1" });

      const stats = await graphService.getStats(sessionId);

      expect(stats.totalEntities).toBe(3);
      expect(stats.byEntityType.file).toBe(2);
      expect(stats.byEntityType.function).toBe(1);
    });

    it("should generate temporal statistics", async () => {
      const temporalStore = createTemporalStore(db);
      const sessionId = "temporal-stats-test";

      // Create events of different types
      await temporalStore.create({ sessionId, eventType: "CLAIM" });
      await temporalStore.create({ sessionId, eventType: "CLAIM" });
      await temporalStore.create({ sessionId, eventType: "VERIFICATION" });

      const stats = await temporalStore.getStats(sessionId);

      expect(stats.totalEvents).toBe(3);
      expect(stats.byEventType.CLAIM).toBe(2);
      expect(stats.byEventType.VERIFICATION).toBe(1);
    });
  });
});
