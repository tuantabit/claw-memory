/**
 * Database Schema for ClawMemory-Claw
 *
 * This module defines all database tables used by the verification system.
 * It extends the core schema from @openclaw/memory-core with plugin-specific tables.
 *
 * Core Tables (from @openclaw/memory-core):
 * - memory_vectors: Vector embeddings for semantic search
 * - entities: Knowledge graph nodes
 * - relationships: Knowledge graph edges
 * - temporal_events: Time-based events
 *
 * Plugin Tables:
 * - claims: Extracted claims from agent responses
 * - evidence: Collected evidence to verify claims
 * - verifications: Verification results (verified/contradicted)
 *
 * Archive Tables (for compaction):
 * - claims_archive: Old claims moved during compaction
 * - evidence_archive: Old evidence moved during compaction
 * - daily_summaries: Aggregated daily statistics
 * - compaction_history: Track compaction runs
 *
 * FTS Tables:
 * - claims_fts: Full-text search index for claims
 */

import { initCoreSchema } from "memory-core";

/**
 * Core schema for verification tables
 *
 * Creates the main tables with appropriate indexes for efficient queries.
 * Uses VARCHAR for IDs (nanoid format) and JSON for flexible data storage.
 */
export const CLAW_MEMORY_SCHEMA = `
-- Claims: Extracted claims from AI responses
-- Similar to summaries in lossless-claw
CREATE TABLE IF NOT EXISTS claims (
    claim_id VARCHAR PRIMARY KEY,
    session_id VARCHAR NOT NULL,
    task_id VARCHAR,
    response_id VARCHAR,
    claim_type VARCHAR NOT NULL,
    original_text TEXT NOT NULL,
    entities JSON,
    confidence DOUBLE NOT NULL,
    created_at TIMESTAMP DEFAULT current_timestamp
);

-- Evidence: Collected evidence for claims
-- Similar to messages in lossless-claw
CREATE TABLE IF NOT EXISTS evidence (
    evidence_id VARCHAR PRIMARY KEY,
    claim_id VARCHAR NOT NULL,
    source VARCHAR NOT NULL,
    source_ref VARCHAR,
    data JSON NOT NULL,
    supports_claim BOOLEAN NOT NULL,
    confidence DOUBLE NOT NULL,
    collected_at TIMESTAMP DEFAULT current_timestamp
);

-- Verifications: Results of claim verification
-- DAG structure similar to summary_dag in lossless-claw
CREATE TABLE IF NOT EXISTS verifications (
    verification_id VARCHAR PRIMARY KEY,
    claim_id VARCHAR NOT NULL,
    status VARCHAR NOT NULL,
    evidence_ids JSON,
    confidence DOUBLE NOT NULL,
    details TEXT,
    -- DAG columns for verification history
    parent_verification_id VARCHAR,
    depth INTEGER DEFAULT 0,
    verified_at TIMESTAMP DEFAULT current_timestamp
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_claims_session ON claims(session_id);
CREATE INDEX IF NOT EXISTS idx_claims_task ON claims(task_id);
CREATE INDEX IF NOT EXISTS idx_claims_type ON claims(claim_type);
CREATE INDEX IF NOT EXISTS idx_claims_created ON claims(created_at);

CREATE INDEX IF NOT EXISTS idx_evidence_claim ON evidence(claim_id);
CREATE INDEX IF NOT EXISTS idx_evidence_source ON evidence(source);

CREATE INDEX IF NOT EXISTS idx_verifications_claim ON verifications(claim_id);
CREATE INDEX IF NOT EXISTS idx_verifications_status ON verifications(status);
CREATE INDEX IF NOT EXISTS idx_verifications_parent ON verifications(parent_verification_id);
CREATE INDEX IF NOT EXISTS idx_verifications_depth ON verifications(depth);

-- ============================================
-- Messages & Summaries Storage (LosslessBridge)
-- ============================================

-- Messages: Store conversation messages for persistence
CREATE TABLE IF NOT EXISTS messages (
    message_id VARCHAR PRIMARY KEY,
    session_id VARCHAR NOT NULL,
    role VARCHAR NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    response_id VARCHAR,
    created_at TIMESTAMP DEFAULT current_timestamp
);

-- Summaries: DAG summarization of old message chunks
CREATE TABLE IF NOT EXISTS summaries (
    summary_id VARCHAR PRIMARY KEY,
    session_id VARCHAR NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    message_count INTEGER DEFAULT 0,
    start_message_id VARCHAR,
    end_message_id VARCHAR,
    created_at TIMESTAMP DEFAULT current_timestamp,
    UNIQUE(session_id, chunk_index)
);

-- Message indexes
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_response ON messages(response_id);
CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id);

-- ============================================
-- Memory Entries Storage (MemoryBridge)
-- ============================================

-- Memory entries: 3-layer memory system with decay
CREATE TABLE IF NOT EXISTS memory_entries (
    memory_id VARCHAR PRIMARY KEY,
    session_id VARCHAR,
    task_id VARCHAR,
    type VARCHAR NOT NULL CHECK(type IN ('event', 'task', 'decision', 'summary', 'note', 'verification')),
    layer VARCHAR NOT NULL CHECK(layer IN ('short-term', 'long-term', 'digest')),
    content TEXT NOT NULL,
    metadata JSON,
    importance DOUBLE DEFAULT 0.5 CHECK(importance >= 0 AND importance <= 1),
    decay_level INTEGER DEFAULT 0 CHECK(decay_level >= 0 AND decay_level <= 3),
    access_count INTEGER DEFAULT 0,
    hash VARCHAR,
    created_at TIMESTAMP DEFAULT current_timestamp,
    accessed_at TIMESTAMP DEFAULT current_timestamp
);

-- Memory indexes
CREATE INDEX IF NOT EXISTS idx_memory_session ON memory_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_task ON memory_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_entries(type);
CREATE INDEX IF NOT EXISTS idx_memory_layer ON memory_entries(layer);
CREATE INDEX IF NOT EXISTS idx_memory_importance ON memory_entries(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memory_decay ON memory_entries(decay_level);
CREATE INDEX IF NOT EXISTS idx_memory_accessed ON memory_entries(accessed_at DESC);

-- ============================================
-- Note: Vector, Entity, Relationship, and Temporal tables are
-- created by initCoreSchema from @openclaw/memory-core.
-- This schema only contains plugin-specific tables.
-- ============================================
`;

