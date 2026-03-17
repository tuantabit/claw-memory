# veridic-tui

Terminal UI for inspecting Veridic-Claw database.

## Features

- **Session Browser**: View all verification sessions with trust scores
- **Claims List**: Browse claims with type, confidence, and status
- **Evidence Viewer**: Inspect collected evidence for each claim
- **Verification DAG**: View verification history as a directed acyclic graph
- **Trust Score Dashboard**: Monitor trust score trends over time
- **Search**: Full-text search across all claims
- **Export**: Export audit reports to JSON, Markdown, or CSV

## Installation

### From Source

```bash
cd tui
make build
./veridic-tui
```

### From Release

Download the binary for your platform from the [releases page](https://github.com/tuantabit/veridic-claw/releases).

## Usage

```bash
# Use default database (~/.openclaw/veridic-claw.db)
veridic-tui

# Use specific database
veridic-tui -db /path/to/veridic-claw.db

# Show version
veridic-tui -version

# Enable verbose output
veridic-tui -verbose
```

## Keyboard Shortcuts

### Global
| Key | Action |
|-----|--------|
| `q` | Quit |
| `Ctrl+C` | Quit |
| `Esc` | Go back |

### Navigation
| Key | Action |
|-----|--------|
| `↑` / `k` | Move up |
| `↓` / `j` | Move down |
| `Enter` | Select / Expand |

### Sessions View
| Key | Action |
|-----|--------|
| `Enter` | View claims for session |
| `t` | View trust scores |

### Claims View
| Key | Action |
|-----|--------|
| `Enter` | View claim detail |
| `e` | View evidence |
| `v` | View verifications |

### Search
| Key | Action |
|-----|--------|
| `s` | Open search |
| `/` | Open search |

### Export
| Key | Action |
|-----|--------|
| `x` | Export current view |

## Views

### Sessions
```
veridic-tui
Sessions
────────────────────────────────────────────────
▶ session_abc123  [85%]  12/15 verified  2024-03-17 14:30
  session_def456  [42%]  3/10 verified   2024-03-17 10:15
  session_ghi789  [100%] 5/5 verified    2024-03-16 09:00

↑/↓: navigate • enter: view claims • t: trust scores • q: quit
```

### Claims
```
Claims
Session: session_abc123
────────────────────────────────────────────────
▶ 📄 file_created   [90%] Created src/index.ts with main function
  ⚡ command_exec   [85%] Ran npm install successfully
  ✅ test_passed    [95%] All tests are passing
  🔧 code_fixed     [75%] Fixed the authentication bug

↑/↓: navigate • enter: detail • e: evidence • v: verifications
```

### Verification DAG
```
Verification History (DAG)
────────────────────────────────────────────────
● verified [95%] 2024-03-17 14:30:00
   └ 3 evidence items
  ├─ unverified [60%] 2024-03-17 14:25:00
     └ 1 evidence items
  ├─ contradicted [30%] 2024-03-17 14:20:00
     └ 2 evidence items
```

### Trust Scores
```
Trust Score History
────────────────────────────────────────────────
Current Score: 85.0%
2024-03-17 14:30:00

Categories
  file_operations     92.0%
  command_execution   78.0%
  test_results        95.0%

History
  03-17 14:30 ████████████████████████░░░░░░ 85%
  03-17 14:00 ██████████████████████░░░░░░░░ 75%
  03-17 13:30 ████████████████████░░░░░░░░░░ 68%
```

## Development

```bash
# Install dependencies
make deps

# Build
make build

# Run tests
make test

# Format code
make fmt

# Build for all platforms
make build-all
```

## Requirements

- Go 1.22+
- SQLite database from veridic-claw

## License

MIT
