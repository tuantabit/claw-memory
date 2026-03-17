package main

import (
	"database/sql"
	"encoding/json"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// Database wraps SQLite connection
type Database struct {
	db *sql.DB
}

// NewDatabase creates a new database connection
func NewDatabase(path string) (*Database, error) {
	db, err := sql.Open("sqlite3", path+"?mode=ro")
	if err != nil {
		return nil, err
	}
	return &Database{db: db}, nil
}

// Close closes the database connection
func (d *Database) Close() error {
	return d.db.Close()
}

// Data structures matching veridic-claw schema

// Session represents a verification session
type Session struct {
	SessionID    string
	ClaimCount   int
	VerifiedCount int
	TrustScore   float64
	LastActivity time.Time
}

// Claim represents an extracted claim
type Claim struct {
	ClaimID      string
	SessionID    string
	TaskID       sql.NullString
	ResponseID   sql.NullString
	ClaimType    string
	OriginalText string
	Entities     []Entity
	Confidence   float64
	CreatedAt    time.Time
}

// Entity represents an extracted entity from a claim
type Entity struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// Evidence represents collected evidence
type Evidence struct {
	EvidenceID    string
	ClaimID       string
	Source        string
	Content       string
	SupportsClaim bool
	Confidence    float64
	CollectedAt   time.Time
}

// Verification represents a verification result
type Verification struct {
	VerificationID       string
	ClaimID              string
	Status               string
	Confidence           float64
	EvidenceIDs          []string
	ParentVerificationID sql.NullString
	Depth                int
	VerifiedAt           time.Time
}

// TrustScore represents a trust score entry
type TrustScore struct {
	ScoreID        string
	SessionID      string
	OverallScore   float64
	CategoryScores map[string]float64
	CreatedAt      time.Time
}

// Query methods

// GetSessions returns all sessions with claim counts
func (d *Database) GetSessions() ([]Session, error) {
	query := `
		SELECT
			c.session_id,
			COUNT(*) as claim_count,
			SUM(CASE WHEN v.status = 'verified' THEN 1 ELSE 0 END) as verified_count,
			COALESCE(ts.overall_score, 0) as trust_score,
			MAX(c.created_at) as last_activity
		FROM claims c
		LEFT JOIN verifications v ON c.claim_id = v.claim_id
		LEFT JOIN (
			SELECT session_id, overall_score,
				   ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC) as rn
			FROM trust_scores
		) ts ON c.session_id = ts.session_id AND ts.rn = 1
		GROUP BY c.session_id
		ORDER BY last_activity DESC
	`
	rows, err := d.db.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []Session
	for rows.Next() {
		var s Session
		var lastActivity string
		err := rows.Scan(&s.SessionID, &s.ClaimCount, &s.VerifiedCount, &s.TrustScore, &lastActivity)
		if err != nil {
			return nil, err
		}
		s.LastActivity, _ = time.Parse(time.RFC3339, lastActivity)
		sessions = append(sessions, s)
	}
	return sessions, nil
}

// GetClaimsForSession returns all claims for a session
func (d *Database) GetClaimsForSession(sessionID string) ([]Claim, error) {
	query := `
		SELECT claim_id, session_id, task_id, response_id, claim_type,
		       original_text, entities, confidence, created_at
		FROM claims
		WHERE session_id = ?
		ORDER BY created_at DESC
	`
	rows, err := d.db.Query(query, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var claims []Claim
	for rows.Next() {
		var c Claim
		var entitiesJSON string
		var createdAt string
		err := rows.Scan(&c.ClaimID, &c.SessionID, &c.TaskID, &c.ResponseID,
			&c.ClaimType, &c.OriginalText, &entitiesJSON, &c.Confidence, &createdAt)
		if err != nil {
			return nil, err
		}
		c.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
		json.Unmarshal([]byte(entitiesJSON), &c.Entities)
		claims = append(claims, c)
	}
	return claims, nil
}

// GetEvidenceForClaim returns all evidence for a claim
func (d *Database) GetEvidenceForClaim(claimID string) ([]Evidence, error) {
	query := `
		SELECT evidence_id, claim_id, source, content, supports_claim, confidence, collected_at
		FROM evidence
		WHERE claim_id = ?
		ORDER BY collected_at DESC
	`
	rows, err := d.db.Query(query, claimID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var evidence []Evidence
	for rows.Next() {
		var e Evidence
		var collectedAt string
		err := rows.Scan(&e.EvidenceID, &e.ClaimID, &e.Source, &e.Content,
			&e.SupportsClaim, &e.Confidence, &collectedAt)
		if err != nil {
			return nil, err
		}
		e.CollectedAt, _ = time.Parse(time.RFC3339, collectedAt)
		evidence = append(evidence, e)
	}
	return evidence, nil
}

// GetVerificationsForClaim returns all verifications for a claim (with DAG)
func (d *Database) GetVerificationsForClaim(claimID string) ([]Verification, error) {
	query := `
		SELECT verification_id, claim_id, status, confidence, evidence_ids,
		       parent_verification_id, COALESCE(depth, 0), verified_at
		FROM verifications
		WHERE claim_id = ?
		ORDER BY depth ASC, verified_at DESC
	`
	rows, err := d.db.Query(query, claimID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var verifications []Verification
	for rows.Next() {
		var v Verification
		var evidenceIDsJSON string
		var verifiedAt string
		err := rows.Scan(&v.VerificationID, &v.ClaimID, &v.Status, &v.Confidence,
			&evidenceIDsJSON, &v.ParentVerificationID, &v.Depth, &verifiedAt)
		if err != nil {
			return nil, err
		}
		v.VerifiedAt, _ = time.Parse(time.RFC3339, verifiedAt)
		json.Unmarshal([]byte(evidenceIDsJSON), &v.EvidenceIDs)
		verifications = append(verifications, v)
	}
	return verifications, nil
}

// GetTrustScores returns trust score history for a session
func (d *Database) GetTrustScores(sessionID string) ([]TrustScore, error) {
	query := `
		SELECT score_id, session_id, overall_score, category_scores, created_at
		FROM trust_scores
		WHERE session_id = ?
		ORDER BY created_at DESC
		LIMIT 50
	`
	rows, err := d.db.Query(query, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var scores []TrustScore
	for rows.Next() {
		var ts TrustScore
		var categoryScoresJSON string
		var createdAt string
		err := rows.Scan(&ts.ScoreID, &ts.SessionID, &ts.OverallScore,
			&categoryScoresJSON, &createdAt)
		if err != nil {
			return nil, err
		}
		ts.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
		json.Unmarshal([]byte(categoryScoresJSON), &ts.CategoryScores)
		scores = append(scores, ts)
	}
	return scores, nil
}

// SearchClaims performs basic LIKE search on claims
func (d *Database) SearchClaims(query string) ([]Claim, error) {
	sqlQuery := `
		SELECT claim_id, session_id, task_id, response_id, claim_type,
		       original_text, entities, confidence, created_at
		FROM claims
		WHERE original_text LIKE ?
		ORDER BY created_at DESC
		LIMIT 100
	`
	rows, err := d.db.Query(sqlQuery, "%"+query+"%")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var claims []Claim
	for rows.Next() {
		var c Claim
		var entitiesJSON string
		var createdAt string
		err := rows.Scan(&c.ClaimID, &c.SessionID, &c.TaskID, &c.ResponseID,
			&c.ClaimType, &c.OriginalText, &entitiesJSON, &c.Confidence, &createdAt)
		if err != nil {
			return nil, err
		}
		c.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
		json.Unmarshal([]byte(entitiesJSON), &c.Entities)
		claims = append(claims, c)
	}
	return claims, nil
}

// SearchClaimsFTS performs full-text search using FTS5
// Supports advanced query syntax:
// - "exact phrase" for phrase matching
// - word1 word2 for AND matching
// - word1 OR word2 for OR matching
// - word* for prefix matching
func (d *Database) SearchClaimsFTS(query string, limit int) ([]Claim, error) {
	if limit <= 0 {
		limit = 50
	}

	// Try FTS5 first, fallback to LIKE if FTS table doesn't exist
	sqlQuery := `
		SELECT c.claim_id, c.session_id, c.task_id, c.response_id, c.claim_type,
		       c.original_text, c.entities, c.confidence, c.created_at
		FROM claims c
		JOIN claims_fts fts ON c.claim_id = fts.claim_id
		WHERE claims_fts MATCH ?
		ORDER BY bm25(claims_fts)
		LIMIT ?
	`
	rows, err := d.db.Query(sqlQuery, query, limit)
	if err != nil {
		// Fallback to basic LIKE search if FTS not available
		return d.SearchClaims(query)
	}
	defer rows.Close()

	var claims []Claim
	for rows.Next() {
		var c Claim
		var entitiesJSON string
		var createdAt string
		err := rows.Scan(&c.ClaimID, &c.SessionID, &c.TaskID, &c.ResponseID,
			&c.ClaimType, &c.OriginalText, &entitiesJSON, &c.Confidence, &createdAt)
		if err != nil {
			return nil, err
		}
		c.CreatedAt, _ = time.Parse(time.RFC3339, createdAt)
		json.Unmarshal([]byte(entitiesJSON), &c.Entities)
		claims = append(claims, c)
	}

	// If no results from FTS, try basic search
	if len(claims) == 0 {
		return d.SearchClaims(query)
	}

	return claims, nil
}

// GetStats returns database statistics
func (d *Database) GetStats() (map[string]int, error) {
	stats := make(map[string]int)

	tables := []string{"claims", "evidence", "verifications", "trust_scores"}
	for _, table := range tables {
		var count int
		err := d.db.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count)
		if err != nil {
			return nil, err
		}
		stats[table] = count
	}

	// Count by claim type
	rows, err := d.db.Query("SELECT claim_type, COUNT(*) FROM claims GROUP BY claim_type")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var claimType string
		var count int
		rows.Scan(&claimType, &count)
		stats["claim_type_"+claimType] = count
	}

	return stats, nil
}

// Message types for async loading

type sessionsLoadedMsg struct {
	sessions []Session
	err      error
}

type claimsLoadedMsg struct {
	claims []Claim
	err    error
}

type evidenceLoadedMsg struct {
	evidence []Evidence
	err      error
}

type verificationsLoadedMsg struct {
	verifications []Verification
	err           error
}

type trustScoresLoadedMsg struct {
	trustScores []TrustScore
	err         error
}

type searchResultsMsg struct {
	claims []Claim
	query  string
	err    error
}

type errMsg struct {
	err error
}

// Command functions for async loading

func (m Model) loadSessions() tea.Msg {
	sessions, err := m.db.GetSessions()
	return sessionsLoadedMsg{sessions: sessions, err: err}
}

func (m Model) loadClaimsForSession(sessionID string) tea.Cmd {
	return func() tea.Msg {
		claims, err := m.db.GetClaimsForSession(sessionID)
		return claimsLoadedMsg{claims: claims, err: err}
	}
}

func (m Model) loadEvidenceForClaim(claimID string) tea.Cmd {
	return func() tea.Msg {
		evidence, err := m.db.GetEvidenceForClaim(claimID)
		return evidenceLoadedMsg{evidence: evidence, err: err}
	}
}

func (m Model) loadVerificationsForClaim(claimID string) tea.Cmd {
	return func() tea.Msg {
		verifications, err := m.db.GetVerificationsForClaim(claimID)
		return verificationsLoadedMsg{verifications: verifications, err: err}
	}
}

func (m Model) loadTrustScores(sessionID string) tea.Cmd {
	return func() tea.Msg {
		scores, err := m.db.GetTrustScores(sessionID)
		return trustScoresLoadedMsg{trustScores: scores, err: err}
	}
}

func (m Model) searchClaims(query string) tea.Cmd {
	return func() tea.Msg {
		claims, err := m.db.SearchClaimsFTS(query, 50)
		return searchResultsMsg{claims: claims, query: query, err: err}
	}
}
