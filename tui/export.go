package main

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ExportFormat defines supported export formats
type ExportFormat string

const (
	ExportJSON     ExportFormat = "json"
	ExportMarkdown ExportFormat = "markdown"
	ExportCSV      ExportFormat = "csv"
)

// ExportOptions configures export behavior
type ExportOptions struct {
	Format     ExportFormat
	SessionID  string    // Optional: specific session
	StartDate  time.Time // Optional: date range start
	EndDate    time.Time // Optional: date range end
	Status     string    // Optional: verified/contradicted/unverified
	OutputPath string    // Output file path
}

// ExportData contains all data for export
type ExportData struct {
	ExportedAt  time.Time          `json:"exportedAt"`
	SessionID   string             `json:"sessionId,omitempty"`
	TrustScore  float64            `json:"trustScore"`
	Summary     ExportSummary      `json:"summary"`
	Claims      []ExportClaim      `json:"claims"`
	Verifications []ExportVerification `json:"verifications,omitempty"`
}

// ExportSummary contains summary statistics
type ExportSummary struct {
	TotalClaims       int `json:"totalClaims"`
	VerifiedClaims    int `json:"verifiedClaims"`
	ContradicatedClaims int `json:"contradictedClaims"`
	UnverifiedClaims  int `json:"unverifiedClaims"`
}

