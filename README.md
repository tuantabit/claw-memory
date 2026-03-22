# claw-memory

Unified memory and verification system for AI agents. Solves three critical problems:

1. **Forgetting** - Agent loses context of what it did
2. **False Claims** - Agent says "done" but didn't do it
3. **Context Bloat** - Context fills with irrelevant data

## How it works

```
Agent Action → Receipt Created → Claim Extracted → Verified Against Receipt
                                                            ↓
                                             Contradiction? → Auto Retry (max 2)
                                                            ↓
                                             Still failed? → Warn User
                                                            ↓
                                             Trust Score Updated
```

When an agent performs actions, claw-memory:
- **Captures receipts** (file hashes, command outputs) as immutable proof
- **Extracts claims** from agent responses ("I created X", "I fixed Y")
- **Verifies claims** against receipts
- **Auto-retries** contradicted claims up to 2 times
- **Warns user** if retries fail
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
import { createClawMemoryPlugin, createDatabase } from "claw-memory";

const db = createDatabase("./claw-memory.db");
const plugin = createClawMemoryPlugin(db, {
  autoVerify: true,
  trustWarningThreshold: 70,
  trustBlockThreshold: 30,
  retry: {
    enabled: true,
    maxRetries: 2,
    notifyUser: true,
  },
});

// Plugin provides hooks:
// - before_agent_start: Check trust, inject warnings
// - on_tool_call: Create action record
// - on_tool_result: Create file/command receipts
// - agent_end: Extract claims, verify, auto-retry, update trust
```

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           CLAW-MEMORY v0.2                               │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ LOSSLESS    │  │ MEMORY      │  │ VERIFY      │  │ AUTO RETRY      │  │
│  │ BRIDGE      │  │ BRIDGE      │  │ ENGINE      │  │ SYSTEM          │  │
│  ├─────────────┤  ├─────────────┤  ├─────────────┤  ├─────────────────┤  │
│  │ Messages    │  │ Short-term  │  │ Claim       │  │ Max 2 retries   │  │
│  │ Summaries   │  │ Long-term   │  │ Evidence    │  │ User notify     │  │
│  │ Context Asm │  │ Digest+FTS5 │  │ Trust Score │  │ Retry prompts   │  │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────┘  │
│         │                │                │                  │           │
│  ┌──────┴────────────────┴────────────────┴──────────────────┘           │
│  │                                                                       │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐   │
│  │  │ VECTOR      │  │ KNOWLEDGE   │  │ TEMPORAL                    │   │
│  │  │ SEARCH      │  │ GRAPH       │  │ MEMORY                      │   │
│  │  ├─────────────┤  ├─────────────┤  ├─────────────────────────────┤   │
│  │  │ Embeddings  │  │ Entities    │  │ Timeline queries            │   │
│  │  │ Cosine sim  │  │ Relations   │  │ "last week", "3 days ago"   │   │
│  │  │ 128-dim     │  │ BFS paths   │  │ Event aggregation           │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────────┘   │
│  │                                                                       │
│  └───────────────────────────┬───────────────────────────────────────────┘
│                              │                                           │
│                     ┌────────┴────────┐                                 │
│                     │ RECEIPT SYSTEM   │                                 │
│                     │ file | command   │                                 │
│                     └─────────────────┘                                  │
│                              │                                           │
│                     ┌────────┴────────┐                                 │
│                     │     SQLite       │                                 │
│                     │  (node:sqlite)   │                                 │
│                     └─────────────────┘                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

## Core components

### Auto Retry System

Automatically retries contradicted claims:

```typescript
// When claim is contradicted:
// 1. Generate retry prompt specific to claim type
// 2. Send to agent for actual execution
// 3. Re-verify the claim
// 4. Repeat up to maxRetries (default: 2)
// 5. Notify user if all retries fail

const retryResult = {
  success: false,
  retriesAttempted: 2,
  finalStatus: 'max_retries_exceeded',
  userNotification: '[VERIFICATION FAILED] Claim: "I created src/app.ts"...',
  suggestions: ['Check if the file path is correct', 'Run manually...'],
};
```

### Vector Search (Semantic Memory)

Find similar memories without exact keyword matching:

```typescript
// Store memory with embedding
const embedding = await embeddingService.embed("Created auth service");
await vectorStore.store(memoryId, sessionId, embedding, "local");

// Search semantically
const query = await embeddingService.embed("login authentication");
const results = await vectorStore.search(query, { limit: 5 });
// Returns: [{ memoryId, similarity: 0.85 }, ...]
```

Features:
- 128-dimensional hash-based embeddings (no external API needed)
- Cosine similarity search
- Session-scoped queries

### Knowledge Graph

Track entity relationships:

```typescript
// Entities: file, function, class, component, command, package, test, error
// Relationships: CONTAINS, IMPORTS, DEPENDS_ON, CALLS, TESTS, FIXES

