# claw-memory

Unified memory and verification system for AI agents. Solves three critical problems:

1. **Forgetting** - Agent loses context of what it did
2. **False Claims** - Agent says "done" but didn't do it
3. **Context Bloat** - Context fills with irrelevant data

## How it works

```
Agent Action → Receipt Created → Claim Extracted → Verified Against Receipt → Trust Score Updated
```

When an agent performs actions, claw-memory:
- **Captures receipts** (file hashes, command outputs) as immutable proof
- **Extracts claims** from agent responses ("I created X", "I fixed Y")
- **Verifies claims** against receipts
- **Updates trust score** based on verification history
- **Persists everything** to SQLite for cross-session memory

## Quick start

### Requirements

- Node.js **22.5.0+** (uses built-in `node:sqlite`)

### Install

```bash
git clone https://github.com/tuantabit/claw-memory.git
cd claw-memory
pnpm install
pnpm build
```

### Use as OpenClaw extension

```json
{
  "extensions": ["./path/to/claw-memory/dist/index.js"]
}
```

### Programmatic usage

```typescript
import { createVeridicPlugin, createDatabase } from "claw-memory";

const db = createDatabase("./claw-memory.db");
const plugin = createVeridicPlugin(db, {
  autoVerify: true,
  trustWarningThreshold: 70,
  trustBlockThreshold: 30,
});

// Plugin provides hooks:
// - before_agent_start: Check trust, inject warnings
// - on_tool_call: Create action record
// - on_tool_result: Create file/command receipts
// - agent_end: Extract claims, verify, update trust
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       CLAW-MEMORY                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────────┐  │
│  │ LOSSLESS      │  │ MEMORY        │  │ VERIFICATION    │  │
│  │ BRIDGE        │  │ BRIDGE        │  │ ENGINE          │  │
│  ├───────────────┤  ├───────────────┤  ├─────────────────┤  │
│  │ Messages      │  │ Short-term    │  │ Claim Extractor │  │
│  │ Summaries     │  │ Long-term     │  │ Evidence Collect│  │
│  │ Context Asm   │  │ Digest + FTS5 │  │ Trust Scoring   │  │
│  └───────────────┘  └───────────────┘  └─────────────────┘  │
│         │                  │                   │             │
│         └──────────────────┼───────────────────┘             │
│                            │                                 │
│                   ┌────────┴────────┐                       │
│                   │ RECEIPT SYSTEM   │                       │
│                   │ file | command   │                       │
│                   └─────────────────┘                        │
│                            │                                 │
│                   ┌────────┴────────┐                       │
│                   │     SQLite       │                       │
│                   │  (node:sqlite)   │                       │
│                   └─────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
```

## Core components

### Receipt Collector

Captures immutable proof of agent actions:

```typescript
// File operations create file_receipts
{
  file_path: "src/index.ts",
  operation: "create",
  before_hash: null,        // didn't exist
  after_hash: "abc123..."   // now exists
}

// Commands create command_receipts
{
  command: "npm test",
  exit_code: 0,
  stdout: "All tests passed",
  duration_ms: 1234
}
```

### Claim Extractor

Extracts verifiable claims from agent responses:

| Claim Type | Example | Evidence Source |
|------------|---------|-----------------|
| `file_created` | "I created src/app.ts" | file_receipt |
| `file_modified` | "I updated config" | file_receipt |
| `command_executed` | "I ran npm install" | command_receipt |
| `test_passed` | "All tests pass" | command_receipt |
| `test_failed` | "Test X fails" | command_receipt |
| `code_added` | "I added function X" | code_content |
| `error_fixed` | "I fixed the bug" | file + command |

### Memory Bridge

3-layer memory system with decay:

```
Layer        │ Retention │ Entries │ Use Case
─────────────┼───────────┼─────────┼──────────────────
Short-term   │ 24h       │ 1000    │ Recent actions
Long-term    │ 30d       │ 10000   │ Important patterns
Digest       │ Forever   │ -       │ Compressed summaries
```

Decay levels: `FULL → SUMMARY → ESSENCE → HASH`

### Lossless Bridge

Context management with DAG summarization:

- Stores all messages permanently
- Creates hierarchical summaries
- Assembles context within token limits
- Supports LLM-based summarization

### Trust Scoring

