/**
 * Veridic-Claw Database Schema
 * Extension to ClawMemory schema for trust verification
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
 * Initialize veridic schema
 */
export async function initVeridicSchema(
  db: import("./core/database.js").Database
): Promise<void> {
  await db.execute(VERIDIC_SCHEMA);
}
