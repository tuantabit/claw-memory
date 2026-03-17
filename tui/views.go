package main

import (
	"fmt"
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// Styles
var (
	titleStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("205")).
			MarginBottom(1)

	headerStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("39")).
			BorderStyle(lipgloss.NormalBorder()).
			BorderBottom(true).
			BorderForeground(lipgloss.Color("240"))

	selectedStyle = lipgloss.NewStyle().
			Background(lipgloss.Color("57")).
			Foreground(lipgloss.Color("255")).
			Bold(true)

	normalStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("252"))

	dimStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("240"))

	successStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("46"))

	warningStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("226"))

	errorStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("196"))

	infoStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("75"))

	helpStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("241")).
			MarginTop(1)

	boxStyle = lipgloss.NewStyle().
			Border(lipgloss.RoundedBorder()).
			BorderForeground(lipgloss.Color("240")).
			Padding(1, 2)
)

// viewSessions renders the sessions list
func (m Model) viewSessions() string {
	var b strings.Builder

	b.WriteString(titleStyle.Render("veridic-tui"))
	b.WriteString("\n")
	b.WriteString(headerStyle.Render("Sessions"))
	b.WriteString("\n\n")

	if len(m.sessions) == 0 {
		b.WriteString(dimStyle.Render("No sessions found. Run veridic-claw first."))
		b.WriteString("\n")
	} else {
		for i, s := range m.sessions {
			// Format session line
			trustColor := getTrustColor(s.TrustScore)
			trustBadge := lipgloss.NewStyle().Foreground(trustColor).Render(
				fmt.Sprintf("[%.0f%%]", s.TrustScore))

			verifiedRatio := fmt.Sprintf("%d/%d verified", s.VerifiedCount, s.ClaimCount)

			line := fmt.Sprintf("  %s  %s  %s  %s",
				truncate(s.SessionID, 20),
				trustBadge,
				dimStyle.Render(verifiedRatio),
				dimStyle.Render(s.LastActivity.Format("2006-01-02 15:04")),
			)

			if i == m.selectedSession {
				b.WriteString(selectedStyle.Render("▶ " + line))
			} else {
				b.WriteString(normalStyle.Render("  " + line))
			}
			b.WriteString("\n")
		}
	}

	b.WriteString(m.sessionHelp())
	return b.String()
}

// viewClaims renders the claims list for a session
func (m Model) viewClaims() string {
	var b strings.Builder

	sessionID := ""
	if len(m.sessions) > 0 {
		sessionID = m.sessions[m.selectedSession].SessionID
	}

	b.WriteString(titleStyle.Render("Claims"))
	b.WriteString("\n")
	b.WriteString(dimStyle.Render("Session: " + truncate(sessionID, 30)))
	b.WriteString("\n\n")

	if len(m.claims) == 0 {
		b.WriteString(dimStyle.Render("No claims found in this session."))
		b.WriteString("\n")
	} else {
		for i, c := range m.claims {
			// Get verification status indicator
			statusIcon := getStatusIcon(c.ClaimType)
			confidenceBadge := getConfidenceBadge(c.Confidence)

			line := fmt.Sprintf("%s %s %s %s",
				statusIcon,
				lipgloss.NewStyle().Width(15).Render(c.ClaimType),
				confidenceBadge,
				truncate(c.OriginalText, 50),
			)

			if i == m.selectedClaim {
				b.WriteString(selectedStyle.Render("▶ " + line))
			} else {
				b.WriteString(normalStyle.Render("  " + line))
			}
			b.WriteString("\n")
		}
	}

	b.WriteString(m.claimsHelp())
	return b.String()
}

