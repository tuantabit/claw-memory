# claw-memory

Memory and verification system for AI agents. Solves two critical problems:

1. **Forgetting** - Agent loses context of what it did
2. **Lying** - Agent claims "done" but didn't actually do it

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  ANTI-LYING (Verification)                                  │
├─────────────────────────────────────────────────────────────┤
│  Agent: "I created file.ts"                                 │
│       ↓                                                     │
│  1. Extract claim (type: file_created)                      │
│       ↓                                                     │
│  2. Collect evidence (fs.existsSync, git status)            │
│       ↓                                                     │
│  3. Verify: claim vs evidence → verified/contradicted       │
│       ↓                                                     │
│  4. If contradicted → retry (max 2 times)                   │
│       ↓                                                     │
│  5. Warn user: [OK] or [FAIL]                               │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  ANTI-FORGETTING (Memory) - Uses Memory-Core                │
├─────────────────────────────────────────────────────────────┤
│  After verification:                                        │
│       ↓                                                     │
│  vectorStore.store(claimId, embedding)    ← Semantic store  │
│       ↓                                                     │
│  graphService.addEntity({file: "file.ts"}) ← Entity store   │
│       ↓                                                     │
│  timelineService.addEvent(claim, timestamp) ← Timeline      │
│                                                             │
│  When recalling:                                            │
│       ↓                                                     │
│  vectorStore.search("authentication")     ← Semantic search │
│       ↓                                                     │
│  graphService.findRelated("auth.ts")      ← Find related    │
│       ↓                                                     │
│  timelineService.query("yesterday")       ← Time query      │
└─────────────────────────────────────────────────────────────┘
```

## Summary

| Problem | Solution | Memory-Core API |
|---------|----------|-----------------|
| **Forgetting** | Store all claims + evidence in DB | `vector.store()`, `graph.addEntity()`, `timeline.addEvent()` |
| **Lying** | Verify claims against real evidence | `vector.search()` to find similar verified claims |

## How it works

### Verification Pipeline

```
Agent Response → Extract Claims → Collect Evidence → Verify → Warn User
```

1. **Extract**: Parse response for claims ("I created file.ts", "Tests passed")
2. **Collect**: Gather evidence (check file exists, read git status, get command output)
3. **Verify**: Compare claim vs evidence → `verified` or `contradicted`
4. **Retry**: If contradicted, retry up to 2 times
5. **Warn**: Return warnings to user: `[OK]` or `[FAIL]`

### Supported Claim Types

| Claim Type | Example | Evidence Source |
|------------|---------|-----------------|
| `file_created` | "I created src/app.ts" | file system check |
| `file_modified` | "I updated config" | file hash comparison |
| `file_deleted` | "I removed old.ts" | file existence check |
| `command_executed` | "I ran npm install" | command output |
| `test_passed` | "All tests pass" | test runner output |
| `test_failed` | "Test X fails" | test runner output |
| `code_added` | "I added function X" | code content search |
| `code_fixed` | "I fixed the bug" | file + command check |
| `task_completed` | "Task done" | action verification |

## Quick Start

### Requirements

- Node.js **22.5.0+** (uses built-in `node:sqlite`)

### Install

```bash
git clone https://github.com/tuantabit/claw-memory.git
cd claw-memory
pnpm install
pnpm build
```

### Programmatic Usage

```typescript
import { createDatabase, createClawMemoryEngine } from "claw-memory";

const db = createDatabase("./claw-memory.db");
const engine = createClawMemoryEngine(db, {
  autoVerify: true,
  retry: {
    enabled: true,
    maxRetries: 2,
    notifyUser: true,
  },
});

await engine.initialize();
engine.setSession("session-001");

// Process agent response
const result = await engine.processResponse("I created src/app.ts");

console.log(result.claims);        // Extracted claims
console.log(result.verifications); // Verification results
console.log(result.warnings);      // [OK] or [FAIL] warnings

await engine.close();
```

### Use as OpenClaw Extension

```json
{
  "extensions": ["./path/to/claw-memory/dist/index.js"]
}
```

## Memory-Core Integration

Memory-Core provides long-term memory storage. Claw-Memory uses it to remember and recall history.

### Vector Store (Semantic Search)

```typescript
// Store with embedding
const embedding = await embeddingService.embed("Created auth service");
await vectorStore.store(memoryId, sessionId, embedding, "local");