```
Trust Score: 0-100

Calculation:
├── Verified claims:     +points (weighted by type)
├── Contradicted claims: -points (2x penalty)
└── Trend:              improving / declining / stable

Thresholds:
├── 70-100: Normal
├── 30-70:  Warning
└── 0-30:   Blocked
```

## Configuration

### Environment variables

```bash
VERIDIC_ENABLE_LLM=true           # LLM-based extraction
VERIDIC_EXTRACTION_THRESHOLD=0.6  # Regex confidence threshold
VERIDIC_VERIFICATION_THRESHOLD=0.7
VERIDIC_WARNING_THRESHOLD=70      # Trust score warning
VERIDIC_BLOCK_THRESHOLD=30        # Trust score block
VERIDIC_AUTO_VERIFY=true
```

### Programmatic config

```typescript
createVeridicPlugin(db, {
  enableLLM: true,
  extractionThreshold: 0.6,
  verificationThreshold: 0.7,
  trustWarningThreshold: 70,
  trustBlockThreshold: 30,
  autoVerify: true,
  maxClaimsPerSession: 1000,
  compaction: {
    retentionDays: 30,
    preserveContradicted: true,
    autoCompact: true,
    compactInterval: "0 2 * * *",
  },
});
```

## Agent tools

| Tool | Description |
|------|-------------|
| `veridic_verify` | Verify specific claim or last response |
| `veridic_audit` | Get full verification history |
| `veridic_expand` | Expand claim with evidence details |
| `veridic_score` | Get current trust score |
| `veridic_compact` | Trigger database compaction |

## Database schema

### Core tables

```sql
-- Messages and summaries (Lossless)
messages, summaries

-- Memory with FTS5 search
memory_entries, memory_fts

-- Receipts (proof of actions)
actions, file_receipts, command_receipts

-- Verification
claims, evidence, verifications, trust_scores

-- Linking tables
claim_receipts, message_claims, verification_memories
```

### Archive tables

```sql
claims_archive, evidence_archive, daily_summaries, compaction_history
```

## Project structure

```
src/
├── index.ts                    # Entry point
├── engine.ts                   # VeridicEngine
├── plugin.ts                   # OpenClaw plugin
├── schema.ts                   # Database schema
├── config.ts                   # Configuration
├── types.ts                    # Type definitions
│
├── core/
│   └── database.ts             # SQLite wrapper (node:sqlite)
│
├── store/
│   ├── claim-store.ts
│   ├── evidence-store.ts
│   ├── verification-store.ts
│   ├── trust-score-store.ts
│   ├── message-store.ts        # Lossless messages
│   ├── summary-store.ts        # DAG summaries
│   ├── memory-store.ts         # 3-layer memory
│   └── receipt-store.ts        # Actions and receipts
│
├── extractor/
│   ├── claim-extractor.ts
│   ├── llm-extractor.ts
│   └── patterns.ts
│
├── collector/
│   ├── evidence-collector.ts
│   ├── receipt-collector.ts    # Capture tool call receipts
│   └── sources/
│       ├── file-source.ts
│       ├── git-source.ts
│       ├── command-source.ts
│       ├── tool-source.ts
│       └── receipt-source.ts   # Query receipts for verification
│
├── verifier/
│   ├── claim-verifier.ts
│   └── strategies/
│
├── context/
│   └── lossless-bridge.ts      # Context engine
│
├── shared/
│   ├── database-adapter.ts     # Unified DB adapter
│   ├── memory-bridge.ts        # Memory integration
│   └── unified-assembler.ts    # Context assembly
│
├── compactor/
│   ├── compactor.ts
│   └── types.ts
│
└── tools/
    └── veridic-*.ts            # Agent tools
```

## Terminal UI

Go-based TUI for database inspection:

```bash
cd tui
make build
./veridic-tui -db ~/.openclaw/claw-memory.db
```

| Key | Action |
|-----|--------|
| `q` | Quit |
| `j/k` | Navigate |
| `Enter` | Select |
| `t` | Trust scores |
| `e` | Evidence |
| `s` | Search |
| `x` | Export |

## Development

```bash
pnpm install     # Install dependencies
pnpm build       # Build
pnpm typecheck   # Type check
pnpm dev         # Watch mode
pnpm clean       # Clean dist
```

## License

MIT