// viewEvidence renders evidence for a claim
func (m Model) viewEvidence() string {
	var b strings.Builder

	claimText := ""
	if len(m.claims) > 0 {
		claimText = m.claims[m.selectedClaim].OriginalText
	}

	b.WriteString(titleStyle.Render("Evidence"))
	b.WriteString("\n")
	b.WriteString(dimStyle.Render("Claim: " + truncate(claimText, 50)))
	b.WriteString("\n\n")

	if len(m.evidence) == 0 {
		b.WriteString(dimStyle.Render("No evidence collected for this claim."))
		b.WriteString("\n")
	} else {
		for i, e := range m.evidence {
			supportIcon := "✗"
			supportStyle := errorStyle
			if e.SupportsClaim {
				supportIcon = "✓"
				supportStyle = successStyle
			}

			sourceBadge := lipgloss.NewStyle().
				Background(lipgloss.Color("237")).
				Padding(0, 1).
				Render(e.Source)

			line := fmt.Sprintf("%s %s [%.0f%%] %s",
				supportStyle.Render(supportIcon),
				sourceBadge,
				e.Confidence*100,
				truncate(e.Content, 40),
			)

			if i == m.selectedEvidence {
				b.WriteString(selectedStyle.Render("▶ " + line))
			} else {
				b.WriteString(normalStyle.Render("  " + line))
			}
			b.WriteString("\n")
		}
	}

	b.WriteString(m.evidenceHelp())
	return b.String()
}

// viewVerifications renders verification history (DAG)
func (m Model) viewVerifications() string {
	var b strings.Builder

	b.WriteString(titleStyle.Render("Verification History (DAG)"))
	b.WriteString("\n\n")

	if len(m.verifications) == 0 {
		b.WriteString(dimStyle.Render("No verifications found."))
		b.WriteString("\n")
	} else {
		for _, v := range m.verifications {
			// Indent based on depth
			indent := strings.Repeat("  ", v.Depth)
			connector := "├─"
			if v.Depth == 0 {
				connector = "●"
			}

			statusStyle := getVerificationStatusStyle(v.Status)
			statusBadge := statusStyle.Render(v.Status)

			line := fmt.Sprintf("%s%s %s [%.0f%%] %s",
				indent,
				connector,
				statusBadge,
				v.Confidence*100,
				dimStyle.Render(v.VerifiedAt.Format("2006-01-02 15:04:05")),
			)

			b.WriteString(normalStyle.Render(line))
			b.WriteString("\n")

			// Show evidence count
			if len(v.EvidenceIDs) > 0 {
				evidenceLine := fmt.Sprintf("%s   └ %d evidence items",
					indent,
					len(v.EvidenceIDs),
				)
				b.WriteString(dimStyle.Render(evidenceLine))
				b.WriteString("\n")
			}
		}
	}

	b.WriteString(m.verificationsHelp())
	return b.String()
}

// viewTrustScores renders trust score history
func (m Model) viewTrustScores() string {
	var b strings.Builder

	b.WriteString(titleStyle.Render("Trust Score History"))
	b.WriteString("\n\n")

	if len(m.trustScores) == 0 {
		b.WriteString(dimStyle.Render("No trust scores recorded."))
		b.WriteString("\n")
	} else {
		// Show current score prominently
		current := m.trustScores[0]
		scoreColor := getTrustColor(current.OverallScore)
		currentScore := lipgloss.NewStyle().
			Bold(true).
			Foreground(scoreColor).
			Render(fmt.Sprintf("%.1f%%", current.OverallScore))

		b.WriteString(fmt.Sprintf("Current Score: %s\n", currentScore))
		b.WriteString(dimStyle.Render(current.CreatedAt.Format("2006-01-02 15:04:05")))
		b.WriteString("\n\n")

		// Show category breakdown
		if len(current.CategoryScores) > 0 {
			b.WriteString(headerStyle.Render("Categories"))
			b.WriteString("\n")
			for cat, score := range current.CategoryScores {
				catColor := getTrustColor(score)
				b.WriteString(fmt.Sprintf("  %-20s %s\n",
					cat,
					lipgloss.NewStyle().Foreground(catColor).Render(fmt.Sprintf("%.1f%%", score)),
				))
			}
			b.WriteString("\n")
		}

		// Show history graph (simplified)
		b.WriteString(headerStyle.Render("History"))
		b.WriteString("\n")
		for _, ts := range m.trustScores {
			bar := renderScoreBar(ts.OverallScore, 30)
			b.WriteString(fmt.Sprintf("  %s %s %.0f%%\n",
				dimStyle.Render(ts.CreatedAt.Format("01-02 15:04")),
				bar,
				ts.OverallScore,
			))
		}
	}

	b.WriteString(m.trustScoresHelp())
	return b.String()
}