// Extract from claims
const { entities, relationships } = await graphService.processClaim(claim);

// Find path between entities
const path = await graphService.findPath(fileEntityId, testEntityId);
// Returns: { nodes: [file, function, test], edges: [CONTAINS, TESTS] }

// Get neighbors
const neighbors = await graphService.getNeighbors(entityId, depth=2);
```

### Temporal Memory

Query by time with natural language:

```typescript
// Supported expressions:
// - "today", "yesterday"
// - "last week", "this month"
// - "3 days ago", "last 5 hours"
// - "2 weeks ago", "last 3 months"

const events = await timelineService.queryByTimeExpression(
  sessionId,
  "last week"
);

// Get timeline segments
const segments = await timelineService.getTimelineSegments(
  sessionId,
  "day" // or "hour", "week", "month"
);
```

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
CLAW_MEMORY_ENABLE_LLM=true           # LLM-based extraction
CLAW_MEMORY_EXTRACTION_THRESHOLD=0.6  # Regex confidence threshold
CLAW_MEMORY_VERIFICATION_THRESHOLD=0.7
CLAW_MEMORY_WARNING_THRESHOLD=70      # Trust score warning
CLAW_MEMORY_BLOCK_THRESHOLD=30        # Trust score block
CLAW_MEMORY_AUTO_VERIFY=true
CLAW_MEMORY_RETRY_ENABLED=true        # Auto-retry on contradiction
CLAW_MEMORY_RETRY_MAX=2               # Max retry attempts
```

### Programmatic config

```typescript
createClawMemoryPlugin(db, {
  enableLLM: true,
  extractionThreshold: 0.6,
  verificationThreshold: 0.7,
  trustWarningThreshold: 70,
  trustBlockThreshold: 30,
  autoVerify: true,
  maxClaimsPerSession: 1000,
  retry: {
    enabled: true,
    maxRetries: 2,
    notifyUser: true,
    minContradictionConfidence: 0.7,
  },
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
| `claw-memory_verify` | Verify specific claim or last response |
| `claw-memory_audit` | Get full verification history |
| `claw-memory_expand` | Expand claim with evidence details |
| `claw-memory_score` | Get current trust score |
| `claw-memory_compact` | Trigger database compaction |

## Database schema

### Core tables

```sql
-- Messages and summaries (Lossless)
messages, summaries

-- Memory with FTS5 search
memory_entries, memory_fts

-- Vector embeddings (Semantic)
memory_vectors

-- Knowledge Graph
entities, relationships

-- Temporal Events
temporal_events

-- Receipts (proof of actions)
actions, file_receipts, command_receipts

-- Verification
claims, evidence, verifications, trust_scores
```

### Archive tables

```sql
claims_archive, evidence_archive, daily_summaries, compaction_history
```

## Project structure

```
src/
├── index.ts                    # Entry point
├── engine.ts                   # ClawMemoryEngine (main orchestrator)
├── plugin.ts                   # OpenClaw plugin with hooks
├── schema.ts                   # Database schema
├── config.ts                   # Configuration
├── types.ts                    # Type definitions
│
├── core/
│   └── database.ts             # SQLite wrapper (node:sqlite)
│
├── retry/                      # Auto-retry system
│   ├── types.ts                # Retry types and config
│   ├── retry-prompt.ts         # Prompt generation per claim type
│   ├── retry-manager.ts        # Retry orchestration
│   └── index.ts
│
├── memory/                     # Vector search (semantic)
│   ├── types.ts                # Embedding types
│   ├── embedding-service.ts    # Hash-based local embeddings
│   ├── vector-store.ts         # SQLite BLOB storage + cosine search
│   └── index.ts
│
├── graph/                      # Knowledge graph
│   ├── types.ts                # Entity and relationship types
│   ├── entity-store.ts         # Entity CRUD with normalization
│   ├── relationship-store.ts   # Relationship CRUD
│   ├── graph-service.ts        # BFS path finding, neighbor discovery
│   └── index.ts
│
├── temporal/                   # Temporal memory
│   ├── types.ts                # Event types
│   ├── temporal-store.ts       # Time-based event storage
│   ├── timeline-service.ts     # Natural language time parsing
│   └── index.ts
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
    └── claw-memory-*.ts            # Agent tools
```

## Terminal UI

Go-based TUI for database inspection:

```bash
cd tui
make build
./claw-memory-tui -db ~/.openclaw/claw-memory.db
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
