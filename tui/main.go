// veridic-tui: Terminal UI for Veridic-Claw Database
// Inspect claims, evidence, verifications, and trust scores
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	tea "github.com/charmbracelet/bubbletea"
)

// Version info (set by goreleaser)
var (
	version = "dev"
	commit  = "none"
	date    = "unknown"
)

// Config holds runtime configuration
type Config struct {
	DBPath  string
	Verbose bool
}

func main() {
	// Parse flags
	var cfg Config
	var showVersion bool

	flag.StringVar(&cfg.DBPath, "db", defaultDBPath(), "Path to veridic-claw database")
	flag.BoolVar(&cfg.Verbose, "verbose", false, "Enable verbose output")
	flag.BoolVar(&showVersion, "version", false, "Show version info")
	flag.Parse()

	if showVersion {
		fmt.Printf("veridic-tui %s (commit: %s, built: %s)\n", version, commit, date)
		os.Exit(0)
	}

	// Check database exists
	if _, err := os.Stat(cfg.DBPath); os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "Database not found: %s\n", cfg.DBPath)
		fmt.Fprintf(os.Stderr, "Run veridic-claw first to create the database.\n")
		os.Exit(1)
	}

	// Initialize database connection
	db, err := NewDatabase(cfg.DBPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to open database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	// Create and run the TUI
	model := NewModel(db)
	p := tea.NewProgram(model, tea.WithAltScreen())

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error running TUI: %v\n", err)
		os.Exit(1)
	}
}

// defaultDBPath returns the default database path
func defaultDBPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "veridic-claw.db"
	}
	return filepath.Join(home, ".openclaw", "veridic-claw.db")
}

// Model represents the main TUI state
type Model struct {
	db           *Database
	currentView  ViewType
	sessions     []Session
	claims       []Claim
	evidence     []Evidence
	verifications []Verification
	trustScores  []TrustScore

	// Selection state
	selectedSession int
	selectedClaim   int
	selectedEvidence int

	// UI state
	width  int
	height int
	err    error
}

// ViewType represents different views in the TUI
type ViewType int

const (
	ViewSessions ViewType = iota
	ViewClaims
	ViewEvidence
	ViewVerifications
	ViewTrustScores
	ViewClaimDetail
)

// NewModel creates a new TUI model
func NewModel(db *Database) Model {
	return Model{
		db:          db,
		currentView: ViewSessions,
	}
}

// Init implements tea.Model
func (m Model) Init() tea.Cmd {
	return m.loadSessions
}

// Update implements tea.Model
func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		return m.handleKeyPress(msg)
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		return m, nil
	case sessionsLoadedMsg:
		m.sessions = msg.sessions
		m.err = msg.err
		return m, nil
	case claimsLoadedMsg:
		m.claims = msg.claims
		m.err = msg.err
		return m, nil
	case evidenceLoadedMsg:
		m.evidence = msg.evidence
		m.err = msg.err
		return m, nil
	case verificationsLoadedMsg:
		m.verifications = msg.verifications
		m.err = msg.err
		return m, nil
	case trustScoresLoadedMsg:
		m.trustScores = msg.trustScores
		m.err = msg.err
		return m, nil
	case errMsg:
		m.err = msg.err
		return m, nil
	}
	return m, nil
}

// handleKeyPress handles keyboard input
func (m Model) handleKeyPress(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "q", "ctrl+c":
		return m, tea.Quit
	case "esc":
		// Go back to previous view
		switch m.currentView {
		case ViewClaims:
			m.currentView = ViewSessions
			return m, m.loadSessions
		case ViewEvidence, ViewVerifications:
			m.currentView = ViewClaims
			return m, nil
		case ViewClaimDetail:
			m.currentView = ViewClaims
			return m, nil
		case ViewTrustScores:
			m.currentView = ViewSessions
			return m, nil
		}
	case "up", "k":
		m.moveSelection(-1)
	case "down", "j":
		m.moveSelection(1)
	case "enter":
		return m.handleEnter()
	case "e":
		// Show evidence for selected claim
		if m.currentView == ViewClaims && len(m.claims) > 0 {
			m.currentView = ViewEvidence
			return m, m.loadEvidenceForClaim(m.claims[m.selectedClaim].ClaimID)
		}
	case "v":
		// Show verifications for selected claim
		if m.currentView == ViewClaims && len(m.claims) > 0 {
			m.currentView = ViewVerifications
			return m, m.loadVerificationsForClaim(m.claims[m.selectedClaim].ClaimID)
		}
	case "t":
		// Show trust scores
		if m.currentView == ViewSessions && len(m.sessions) > 0 {
			m.currentView = ViewTrustScores
			return m, m.loadTrustScores(m.sessions[m.selectedSession].SessionID)
		}
	case "s":
		// Search (TODO: implement)
	case "x":
		// Export (TODO: implement)
	}
	return m, nil
}

// moveSelection moves the selection cursor
func (m *Model) moveSelection(delta int) {
	switch m.currentView {
	case ViewSessions:
		m.selectedSession = clamp(m.selectedSession+delta, 0, len(m.sessions)-1)
	case ViewClaims:
		m.selectedClaim = clamp(m.selectedClaim+delta, 0, len(m.claims)-1)
	case ViewEvidence:
		m.selectedEvidence = clamp(m.selectedEvidence+delta, 0, len(m.evidence)-1)
	}
}

// handleEnter handles the enter key
func (m Model) handleEnter() (tea.Model, tea.Cmd) {
	switch m.currentView {
	case ViewSessions:
		if len(m.sessions) > 0 {
			m.currentView = ViewClaims
			m.selectedClaim = 0
			return m, m.loadClaimsForSession(m.sessions[m.selectedSession].SessionID)
		}
	case ViewClaims:
		if len(m.claims) > 0 {
			m.currentView = ViewClaimDetail
			return m, nil
		}
	}
	return m, nil
}

// View implements tea.Model
func (m Model) View() string {
	if m.err != nil {
		return fmt.Sprintf("Error: %v\n\nPress q to quit.", m.err)
	}

	switch m.currentView {
	case ViewSessions:
		return m.viewSessions()
	case ViewClaims:
		return m.viewClaims()
	case ViewEvidence:
		return m.viewEvidence()
	case ViewVerifications:
		return m.viewVerifications()
	case ViewTrustScores:
		return m.viewTrustScores()
	case ViewClaimDetail:
		return m.viewClaimDetail()
	default:
		return "Unknown view"
	}
}

// Helper function
func clamp(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
