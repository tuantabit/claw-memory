# 🧠 Claw-Memory

> **Verified memory for AI agents** - Detect lies, prevent forgetting

[![Version](https://img.shields.io/badge/version-0.4.0-blue.svg)](https://github.com/tuantabit/claw-memory)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-plugin-orange.svg)](https://openclaw.dev)

Claw-Memory solves two critical problems with AI agents:

| Problem | What happens | Solution |
|---------|--------------|----------|
| **🤥 Lying** | Agent claims "done" but didn't actually do it | Verify claims against real evidence |
| **😵 Forgetting** | Agent loses context across conversations | Persistent memory with semantic search |

## ⚡ Quick Install

**One command to install:**

```bash
curl -fsSL https://raw.githubusercontent.com/tuantabit/claw-memory/main/install.sh | bash
```

**One command to uninstall:**

```bash
curl -fsSL https://raw.githubusercontent.com/tuantabit/claw-memory/main/uninstall.sh | bash
```

### Manual Installation

```bash
# Clone and build
git clone https://github.com/tuantabit/claw-memory.git
cd claw-memory
npm install
npm run build

# Install to OpenClaw
npm run install-plugin
```

### Requirements

- **OpenClaw** (any version)
- **Node.js** 22.5.0+ (uses built-in `node:sqlite`)
- **npm** or **yarn**

## 🔧 Configuration

After installation, the plugin is automatically configured in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["claw-memory"],
    "load": {
      "paths": ["~/.openclaw/plugins/claw-memory/claw-memory.js"]
    },
    "entries": {
      "claw-memory": {
        "enabled": true,
        "config": {
          "autoVerify": true
        }
      }
    }
  }
}
```

### Plugin Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable plugin |
| `autoVerify` | boolean | `true` | Auto-verify after each response |
| `enableLLM` | boolean | `false` | Use LLM for claim extraction |
| `trustWarningThreshold` | number | `70` | Trust score warning threshold (0-100) |
| `trustBlockThreshold` | number | `30` | Trust score block threshold (0-100) |
| `retry.enabled` | boolean | `true` | Auto-retry contradicted claims |
| `retry.maxRetries` | number | `2` | Max retry attempts |

## 🏗️ Architecture

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
│  5. Warn user: ✅ VERIFIED or ❌ CONTRADICTED                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  ANTI-FORGETTING (Memory)                                   │
├─────────────────────────────────────────────────────────────┤
│  Storage:                                                   │
│    • vectorStore.store()     → Semantic embeddings          │
│    • graphService.addEntity() → Knowledge graph             │
│    • timelineService.add()    → Temporal timeline           │
│                                                             │
│  Recall:                                                    │
│    • vectorStore.search()     → "Find auth-related claims"  │
│    • graphService.findPath()  → "How are A and B related?"  │
│    • timelineService.query()  → "What did I do yesterday?"  │
└─────────────────────────────────────────────────────────────┘
```

## 📋 Supported Claim Types

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

## 🛠️ Agent Tools

The plugin provides tools that the AI agent can use:

| Tool | Description |
|------|-------------|
| `claw-memory_verify` | Verify a specific claim or search claims |
| `claw-memory_audit` | Get verification history and statistics |
| `claw-memory_expand` | Expand claim with evidence details |
| `claw-memory_compact` | Trigger database compaction |

## 💾 Memory Features

### Vector Store (Semantic Search)

```typescript
// Store with embedding
const embedding = await embeddingService.embed("Created auth service");
await vectorStore.store(memoryId, sessionId, embedding, "local");

// Search semantically
const results = await vectorStore.search(queryEmbedding, { limit: 5 });
// Returns: [{ memoryId, similarity: 0.85 }, ...]
```

### Knowledge Graph

```typescript
// Entity types: file, function, class, component, command, package, test, error
// Relationships: CONTAINS, IMPORTS, DEPENDS_ON, CALLS, TESTS, FIXES

await graphService.addEntity({ type: "file", name: "src/auth.ts" });
const path = await graphService.findPath(fileId, testId);
```

### Temporal Memory

```typescript
// Supported: "today", "yesterday", "last week", "3 days ago"
const events = await timelineService.queryByTimeExpression(sessionId, "last week");
```

## ⚙️ Environment Variables

```bash
CLAW_MEMORY_ENABLED=true              # Enable/disable plugin
CLAW_MEMORY_AUTO_VERIFY=true          # Auto-verify claims
CLAW_MEMORY_ENABLE_LLM=false          # Use LLM extraction
CLAW_MEMORY_RETRY_ENABLED=true        # Auto-retry on contradiction
CLAW_MEMORY_MAX_RETRIES=2             # Max retry attempts
```

## 📁 Database

Data is stored in SQLite at `~/.openclaw/claw-memory.db`:

```sql
-- Claims and verification
claims, evidence, verifications

-- Memory storage
memory_vectors, entities, relationships, temporal_events

-- Context management
messages, summaries, memory_entries
```

## 🖥️ Terminal UI

Optional Go-based TUI for database inspection:

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

## 🔄 Uninstall

**Quick uninstall:**

```bash
curl -fsSL https://raw.githubusercontent.com/tuantabit/claw-memory/main/uninstall.sh | bash
```

**Options:**

```bash
# Keep database (preserve memory data)
curl -fsSL .../uninstall.sh | bash -s -- --keep-data

# Skip confirmation
curl -fsSL .../uninstall.sh | bash -s -- --force
```

**Manual uninstall:**

1. Remove plugin directory: `rm -rf ~/.openclaw/plugins/claw-memory`
2. Remove from config: Edit `~/.openclaw/openclaw.json` and remove claw-memory entries
3. (Optional) Remove database: `rm ~/.openclaw/claw-memory.db`

## 🧑‍💻 Development

```bash
npm install      # Install dependencies
npm run build    # Build plugin
npm run dev      # Watch mode
npm run typecheck # Type check

# Local install (for testing)
./install.sh --local
```