/**
 * Full-text search schema using SQLite FTS5
 *
 * Enables fast text search across claims using Porter stemming
 * and Unicode tokenization. Automatically synced via triggers.
 */
export const FTS_SCHEMA = `
-- FTS5 virtual table for full-text search on claims
CREATE VIRTUAL TABLE IF NOT EXISTS claims_fts USING fts5(
    claim_id,
    original_text,
    claim_type,
    content='claims',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

-- Trigger: Insert into FTS when claim is created
CREATE TRIGGER IF NOT EXISTS claims_fts_insert AFTER INSERT ON claims BEGIN
    INSERT INTO claims_fts(rowid, claim_id, original_text, claim_type)
    VALUES (NEW.rowid, NEW.claim_id, NEW.original_text, NEW.claim_type);
END;

-- Trigger: Update FTS when claim is updated
CREATE TRIGGER IF NOT EXISTS claims_fts_update AFTER UPDATE ON claims BEGIN
    INSERT INTO claims_fts(claims_fts, rowid, claim_id, original_text, claim_type)
    VALUES('delete', OLD.rowid, OLD.claim_id, OLD.original_text, OLD.claim_type);
    INSERT INTO claims_fts(rowid, claim_id, original_text, claim_type)
    VALUES (NEW.rowid, NEW.claim_id, NEW.original_text, NEW.claim_type);
END;

-- Trigger: Delete from FTS when claim is deleted
CREATE TRIGGER IF NOT EXISTS claims_fts_delete AFTER DELETE ON claims BEGIN
    INSERT INTO claims_fts(claims_fts, rowid, claim_id, original_text, claim_type)
    VALUES('delete', OLD.rowid, OLD.claim_id, OLD.original_text, OLD.claim_type);
END;

-- FTS5 for memory entries search
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    memory_id,
    content,
    type,
    content='memory_entries',
    content_rowid='rowid',
    tokenize='porter unicode61'
);

-- Triggers for memory FTS sync
CREATE TRIGGER IF NOT EXISTS memory_fts_insert AFTER INSERT ON memory_entries BEGIN
    INSERT INTO memory_fts(rowid, memory_id, content, type)
    VALUES (NEW.rowid, NEW.memory_id, NEW.content, NEW.type);
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_update AFTER UPDATE ON memory_entries BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, memory_id, content, type)
    VALUES('delete', OLD.rowid, OLD.memory_id, OLD.content, OLD.type);
    INSERT INTO memory_fts(rowid, memory_id, content, type)
    VALUES (NEW.rowid, NEW.memory_id, NEW.content, NEW.type);
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_delete AFTER DELETE ON memory_entries BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, memory_id, content, type)
    VALUES('delete', OLD.rowid, OLD.memory_id, OLD.content, OLD.type);
END;
`;