// viewClaimDetail renders detailed view of a single claim
func (m Model) viewClaimDetail() string {
	var b strings.Builder

	if len(m.claims) == 0 || m.selectedClaim >= len(m.claims) {
		return "No claim selected"
	}

	c := m.claims[m.selectedClaim]

	b.WriteString(titleStyle.Render("Claim Detail"))
	b.WriteString("\n\n")

	// Claim info box
	info := fmt.Sprintf(`ID:         %s
Type:       %s
Confidence: %.0f%%
Created:    %s

Text:
%s`,
		c.ClaimID,
		c.ClaimType,
		c.Confidence*100,
		c.CreatedAt.Format("2006-01-02 15:04:05"),
		c.OriginalText,
	)

	b.WriteString(boxStyle.Render(info))
	b.WriteString("\n\n")

	// Entities
	if len(c.Entities) > 0 {
		b.WriteString(headerStyle.Render("Entities"))
		b.WriteString("\n")
		for _, e := range c.Entities {
			b.WriteString(fmt.Sprintf("  %s: %s\n",
				infoStyle.Render(e.Type),
				normalStyle.Render(e.Value),
			))
		}
	}

	b.WriteString(m.claimDetailHelp())
	return b.String()
}

// Helper functions

func getTrustColor(score float64) lipgloss.Color {
	if score >= 70 {
		return lipgloss.Color("46") // green
	} else if score >= 30 {
		return lipgloss.Color("226") // yellow
	}
	return lipgloss.Color("196") // red
}

func getStatusIcon(claimType string) string {
	switch claimType {
	case "file_created", "file_modified":
		return "📄"
	case "file_deleted":
		return "🗑️"
	case "command_executed":
		return "⚡"
	case "test_passed":
		return "✅"
	case "test_failed":
		return "❌"
	case "code_added", "code_fixed":
		return "🔧"
	case "dependency_added":
		return "📦"
	default:
		return "•"
	}
}

func getConfidenceBadge(confidence float64) string {
	color := getTrustColor(confidence * 100)
	return lipgloss.NewStyle().
		Foreground(color).
		Render(fmt.Sprintf("[%.0f%%]", confidence*100))
}

func getVerificationStatusStyle(status string) lipgloss.Style {
	switch status {
	case "verified":
		return successStyle
	case "contradicted":
		return errorStyle
	case "unverified":
		return warningStyle
	default:
		return dimStyle
	}
}

func renderScoreBar(score float64, width int) string {
	filled := int(score / 100 * float64(width))
	if filled > width {
		filled = width
	}
	bar := strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
	color := getTrustColor(score)
	return lipgloss.NewStyle().Foreground(color).Render(bar)
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen-3] + "..."
}

// Help text

func (m Model) sessionHelp() string {
	return helpStyle.Render("\n↑/↓: navigate • enter: view claims • t: trust scores • q: quit")
}

func (m Model) claimsHelp() string {
	return helpStyle.Render("\n↑/↓: navigate • enter: detail • e: evidence • v: verifications • esc: back • q: quit")
}

func (m Model) evidenceHelp() string {
	return helpStyle.Render("\n↑/↓: navigate • esc: back • q: quit")
}

func (m Model) verificationsHelp() string {
	return helpStyle.Render("\nesc: back • q: quit")
}

func (m Model) trustScoresHelp() string {
	return helpStyle.Render("\nesc: back • q: quit")
}

func (m Model) claimDetailHelp() string {
	return helpStyle.Render("\ne: evidence • v: verifications • esc: back • q: quit")
}
