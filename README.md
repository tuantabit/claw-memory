# veridic-claw

Claim verification plugin for [OpenClaw](https://github.com/openclaw/openclaw). Extracts factual claims from agent responses, collects evidence, and verifies them against reality. Don't trust. Verify.

## Table of contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Terminal UI (veridic-tui)](#terminal-ui-veridic-tui)
- [Documentation](#documentation)
- [Development](#development)
- [License](#license)

## What it does

When an AI agent makes claims about actions it performed (files created, tests passed, commands executed), those claims may not always match reality. Veridic-claw:

1. **Extracts claims** from agent responses using regex patterns and optional LLM analysis
2. **Collects evidence** from multiple sources (filesystem, git, command outputs)
3. **Verifies claims** against collected evidence using configurable strategies
4. **Calculates trust scores** based on verification history
5. **Provides tools** (`veridic_verify`, `veridic_audit`, `veridic_expand`, `veridic_score`) for manual verification

Claims are persisted in SQLite. Evidence links back to source claims. Agents can query their verification history and trust scores.

**It's accountability for AI agents. Every claim is tracked. Every action is verified.**

## Quick start

### Prerequisites

- OpenClaw with plugin support
- Node.js 22+
- An LLM provider configured in OpenClaw (optional, for hybrid extraction)

### Install the plugin

Use OpenClaw's plugin installer (recommended):

```bash
openclaw plugins install @openclaw/veridic-claw
```

If you're running from a local OpenClaw checkout, use:

```bash
pnpm openclaw plugins install @openclaw/veridic-claw
```

For local plugin development, link your working copy instead of copying files:

```bash
openclaw plugins install --link /path/to/veridic-claw
# or from a local OpenClaw checkout:
# pnpm openclaw plugins install --link /path/to/veridic-claw
```

### Configure OpenClaw

In most cases, no manual JSON edits are needed after `openclaw plugins install`.

If you need to set it manually:

```json
{
  "plugins": {
    "entries": {
      "veridic-claw": {
        "enabled": true,
        "config": {
          "autoVerify": true,
          "verificationThreshold": 0.7
        }
      }
    }
  }
}
```

Restart OpenClaw after configuration changes.

## Configuration

Veridic-claw is configured through plugin config in your OpenClaw settings.

### Plugin config

Add a `veridic-claw` entry under `plugins.entries` in your OpenClaw config:

```json
{
  "plugins": {
    "entries": {
      "veridic-claw": {
        "enabled": true,
        "config": {
          "enableLLM": true,
          "extractionThreshold": 0.6,
          "verificationThreshold": 0.7,
          "trustWarningThreshold": 70,
          "trustBlockThreshold": 30,
          "autoVerify": true
        }
      }
    }
  }
}
```

### Configuration options

| Option | Default | Description |
|--------|---------|-------------|
| `enableLLM` | `true` | Enable LLM-based claim extraction when regex confidence is low |
| `extractionThreshold` | `0.6` | Minimum confidence for regex extraction before falling back to LLM (0.0–1.0) |
| `verificationThreshold` | `0.7` | Minimum confidence to mark a claim as verified (0.0–1.0) |
| `trustWarningThreshold` | `70` | Trust score below which to show a warning (0–100) |
| `trustBlockThreshold` | `30` | Trust score below which to block actions (0–100) |
| `autoVerify` | `true` | Automatically verify claims after each agent response |

### Recommended starting configuration

```json
{
  "enableLLM": true,
  "extractionThreshold": 0.6,
  "verificationThreshold": 0.7,
  "autoVerify": true
}
```

- **enableLLM=true** uses LLM for complex claims that regex patterns miss
- **extractionThreshold=0.6** falls back to LLM when regex confidence is below 60%
- **verificationThreshold=0.7** requires 70% confidence to mark claims as verified
- **autoVerify=true** automatically verifies claims after each response

## Agent tools

Veridic-claw provides four tools for agents to interact with the verification system:

### veridic_verify

Verify a specific claim or the claims from the last response.

```typescript
// Verify all claims from last response
await veridic_verify({})

// Verify a specific claim
await veridic_verify({ claim: "Created file src/index.ts" })
```

### veridic_audit

Get a full audit report of verification history.

```typescript
// Get audit for current session
await veridic_audit({})

// Get audit for specific session
await veridic_audit({ sessionId: "abc123" })
```

### veridic_expand

Expand a claim to see detailed evidence and verification steps.

```typescript
await veridic_expand({ claimId: "claim_abc123" })
```

### veridic_score

Get the current trust score for an agent or session.

```typescript
// Get trust score for current session
await veridic_score({})

// Get trust score for specific agent
await veridic_score({ agentId: "agent_xyz" })
```

## Claim types

Veridic-claw extracts and verifies the following claim types:

| Claim Type | Example | Verification Method |
|------------|---------|---------------------|
| `file_created` | "I created src/index.ts" | Check file exists |
| `file_modified` | "I updated package.json" | Check file mtime, git diff |
| `file_deleted` | "I removed old.ts" | Check file doesn't exist |
| `command_executed` | "I ran npm install" | Check command output |
| `test_passed` | "All tests pass" | Re-run tests |
| `test_failed` | "Test X fails" | Re-run tests |
| `code_added` | "I added function foo()" | Check code exists |
| `code_removed` | "I removed unused code" | Check code doesn't exist |
| `code_fixed` | "I fixed the bug" | Verify fix works |
| `error_fixed` | "I fixed the error" | Verify error resolved |
| `dependency_added` | "I added lodash" | Check package.json |
| `config_changed` | "I updated the config" | Check config file |
| `task_completed` | "Done with the task" | Verify task completion |

## Terminal UI (veridic-tui)

A standalone Go-based terminal UI for inspecting the Veridic-Claw database. Read-only inspection of claims, evidence, verifications, and trust scores.

### Features

- **Session Browser**: View all verification sessions with trust scores
- **Claims List**: Browse claims with type, confidence, and status
- **Evidence Viewer**: Inspect collected evidence for each claim
- **Verification DAG**: View verification history as a directed acyclic graph
- **Trust Score Dashboard**: Monitor trust score trends over time
- **Search**: Full-text search across all claims

### Installation

From source:

```bash
cd tui
make build
./veridic-tui
```

From release:

Download the binary for your platform from the [releases page](https://github.com/tuantabit/veridic-claw/releases).

### Usage

```bash
# Use default database (~/.openclaw/veridic-claw.db)
veridic-tui

# Use specific database
veridic-tui -db /path/to/veridic-claw.db
```

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `q` | Quit |
| `↑` / `k` | Move up |
| `↓` / `j` | Move down |
| `Enter` | Select / Expand |
| `Esc` | Go back |
| `t` | View trust scores |
| `e` | View evidence |
| `v` | View verifications |

See [tui/README.md](tui/README.md) for full documentation.

## Documentation

- [Architecture](docs/architecture.md)
- [Claim extraction](docs/extraction.md)
- [Evidence collection](docs/evidence.md)
- [Verification strategies](docs/verification.md)
- [Trust scoring](docs/trust-scoring.md)

## Development

```bash
# Install dependencies
pnpm install

# Type check
pnpm typecheck

# Build
pnpm build

# Run tests (via vitest)
pnpm test
```

### Project structure

```
src/                        # TypeScript plugin source
  index.ts                  # Plugin entry point and exports
  engine.ts                 # VeridicEngine — main verification engine
  plugin.ts                 # OpenClaw plugin integration
  schema.ts                 # Database schema initialization
  config.ts                 # VeridicConfig type and defaults
  types.ts                  # Core type definitions
  core/
    database.ts             # SQLite database interface
    index.ts                # Core exports
  extractor/
    claim-extractor.ts      # Claim extraction from text
    llm-extractor.ts        # LLM-based claim extraction
    patterns.ts             # Regex patterns for claim detection
    index.ts                # Extractor exports
  store/
    claim-store.ts          # Claim persistence
    evidence-store.ts       # Evidence persistence
    verification-store.ts   # Verification result persistence
    trust-score-store.ts    # Trust score persistence
    index.ts                # Store exports
  collector/
    evidence-collector.ts   # Evidence collection orchestration
    sources/
      file-source.ts        # Filesystem evidence
      git-source.ts         # Git history evidence
      command-source.ts     # Command output evidence
      tool-source.ts        # Tool call evidence
    index.ts                # Collector exports
  verifier/
    claim-verifier.ts       # Claim verification orchestration
    strategies/
      file-strategy.ts      # File claim verification
      command-strategy.ts   # Command claim verification
      code-strategy.ts      # Code claim verification
      completion-strategy.ts # Task completion verification
    index.ts                # Verifier exports
  tools/
    veridic-verify.ts       # veridic_verify tool
    veridic-audit.ts        # veridic_audit tool
    veridic-expand.ts       # veridic_expand tool
    veridic-score.ts        # veridic_score tool
    index.ts                # Tool exports
tui/                        # Go terminal UI
  main.go                   # TUI entry point (bubbletea)
  data.go                   # SQLite queries
  views.go                  # UI views (lipgloss)
  go.mod                    # Go module
  Makefile                  # Build automation
  README.md                 # TUI documentation
openclaw.plugin.json        # Plugin manifest with config schema
package.json                # Package configuration
tsconfig.json               # TypeScript configuration
vitest.config.ts            # Test configuration
.goreleaser.yml             # Release automation for TUI
```

## License

MIT