// Search semantically
const query = await embeddingService.embed("login authentication");
const results = await vectorStore.search(query, { limit: 5 });
// Returns: [{ memoryId, similarity: 0.85 }, ...]
```

Features:
- 128-dimensional hash-based embeddings (no external API)
- Cosine similarity search
- Session-scoped queries

### Knowledge Graph

```typescript
// Entity types: file, function, class, component, command, package, test, error
// Relationship types: CONTAINS, IMPORTS, DEPENDS_ON, CALLS, TESTS, FIXES

// Add entity
await graphService.addEntity({ type: "file", name: "src/auth.ts" });

// Find path between entities
const path = await graphService.findPath(fileId, testId);

// Get neighbors
const neighbors = await graphService.getNeighbors(entityId, { depth: 2 });
```

### Temporal Memory

```typescript
// Supported expressions:
// - "today", "yesterday"
// - "last week", "this month"
// - "3 days ago", "last 5 hours"

const events = await timelineService.queryByTimeExpression(sessionId, "last week");

// Get timeline segments
const segments = await timelineService.getTimelineSegments(sessionId, "day");
```

## Configuration

### Environment Variables

```bash
CLAW_MEMORY_ENABLE_LLM=true           # LLM-based extraction
CLAW_MEMORY_EXTRACTION_THRESHOLD=0.6  # Regex confidence threshold
CLAW_MEMORY_VERIFICATION_THRESHOLD=0.7
CLAW_MEMORY_AUTO_VERIFY=true
CLAW_MEMORY_RETRY_ENABLED=true        # Auto-retry on contradiction
CLAW_MEMORY_MAX_RETRIES=2             # Max retry attempts
```

### Programmatic Config

```typescript
createClawMemoryEngine(db, {
  enableLLM: true,
  extractionThreshold: 0.6,
  verificationThreshold: 0.7,
  autoVerify: true,
  maxClaimsPerSession: 1000,
  retry: {
    enabled: true,
    maxRetries: 2,
    notifyUser: true,
  },
  compaction: {
    retentionDays: 30,
    preserveContradicted: true,
    autoCompact: false,
  },
});
```

## Agent Tools

| Tool | Description |
|------|-------------|
| `claw-memory_verify` | Verify specific claim or search claims |
| `claw-memory_audit` | Get verification history and statistics |
| `claw-memory_expand` | Expand claim with evidence details |
| `claw-memory_compact` | Trigger database compaction |

## Database Schema

### Core Tables

```sql
-- Claims and verification
claims, evidence, verifications

-- Memory (from memory-core)
memory_vectors, entities, relationships, temporal_events

-- Context management
messages, summaries, memory_entries

-- Receipts (proof of actions)
actions, file_receipts, command_receipts
```

### Archive Tables

```sql
claims_archive, evidence_archive, daily_summaries, compaction_history
```

## Project Structure

```
src/
├── index.ts              # Entry point
├── engine.ts             # ClawMemoryEngine (main orchestrator)
├── plugin.ts             # OpenClaw plugin hooks
├── schema.ts             # Database schema
├── config.ts             # Configuration
├── types.ts              # Type definitions
│
├── core/
│   └── database.ts       # SQLite wrapper (node:sqlite)
│
├── memory/               # Vector search (re-exports from memory-core)
├── graph/                # Knowledge graph (re-exports from memory-core)
├── temporal/             # Temporal memory (re-exports from memory-core)
│
├── extractor/            # Claim extraction
│   ├── claim-extractor.ts
│   ├── llm-extractor.ts
│   └── patterns.ts
│
├── collector/            # Evidence collection
│   ├── evidence-collector.ts
│   └── sources/
│       ├── file-source.ts
│       ├── git-source.ts
│       ├── command-source.ts
│       └── receipt-source.ts
│
├── verifier/             # Claim verification
│   ├── claim-verifier.ts
│   └── strategies/
│
├── retry/                # Auto-retry system
│   ├── retry-manager.ts
│   └── retry-prompt.ts
│
├── store/                # Data persistence
│   ├── claim-store.ts
│   ├── evidence-store.ts
│   ├── verification-store.ts
│   └── ...
│
├── compactor/            # Database compaction
│
└── tools/                # Agent tools
    ├── claw-memory-verify.ts
    ├── claw-memory-audit.ts
    ├── claw-memory-expand.ts
    └── claw-memory-compact.ts
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
| `e` | Evidence |
| `s` | Search |
| `x` | Export |

## Development

```bash
pnpm install     # Install dependencies
pnpm build       # Build
pnpm typecheck   # Type check
pnpm dev         # Watch mode
```

## License

MIT