// ExportClaim represents a claim for export
type ExportClaim struct {
	ClaimID      string    `json:"claimId"`
	SessionID    string    `json:"sessionId"`
	ClaimType    string    `json:"claimType"`
	OriginalText string    `json:"originalText"`
	Confidence   float64   `json:"confidence"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
}

// ExportVerification represents a verification for export
type ExportVerification struct {
	VerificationID string    `json:"verificationId"`
	ClaimID        string    `json:"claimId"`
	Status         string    `json:"status"`
	Confidence     float64   `json:"confidence"`
	VerifiedAt     time.Time `json:"verifiedAt"`
}

// Exporter handles data export operations
type Exporter struct {
	db *Database
}

// NewExporter creates a new exporter
func NewExporter(db *Database) *Exporter {
	return &Exporter{db: db}
}

// Export exports data based on options
func (e *Exporter) Export(opts ExportOptions) error {
	// Get export data
	data, err := e.getExportData(opts)
	if err != nil {
		return fmt.Errorf("failed to get export data: %w", err)
	}

	// Generate output path if not specified
	if opts.OutputPath == "" {
		opts.OutputPath = e.generateOutputPath(opts.Format)
	}

	// Export based on format
	switch opts.Format {
	case ExportJSON:
		return e.exportJSON(data, opts.OutputPath)
	case ExportMarkdown:
		return e.exportMarkdown(data, opts.OutputPath)
	case ExportCSV:
		return e.exportCSV(data, opts.OutputPath)
	default:
		return fmt.Errorf("unsupported export format: %s", opts.Format)
	}
}

// getExportData retrieves data for export
func (e *Exporter) getExportData(opts ExportOptions) (*ExportData, error) {
	data := &ExportData{
		ExportedAt: time.Now(),
		SessionID:  opts.SessionID,
	}

	var claims []Claim
	var err error

	if opts.SessionID != "" {
		claims, err = e.db.GetClaimsForSession(opts.SessionID)
	} else {
		// Get all claims (limited)
		claims, err = e.db.SearchClaims("")
	}

	if err != nil {
		return nil, err
	}

	// Convert claims to export format
	for _, c := range claims {
		// Get verification status
		verifications, _ := e.db.GetVerificationsForClaim(c.ClaimID)
		status := "unverified"
		if len(verifications) > 0 {
			status = verifications[0].Status
		}

		// Apply status filter
		if opts.Status != "" && status != opts.Status {
			continue
		}

		// Apply date filter
		if !opts.StartDate.IsZero() && c.CreatedAt.Before(opts.StartDate) {
			continue
		}
		if !opts.EndDate.IsZero() && c.CreatedAt.After(opts.EndDate) {
			continue
		}

		data.Claims = append(data.Claims, ExportClaim{
			ClaimID:      c.ClaimID,
			SessionID:    c.SessionID,
			ClaimType:    c.ClaimType,
			OriginalText: c.OriginalText,
			Confidence:   c.Confidence,
			Status:       status,
			CreatedAt:    c.CreatedAt,
		})

		// Count statistics
		data.Summary.TotalClaims++
		switch status {
		case "verified":
			data.Summary.VerifiedClaims++
		case "contradicted":
			data.Summary.ContradicatedClaims++
		default:
			data.Summary.UnverifiedClaims++
		}
	}

	// Get trust score
	if opts.SessionID != "" {
		scores, _ := e.db.GetTrustScores(opts.SessionID)
		if len(scores) > 0 {
			data.TrustScore = scores[0].OverallScore
		}
	}

	return data, nil
}

// generateOutputPath generates a default output path
func (e *Exporter) generateOutputPath(format ExportFormat) string {
	home, _ := os.UserHomeDir()
	timestamp := time.Now().Format("20060102-150405")
	ext := string(format)
	if format == ExportMarkdown {
		ext = "md"
	}
	return filepath.Join(home, fmt.Sprintf("veridic-export-%s.%s", timestamp, ext))
}

// exportJSON exports data as JSON
func (e *Exporter) exportJSON(data *ExportData, path string) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	return encoder.Encode(data)
}

// exportMarkdown exports data as Markdown
func (e *Exporter) exportMarkdown(data *ExportData, path string) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	var b strings.Builder

	// Header
	b.WriteString("# Veridic Audit Report\n\n")
	b.WriteString(fmt.Sprintf("**Exported:** %s\n", data.ExportedAt.Format("2006-01-02 15:04:05")))
	if data.SessionID != "" {
		b.WriteString(fmt.Sprintf("**Session:** %s\n", data.SessionID))
	}
	if data.TrustScore > 0 {
		b.WriteString(fmt.Sprintf("**Trust Score:** %.1f%%\n", data.TrustScore))
	}
	b.WriteString("\n")

	// Summary
	b.WriteString("## Summary\n\n")
	b.WriteString("| Metric | Count | Percentage |\n")
	b.WriteString("|--------|-------|------------|\n")

	total := data.Summary.TotalClaims
	if total > 0 {
		b.WriteString(fmt.Sprintf("| Total Claims | %d | 100%% |\n", total))
		b.WriteString(fmt.Sprintf("| Verified | %d | %.1f%% |\n",
			data.Summary.VerifiedClaims,
			float64(data.Summary.VerifiedClaims)/float64(total)*100))
		b.WriteString(fmt.Sprintf("| Contradicted | %d | %.1f%% |\n",
			data.Summary.ContradicatedClaims,
			float64(data.Summary.ContradicatedClaims)/float64(total)*100))
		b.WriteString(fmt.Sprintf("| Unverified | %d | %.1f%% |\n",
			data.Summary.UnverifiedClaims,
			float64(data.Summary.UnverifiedClaims)/float64(total)*100))
	}
	b.WriteString("\n")

	// Claims by status
	if data.Summary.VerifiedClaims > 0 {
		b.WriteString("## Verified Claims\n\n")
		b.WriteString("| Type | Claim | Confidence |\n")
		b.WriteString("|------|-------|------------|\n")
		for _, c := range data.Claims {
			if c.Status == "verified" {
				text := c.OriginalText
				if len(text) > 60 {
					text = text[:57] + "..."
				}
				b.WriteString(fmt.Sprintf("| %s | %s | %.0f%% |\n",
					c.ClaimType, text, c.Confidence*100))
			}
		}
		b.WriteString("\n")
	}

	if data.Summary.ContradicatedClaims > 0 {
		b.WriteString("## Contradicted Claims\n\n")
		b.WriteString("| Type | Claim | Confidence |\n")
		b.WriteString("|------|-------|------------|\n")
		for _, c := range data.Claims {
			if c.Status == "contradicted" {
				text := c.OriginalText
				if len(text) > 60 {
					text = text[:57] + "..."
				}
				b.WriteString(fmt.Sprintf("| %s | %s | %.0f%% |\n",
					c.ClaimType, text, c.Confidence*100))
			}
		}
		b.WriteString("\n")
	}

	if data.Summary.UnverifiedClaims > 0 {
		b.WriteString("## Unverified Claims\n\n")
		b.WriteString("| Type | Claim | Confidence |\n")
		b.WriteString("|------|-------|------------|\n")
		for _, c := range data.Claims {
			if c.Status == "unverified" {
				text := c.OriginalText
				if len(text) > 60 {
					text = text[:57] + "..."
				}
				b.WriteString(fmt.Sprintf("| %s | %s | %.0f%% |\n",
					c.ClaimType, text, c.Confidence*100))
			}
		}
		b.WriteString("\n")
	}

	// Footer
	b.WriteString("---\n")
	b.WriteString("*Generated by veridic-tui*\n")

	_, err = file.WriteString(b.String())
	return err
}

// exportCSV exports data as CSV
func (e *Exporter) exportCSV(data *ExportData, path string) error {
	file, err := os.Create(path)
	if err != nil {
		return err
	}
	defer file.Close()

	writer := csv.NewWriter(file)
	defer writer.Flush()

	// Header
	header := []string{
		"claim_id",
		"session_id",
		"claim_type",
		"original_text",
		"confidence",
		"status",
		"created_at",
	}
	if err := writer.Write(header); err != nil {
		return err
	}

	// Data rows
	for _, c := range data.Claims {
		row := []string{
			c.ClaimID,
			c.SessionID,
			c.ClaimType,
			c.OriginalText,
			fmt.Sprintf("%.2f", c.Confidence),
			c.Status,
			c.CreatedAt.Format(time.RFC3339),
		}
		if err := writer.Write(row); err != nil {
			return err
		}
	}

	return nil
}

// Message types for export

type exportStartedMsg struct{}

type exportCompletedMsg struct {
	path string
	err  error
}

// Command functions for export

func (m Model) startExport(opts ExportOptions) tea.Cmd {
	return func() tea.Msg {
		exporter := NewExporter(m.db)
		err := exporter.Export(opts)
		return exportCompletedMsg{path: opts.OutputPath, err: err}
	}
}
