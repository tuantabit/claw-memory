# veridic-claw

Claim verification extension for [OpenClaw](https://github.com/openclaw/openclaw). Extracts factual claims from agent responses, collects evidence, and verifies them against reality. Don't trust. Verify.

## Table of contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Agent tools](#agent-tools)
- [Claim types](#claim-types)
- [Evidence sources](#evidence-sources)
- [Compaction](#compaction)
- [Terminal UI (veridic-tui)](#terminal-ui-veridic-tui)
- [Development](#development)
- [Project structure](#project-structure)
- [License](#license)

## What it does

When an AI agent makes claims about actions it performed (files created, tests passed, commands executed), those claims may not always match reality. Veridic-claw:

1. **Extracts claims** from agent responses using regex patterns and optional LLM analysis
2. **Collects evidence** from multiple sources (filesystem, git, command receipts, tool calls)
3. **Verifies claims** against collected evidence using configurable strategies
4. **Calculates trust scores** based on verification history
5. **Compacts old data** with configurable retention and archiving
6. **Provides tools** for manual verification and auditing

Claims are persisted in SQLite. Evidence links back to source claims. Agents can query their verification history and trust scores.

**It's accountability for AI agents. Every claim is tracked. Every action is verified.**

## Quick start

### Prerequisites

- Node.js **22.5.0+** (uses built-in `node:sqlite` module)
- OpenClaw with extension support

### Install

```bash
# Clone the repository
git clone https://github.com/tuantabit/veridic-claw.git
cd veridic-claw

# Install dependencies
pnpm install

# Build
pnpm build
```

### Configure OpenClaw

Add veridic-claw as an extension in your OpenClaw configuration:

```json
{
  "openclaw": {
    "extensions": ["./path/to/veridic-claw/dist/index.js"]
  }
}
```

## Configuration

Veridic-claw supports configuration via environment variables or programmatic config.

### Configuration options

| Option | Default | Description |
|--------|---------|-------------|
| `enableLLM` | `true` | Enable LLM-based claim extraction when regex confidence is low |
| `extractionThreshold` | `0.6` | Minimum confidence for regex extraction before falling back to LLM |
| `verificationThreshold` | `0.7` | Minimum confidence to mark a claim as verified |
| `trustWarningThreshold` | `70` | Trust score below which to show a warning (0–100) |
| `trustBlockThreshold` | `30` | Trust score below which to block actions (0–100) |
| `autoVerify` | `true` | Automatically verify claims after each agent response |
| `enableRealtime` | `true` | Enable real-time verification |
| `maxClaimsPerSession` | `1000` | Maximum claims to track per session |

### Environment variables

```bash
VERIDIC_ENABLE_LLM=true
VERIDIC_EXTRACTION_THRESHOLD=0.6
VERIDIC_VERIFICATION_THRESHOLD=0.7
VERIDIC_WARNING_THRESHOLD=70
VERIDIC_BLOCK_THRESHOLD=30
VERIDIC_REALTIME=true
VERIDIC_AUTO_VERIFY=true
```

### Compaction configuration

| Option | Default | Description |
|--------|---------|-------------|
| `retentionDays` | `30` | Days to retain claims before archiving |
| `preserveContradicted` | `true` | Never archive contradicted claims |
| `preserveLowTrust` | `true` | Never archive low trust sessions |
| `autoCompact` | `false` | Enable automatic compaction |
| `compactInterval` | `0 2 * * *` | Cron expression for auto-compaction |
| `vacuum` | `true` | Run VACUUM after compaction |
| `analyze` | `true` | Run ANALYZE after compaction |

## Agent tools

Veridic-claw provides five tools for agents to interact with the verification system:

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

Get the current trust score for a session.

```typescript
// Get trust score for current session
await veridic_score({})

// Get trust score for specific session
await veridic_score({ sessionId: "session_xyz" })
```

### veridic_compact

Manually trigger database compaction.

```typescript
// Compact with default settings
await veridic_compact({})

// Compact with custom retention
await veridic_compact({ retentionDays: 7 })
```

## Claim types

Veridic-claw extracts and verifies the following claim types:

| Claim Type | Example | Verification Strategy |
|------------|---------|----------------------|
| `file_created` | "I created src/index.ts" | File existence + receipt |
| `file_modified` | "I updated package.json" | File hash change + receipt |
| `file_deleted` | "I removed old.ts" | File non-existence |
| `code_added` | "I added function foo()" | Code content search |
| `code_removed` | "I removed unused code" | Code absence verification |
| `code_fixed` | "I fixed the bug" | Code change + test result |
| `command_executed` | "I ran npm install" | Command receipt |
| `test_passed` | "All tests pass" | Exit code = 0 |
| `test_failed` | "Test X fails" | Exit code ≠ 0 |
| `error_fixed` | "I fixed the error" | Error resolution verification |
| `dependency_added` | "I added lodash" | Package.json check |
| `config_changed` | "I updated the config" | Config file change |
| `task_completed` | "Done with the task" | Task completion verification |

## Evidence sources

Evidence is collected from multiple sources:

| Source | Description |
|--------|-------------|
| `file_receipt` | File hash before/after from ClawMemory |
| `command_receipt` | Command exit code, stdout from ClawMemory |
| `filesystem` | Direct file existence, size, mtime checks |
| `git_diff` | Git history and diff analysis |
| `tool_call` | Tool input/output from agent actions |
| `code_content` | Code pattern matching in files |

## Compaction

Veridic-claw includes a compaction system to manage database size:

- **Archive**: Move old claims/evidence to archive tables
- **Aggregate**: Create daily summaries from archived data
- **Cleanup**: Remove orphaned data
- **Optimize**: VACUUM and ANALYZE database

Contradicted claims are preserved by default to maintain accountability history.

## Terminal UI (veridic-tui)

A standalone Go-based terminal UI for inspecting the Veridic-Claw database.

### Features

- Session browser with trust scores
- Claims list with type, confidence, and status
- Evidence viewer for each claim
- Trust score dashboard
- Search across all claims
- Export to JSON, Markdown, CSV

### Build and run

```bash
cd tui
make build
./veridic-tui

# Use specific database
./veridic-tui -db /path/to/veridic-claw.db
```

### Keyboard shortcuts

| Key | Action |
|-----|--------|
| `q` | Quit |
| `↑/k` | Move up |
| `↓/j` | Move down |
| `Enter` | Select / Expand |
| `Esc` | Go back |
| `t` | View trust scores |
| `e` | View evidence |
| `s` | Search |
| `x` | Export |

## Development

```bash
# Install dependencies
pnpm install

# Type check
pnpm typecheck

# Build
pnpm build

# Watch mode
pnpm dev

# Clean
pnpm clean
```

## Project structure

```
src/
├── index.ts                 # Extension entry point and exports
├── engine.ts                # VeridicEngine — main verification engine
├── plugin.ts                # OpenClaw extension integration
├── schema.ts                # Database schema initialization
├── config.ts                # VeridicConfig type and defaults
├── types.ts                 # Core type definitions
├── core/
│   └── database.ts          # SQLite database (node:sqlite)
├── extractor/
│   ├── claim-extractor.ts   # Claim extraction from text
│   ├── llm-extractor.ts     # LLM-based claim extraction
│   └── patterns.ts          # Regex patterns for claim detection
├── store/
│   ├── claim-store.ts       # Claim persistence
│   ├── evidence-store.ts    # Evidence persistence
│   ├── verification-store.ts # Verification result persistence
│   └── trust-score-store.ts # Trust score persistence
├── collector/
│   ├── evidence-collector.ts # Evidence collection orchestration
│   └── sources/
│       ├── file-source.ts    # Filesystem evidence
│       ├── git-source.ts     # Git history evidence
│       ├── command-source.ts # Command receipt evidence
│       ├── tool-source.ts    # Tool call evidence
│       └── receipt-source.ts # ClawMemory receipt evidence
├── verifier/
│   ├── claim-verifier.ts    # Claim verification orchestration
│   └── strategies/
│       ├── file-strategy.ts      # File claim verification
│       ├── command-strategy.ts   # Command claim verification
│       ├── code-strategy.ts      # Code claim verification
│       ├── completion-strategy.ts # Task completion verification
│       └── receipt-strategy.ts   # Receipt-based verification
├── compactor/
│   ├── compactor.ts         # Database compaction logic
│   └── types.ts             # Compaction types and config
├── shared/
│   ├── database-adapter.ts  # Unified database adapter
│   ├── memory-bridge.ts     # ClawMemory integration
│   ├── unified-assembler.ts # Context assembly
│   └── lossless-bridge.ts   # Lossless-Claw integration
├── context/
│   └── lossless-bridge.ts   # Context engine bridge
└── tools/
    ├── veridic-verify.ts    # veridic_verify tool
    ├── veridic-audit.ts     # veridic_audit tool
    ├── veridic-expand.ts    # veridic_expand tool
    ├── veridic-score.ts     # veridic_score tool
    └── veridic-compact.ts   # veridic_compact tool

tui/                         # Go terminal UI
├── main.go                  # TUI entry point (bubbletea)
├── data.go                  # SQLite queries
├── views.go                 # UI views (lipgloss)
├── export.go                # Export functionality
├── go.mod                   # Go module
├── Makefile                 # Build automation
└── README.md                # TUI documentation
```

## Database

Veridic-claw uses Node.js built-in SQLite module (`node:sqlite`, available from v22.5.0+).

Database location: `~/.openclaw/veridic-claw.db`

### Main tables

- `claims` — Extracted claims with type, confidence, entities
- `evidence` — Collected evidence linked to claims
- `verifications` — Verification results with status and confidence
- `trust_scores` — Trust score history per session

### Archive tables

- `claims_archive` — Archived old claims
- `evidence_archive` — Archived old evidence
- `daily_summaries` — Aggregated daily statistics
- `compaction_history` — Compaction run history

## License

MIT