/**
 * SQL to rebuild the FTS index from scratch
 *
 * Used when the FTS index becomes out of sync or corrupted.
 * Clears all FTS data and repopulates from the claims table.
 */
export const FTS_REBUILD = `
-- Clear existing FTS data
DELETE FROM claims_fts;

-- Rebuild from claims table
INSERT INTO claims_fts(rowid, claim_id, original_text, claim_type)
SELECT rowid, claim_id, original_text, claim_type FROM claims;
`;

/**
 * Schema for database compaction and archival
 *
 * Creates archive tables for moving old data and tracking compaction runs.
 * Old claims/evidence are moved to archive tables to reduce active table size.
 */
export const COMPACTION_SCHEMA = `
-- Claims archive: Old claims moved here during compaction
CREATE TABLE IF NOT EXISTS claims_archive (
    claim_id VARCHAR PRIMARY KEY,
    session_id VARCHAR NOT NULL,
    claim_type VARCHAR NOT NULL,
    original_text TEXT NOT NULL,
    confidence DOUBLE NOT NULL,
    verification_status VARCHAR,
    original_created_at TIMESTAMP,
    archived_at TIMESTAMP DEFAULT current_timestamp
);

-- Evidence archive: Old evidence moved here during compaction
CREATE TABLE IF NOT EXISTS evidence_archive (
    evidence_id VARCHAR PRIMARY KEY,
    claim_id VARCHAR NOT NULL,
    source VARCHAR NOT NULL,
    supports_claim BOOLEAN NOT NULL,
    confidence DOUBLE NOT NULL,
    original_collected_at TIMESTAMP,
    archived_at TIMESTAMP DEFAULT current_timestamp
);

-- Daily summaries: Aggregated statistics per day
CREATE TABLE IF NOT EXISTS daily_summaries (
    summary_id VARCHAR PRIMARY KEY,
    summary_date DATE NOT NULL,
    session_id VARCHAR,
    total_claims INTEGER DEFAULT 0,
    verified_claims INTEGER DEFAULT 0,
    contradicted_claims INTEGER DEFAULT 0,
    unverified_claims INTEGER DEFAULT 0,
    avg_confidence DOUBLE,
    claim_types JSON,
    created_at TIMESTAMP DEFAULT current_timestamp
);

-- Compaction history: Track compaction runs
CREATE TABLE IF NOT EXISTS compaction_history (
    compaction_id VARCHAR PRIMARY KEY,
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    retention_days INTEGER NOT NULL,
    claims_archived INTEGER DEFAULT 0,
    evidence_archived INTEGER DEFAULT 0,
    orphans_cleaned INTEGER DEFAULT 0,
    size_before_bytes INTEGER,
    size_after_bytes INTEGER,
    space_saved_bytes INTEGER,
    status VARCHAR DEFAULT 'running',
    error_message TEXT
);

-- Indexes for archive tables
CREATE INDEX IF NOT EXISTS idx_claims_archive_session ON claims_archive(session_id);
CREATE INDEX IF NOT EXISTS idx_claims_archive_archived ON claims_archive(archived_at);
CREATE INDEX IF NOT EXISTS idx_evidence_archive_claim ON evidence_archive(claim_id);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries(summary_date);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_session ON daily_summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_compaction_history_started ON compaction_history(started_at);
`;

