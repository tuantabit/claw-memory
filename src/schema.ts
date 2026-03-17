/**
 * Database Schema for Veridic-Claw
 *
 * This module defines all database tables used by the verification system:
 *
 * Core Tables:
 * - claims: Extracted claims from agent responses
 * - evidence: Collected evidence to verify claims
 * - verifications: Verification results (verified/contradicted)
 * - trust_scores: Trust score history over time
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

/**
 * Core schema for verification tables
 *
 * Creates the main tables with appropriate indexes for efficient queries.
 * Uses VARCHAR for IDs (nanoid format) and JSON for flexible data storage.
 */
export const VERIDIC_SCHEMA = `
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

-- Trust Scores: Session trust scores over time
CREATE TABLE IF NOT EXISTS trust_scores (
    score_id VARCHAR PRIMARY KEY,
    session_id VARCHAR NOT NULL,
    overall_score DOUBLE NOT NULL,
    category_scores JSON,
    total_claims INTEGER DEFAULT 0,
    verified_claims INTEGER DEFAULT 0,
    contradicted_claims INTEGER DEFAULT 0,
    unverified_claims INTEGER DEFAULT 0,
    calculated_at TIMESTAMP DEFAULT current_timestamp
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

CREATE INDEX IF NOT EXISTS idx_trust_scores_session ON trust_scores(session_id);
CREATE INDEX IF NOT EXISTS idx_trust_scores_calculated ON trust_scores(calculated_at);
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
    avg_trust_score DOUBLE,
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
 * Initialize the Veridic database schema
 *
 * Creates all required tables and indexes. Safe to call multiple times
 * (uses IF NOT EXISTS). FTS initialization may fail on some SQLite builds
 * that don't support FTS5 - this is handled gracefully.
 *
 * @param db - Database instance to initialize
 */
export async function initVeridicSchema(
  db: import("./core/database.js").Database
): Promise<void> {
  await db.execute(VERIDIC_SCHEMA);
  await db.execute(COMPACTION_SCHEMA);

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