/**
 * Schema for receipt tables (action tracking)
 *
 * Creates tables for tracking agent actions and their results.
 * Used for verification of agent claims against actual evidence.
 */
export const RECEIPT_SCHEMA = `
-- ============================================
-- Receipt Tables (Action Tracking)
-- ============================================

-- Actions: Record of every tool call
CREATE TABLE IF NOT EXISTS actions (
    action_id VARCHAR PRIMARY KEY,
    session_id VARCHAR NOT NULL,
    task_id VARCHAR,
    tool_name VARCHAR NOT NULL,
    tool_input JSON,
    tool_result JSON,
    status VARCHAR DEFAULT 'pending' CHECK(status IN ('pending', 'success', 'error')),
    error_message TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT current_timestamp,
    completed_at TIMESTAMP
);

-- File Receipts: Evidence of file operations
CREATE TABLE IF NOT EXISTS file_receipts (
    receipt_id VARCHAR PRIMARY KEY,
    action_id VARCHAR NOT NULL REFERENCES actions(action_id),
    file_path VARCHAR NOT NULL,
    operation VARCHAR NOT NULL CHECK(operation IN ('create', 'modify', 'delete', 'read')),
    before_hash VARCHAR,
    after_hash VARCHAR,
    before_size INTEGER,
    after_size INTEGER,
    created_at TIMESTAMP DEFAULT current_timestamp
);

-- Command Receipts: Evidence of command executions
CREATE TABLE IF NOT EXISTS command_receipts (
    receipt_id VARCHAR PRIMARY KEY,
    action_id VARCHAR NOT NULL REFERENCES actions(action_id),
    command TEXT NOT NULL,
    working_dir VARCHAR,
    exit_code INTEGER,
    stdout_summary TEXT,
    stderr_summary TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMP DEFAULT current_timestamp
);

-- Action indexes
CREATE INDEX IF NOT EXISTS idx_actions_session ON actions(session_id);
CREATE INDEX IF NOT EXISTS idx_actions_task ON actions(task_id);
CREATE INDEX IF NOT EXISTS idx_actions_tool ON actions(tool_name);
CREATE INDEX IF NOT EXISTS idx_actions_status ON actions(status);
CREATE INDEX IF NOT EXISTS idx_actions_created ON actions(created_at DESC);

-- Receipt indexes
CREATE INDEX IF NOT EXISTS idx_file_receipts_action ON file_receipts(action_id);
CREATE INDEX IF NOT EXISTS idx_file_receipts_path ON file_receipts(file_path);
CREATE INDEX IF NOT EXISTS idx_file_receipts_operation ON file_receipts(operation);

CREATE INDEX IF NOT EXISTS idx_command_receipts_action ON command_receipts(action_id);
CREATE INDEX IF NOT EXISTS idx_command_receipts_exit ON command_receipts(exit_code);
`;

/**
 * Initialize the ClawMemory database schema
 *
 * Creates all required tables and indexes. Safe to call multiple times
 * (uses IF NOT EXISTS). FTS initialization may fail on some SQLite builds
 * that don't support FTS5 - this is handled gracefully.
 *
 * This function first initializes the core schema (vectors, entities,
 * relationships, temporal_events) then adds plugin-specific tables.
 *
 * @param db - Database instance to initialize
 */
export async function initClawMemorySchema(
  db: import("./core/database.js").Database
): Promise<void> {
  // Initialize core schema first (vectors, entities, relationships, temporal)
  initCoreSchema(db);

  // Then add plugin-specific tables
  await db.execute(CLAW_MEMORY_SCHEMA);
  await db.execute(COMPACTION_SCHEMA);
  await db.execute(RECEIPT_SCHEMA);

  try {
    await db.execute(FTS_SCHEMA);
  } catch {
    // FTS5 may not be available on all SQLite builds
  }
}

/**
 * Rebuild the full-text search index
 *
 * Clears the FTS index and repopulates from the claims table.
 * Use when the index becomes corrupted or out of sync.
 *
 * @param db - Database instance with claims data
 */
export async function rebuildFTSIndex(
  db: import("./core/database.js").Database
): Promise<void> {
  try {
    await db.execute(FTS_REBUILD);
  } catch {
    // FTS5 may not be available
  }
}
