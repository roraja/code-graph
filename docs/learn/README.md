# CodeGraph — Learning Guide

A practical guide to understanding, configuring, and using CodeGraph to explore large codebases.

---

## What Is CodeGraph?

CodeGraph parses a codebase into a graph database, then helps you understand it. You point it at source code, it extracts every function, class, call, branch, and variable into Neo4j. Then AI discovers realistic usage scenarios (e.g., "user copies text from a web page"), traces execution paths step by step, and explains each decision with imagined variable values.

When the AI gets something wrong, you correct it in plain English. CodeGraph interprets your correction and re-traces affected steps.

```
You:       "file_count is 0, so the else branch is taken"
CodeGraph: ✅ Set file_count = 0. Re-traced steps 8–22. 5 steps changed.
```

---

## How It Works (The Pipeline)

```
Source Code  →  Parser  →  Neo4j Graph  →  AI Agents  →  Scenarios + Traces
    ↑                                                         ↓
    └─────────── Human Corrections ←──────────────────────────┘
```

| Stage | What Happens |
|-------|-------------|
| **Parse** | CodeGraph reads your source files, extracting functions, classes, calls, branches, variables, and inheritance relationships |
| **Index** | Everything gets stored as nodes and edges in a Neo4j graph database |
| **Discover** | AI analyzes entry points and proposes realistic usage scenarios |
| **Trace** | AI follows each scenario step by step through the call graph, deciding branch outcomes and resolving virtual dispatch |
| **Walk** | You step through the trace interactively, seeing source code, variable values, and justifications |
| **Correct** | You override AI decisions; corrections cascade through downstream steps |

---

## Quick Start (5 Minutes)

### 1. Start Neo4j

```bash
docker run -d \
  --name codegraph-neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/codegraph123 \
  -e NEO4J_PLUGINS='["apoc"]' \
  -v codegraph-data:/data \
  neo4j:5
```

### 2. Set Environment Variables

```bash
export CODEGRAPH_NEO4J_PASSWORD=codegraph123

# Choose ONE of these AI providers:

# Option A: GitHub Copilot CLI (recommended if you have Copilot)
# No API key needed — uses your existing Copilot authentication

# Option B: OpenAI
export CODEGRAPH_AI_API_KEY=sk-...

# Option C: Mock mode (no AI calls, good for testing)
export CODEGRAPH_AI_MOCK=true
```

### 3. Initialize Your Project

```bash
cd /path/to/your/project

# For TypeScript projects
codegraph init --lang ts

# For C++ projects
codegraph init --lang cpp
```

This creates `.vscode/code-graph/codegraph.yaml`.

### 4. Check Everything Is Working

```bash
codegraph doctor
```

Expected output:
```
✔ Node.js v22.22.0
✔ codegraph.yaml found
✔ Neo4j reachable at bolt://localhost:7687
✔ AI provider: copilot (CLI found)
✔ All checks passed!
```

### 5. Index Your Code

```bash
# Index everything in src/
codegraph index ./src

# Or index a specific subsystem
codegraph index ./src/auth
```

### 6. Explore

```bash
codegraph explore
```

---

## Configuration

All configuration lives in **`.vscode/code-graph/codegraph.yaml`** inside the project being analyzed.

### Full Configuration Reference

```yaml
# ─── Project ───────────────────────────────────────────────
project:
  name: my-project                # Display name
  languages:
    - ts                          # "ts" or "cpp"
  rootDirs:
    - src                         # Directories to parse
    - lib
  excludeDirs:
    - node_modules                # Skip these directories
    - dist
    - .git
    - "*test*"                    # Glob patterns work too

# ─── Neo4j ─────────────────────────────────────────────────
neo4j:
  uri: bolt://localhost:7687
  username: neo4j
  password: ${CODEGRAPH_NEO4J_PASSWORD}   # Environment variable
  database: neo4j

# ─── AI Provider ───────────────────────────────────────────
ai:
  provider: copilot               # "copilot", "openai", or "mock"
  model: gpt-4-turbo
  apiKey: ${CODEGRAPH_AI_API_KEY} # Only needed for "openai"
  temperature: 0.2                # Lower = more deterministic

# ─── Tracing ───────────────────────────────────────────────
tracing:
  maxDepth: 50                    # How deep to trace call stacks
  maxStepsPerFunction: 200
  boringFunctions:                # Skip these in traces
    - "LOG*"
    - "DCHECK*"
    - "console.log"
  boringNamespaces:
    - "base::internal"
    - "testing"
  focusFunctions:                 # Always trace these, even if deep
    - "Clipboard::readText"

# ─── Parser ────────────────────────────────────────────────
parser:
  # For TypeScript:
  typescript:
    tsconfig: tsconfig.json

  # For C++:
  cpp:
    compileCommands: compile_commands.json
    clangdPath: ${workspaceFolder}/third_party/llvm-build/Release+Asserts/bin/clangd

# ─── Server ────────────────────────────────────────────────
server:
  port: 3000
  host: 127.0.0.1
```

### Variable Substitution

The config supports two kinds of variables:

| Syntax | Resolves To | Example |
|--------|-------------|---------|
| `${ENV_VAR}` | Environment variable value | `${CODEGRAPH_NEO4J_PASSWORD}` → `codegraph123` |
| `${workspaceFolder}` | Project root directory (where config is found) | `${workspaceFolder}/out` → `/home/user/project/out` |

### Where Config Files Live

```
your-project/
  .vscode/
    code-graph/
      codegraph.yaml          ← CodeGraph configuration
      scenarios/               ← Exported/saved scenarios
```

CodeGraph also checks for a legacy `.codegraph.yaml` in the project root.

---

## Authentication & Passwords

### Neo4j

Set the password as an environment variable and reference it in the config:

```bash
# In your shell / .bashrc / .zshrc
export CODEGRAPH_NEO4J_PASSWORD=your-password
```

```yaml
# In codegraph.yaml
neo4j:
  password: ${CODEGRAPH_NEO4J_PASSWORD}
```

> **Never** put passwords directly in the YAML file. Always use `${ENV_VAR}` substitution.

### AI Providers

#### Copilot CLI (Recommended)

No API key needed. Uses your existing GitHub Copilot authentication.

```yaml
ai:
  provider: copilot
```

Requires the `copilot` CLI to be installed and authenticated. CodeGraph invokes it in single-shot mode (`copilot -p "..." --yolo --autopilot`).

#### OpenAI

```bash
export CODEGRAPH_AI_API_KEY=sk-...
```

```yaml
ai:
  provider: openai
  apiKey: ${CODEGRAPH_AI_API_KEY}
```

#### Mock (No AI)

For testing and demo purposes. Returns canned responses — no network calls.

```yaml
ai:
  provider: mock
```

Or set the environment variable:
```bash
export CODEGRAPH_AI_MOCK=true
```

---

## Ways to Explore Code

CodeGraph provides multiple ways to explore a codebase, from quick searches to deep interactive walkthroughs.

---

### 1. Interactive Explorer (`codegraph explore`)

A menu-driven interface for quick exploration:

```bash
codegraph explore
```

```
  🔍 Search functions
  📋 Browse scenarios
  🌳 View call graph
  🔄 Discover new scenarios (AI)
  📊 View graph statistics
  🏥 System health check
  ❌ Exit
```

Select an option to search functions, browse discovered scenarios, view call graphs, or run AI discovery. Works without any arguments.

Use `--mock` for a demo without a database connection.

---

### 2. Search Functions (`codegraph functions`)

Find functions by name, file, or class:

```bash
# Search by name
codegraph functions --search readText

# Filter by file path
codegraph functions --file clipboard_promise.cc

# Filter by class
codegraph functions --class ClipboardHostImpl

# Output as JSON (for piping / scripting)
codegraph functions --search readText --format json
```

Output:
```
┌──────────────────────────┬────────────────────────┬──────┬────────┬─────────┐
│ Name                     │ File                   │ Line │ Params │ Return  │
├──────────────────────────┼────────────────────────┼──────┼────────┼─────────┤
│ Clipboard::readText      │ clipboard.cc           │ 46   │ 2      │ Promise │
│ ClipboardHostImpl::Read… │ clipboard_host_impl.cc │ 231  │ 2      │ void    │
└──────────────────────────┴────────────────────────┴──────┴────────┴─────────┘
```

---

### 3. Query Call Graphs (`codegraph query`)

Trace relationships between functions:

```bash
# Who calls this function?
codegraph query callers "ClipboardHostImpl::ReadText"

# What does this function call?
codegraph query callees "Clipboard::readText"

# Find the call path between two functions
codegraph query path "Clipboard::readText" "ClipboardHostImpl::ReadText" --max-depth 20
```

---

### 4. AI Scenario Discovery (`codegraph discover`)

Let AI find realistic usage scenarios:

```bash
# Basic discovery
codegraph discover

# With a hint to guide the AI
codegraph discover --hint "async clipboard read text"

# Discover more scenarios
codegraph discover --count 10
```

AI analyzes entry points, event handlers, and public APIs to find scenarios like:
- "User copies text from a web page"
- "User pastes an image into an editor"
- "Extension reads clipboard in background"

---

### 5. Trace a Scenario (`codegraph trace`)

AI walks through the call graph for a specific scenario, deciding branch outcomes and resolving dispatch:

```bash
codegraph trace "async-clipboard-readtext-real-graph"
```

Output:
```
⠋ Tracing scenario...
  ✓ Step 1: Clipboard::readText — entry point
  ✓ Step 2: ClipboardPromise::CreateForReadText — create promise
  ✓ Step 3: ClipboardPromise::HandleReadText — permission check
  ...
✓ Trace complete
  Steps: 13    Functions: 8    Branches: 6    Duration: 2.1s
```

---

### 6. Interactive Walkthrough (`codegraph walk`)

Step through a traced scenario line by line with source code, variables, and justifications:

```bash
codegraph walk "async-clipboard-readtext-real-graph"
```

```
╔══════════════════════════════════════════════════════════════╗
║  Step 6 / 13                                                ║
║  📍 ClipboardPromise::HandleReadTextWithPermission           ║
║  📁 clipboard_promise.cc:496                                 ║
║                                                              ║
║  if (status != mojom::blink::PermissionStatus::GRANTED) {   ║
║    script_promise_resolver_->RejectWithDOMException(         ║
║        DOMExceptionCode::kNotAllowedError, ...);             ║  ← SKIPPED
║    return;                                                   ║
║  }                                                           ║
║                                                              ║
║  ┌─ Variable State ─────────────────────────────────────┐   ║
║  │ status = GRANTED                                      │   ║
║  └───────────────────────────────────────────────────────┘   ║
║                                                              ║
║  ┌─ Justification ──────────────────────────────────────┐   ║
║  │ Permission GRANTED. User previously allowed clipboard │   ║
║  │ access for this origin.                               │   ║
║  └───────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════╝

codegraph> _
```

**REPL commands:**

| Command | Action |
|---------|--------|
| `n` / `next` | Next step |
| `p` / `prev` | Previous step |
| `j 8` | Jump to step 8 |
| `vars` | Show all variable values |
| `why` | Show full AI justification |
| `correct` | Override the AI's decision |
| `q` / `quit` | Exit |

---

### 7. Submit Corrections (`codegraph correct`)

Override AI decisions when the trace is wrong:

```bash
# Via CLI
codegraph correct "scenario-id" --step 6 \
  --message "Permission is DENIED in this scenario"

# Via the walkthrough REPL
codegraph walk "scenario-id"
codegraph> j 6
codegraph> correct
Enter correction: Permission is DENIED in this scenario
```

Correction types the AI can interpret:

| Type | Example Message |
|------|----------------|
| Variable constraint | "file_count is always 0 for empty directories" |
| Branch override | "The else branch is taken here" |
| Dispatch override | "Use ClipboardOzone, not ClipboardWin" |
| Function skip | "Ignore the logging handler" |
| Function include | "Trace into resizeImage, it's important" |
| Global rule | "SizeValidator always passes in test mode" |

---

### 8. Export Scenarios (`codegraph export`)

Export traces for documentation, sharing, or further processing:

```bash
# JSON (machine-readable, re-importable)
codegraph export "scenario-id" --format json

# Markdown (human-readable report)
codegraph export "scenario-id" --format markdown > report.md

# Mermaid flowchart (for diagrams)
codegraph export "scenario-id" --format mermaid > flow.mmd

# Cypher queries (for Neo4j import)
codegraph export "scenario-id" --format cypher > import.cypher
```

---

### 9. Import Scenarios (`codegraph import`)

Import previously exported or hand-crafted scenarios:

```bash
codegraph import scenarios/async-clipboard-readtext.json
```

The JSON file must have this structure:
```json
{
  "scenario": {
    "name": "...",
    "description": "...",
    "entryFunction": "...",
    "triggerCondition": "..."
  },
  "steps": [ ... ]
}
```

---

### 10. View Scenario Details (`codegraph view`)

View a scenario summary with all steps in a table:

```bash
# Overview with all steps
codegraph view "scenario-id"

# Detailed view of one step (source code, vars, justification)
codegraph view "scenario-id" --step 8

# Machine-readable
codegraph view "scenario-id" --format json
```

---

### 11. Graph Statistics (`codegraph stats`)

Quick overview of what's in the database:

```bash
codegraph stats
```

```
┌──────────────────────────┬─────────┐
│ Node Type                │  Count  │
├──────────────────────────┼─────────┤
│ File                     │      91 │
│ Function                 │   1,062 │
│ Class                    │      53 │
│ Branch                   │     750 │
│ Variable                 │   1,733 │
│ Scenario                 │       1 │
├──────────────────────────┼─────────┤
│ Total Relationships      │   8,599 │
└──────────────────────────┴─────────┘
```

---

### 12. Web UI (`codegraph serve`)

Launch the API server and web interface:

```bash
codegraph serve --port 3000
```

Open [http://localhost:3000](http://localhost:3000) for:
- Scenario list and detail views
- Interactive call graph visualization (Cytoscape.js)
- Step-by-step walkthrough with source code
- Correction chat interface

The server also exposes:
- **GraphQL** at `/graphql`
- **REST API** at `/api/*`

---

### 13. Direct Neo4j Queries

For advanced exploration, query the graph directly at [http://localhost:7474](http://localhost:7474):

```cypher
-- Find all functions in a file
MATCH (f:Function)
WHERE f.filePath CONTAINS 'clipboard_promise'
RETURN f.qualifiedName, f.startLine

-- Trace the call chain from an entry point
MATCH path = (entry:Function {qualifiedName: 'Clipboard::readText'})
  -[:CALLS*1..5]->(callee:Function)
RETURN [n IN nodes(path) | n.qualifiedName] AS chain

-- Find functions with the most callers
MATCH (f:Function)<-[:CALLS]-(caller:Function)
RETURN f.qualifiedName, COUNT(caller) AS callers
ORDER BY callers DESC LIMIT 10

-- Get branches in a function
MATCH (f:Function)-[:HAS_BRANCH]->(b:Branch)
WHERE f.qualifiedName = 'ClipboardHostImpl::ReadText'
RETURN b.type, b.condition, b.line
```

---

## Setting Up for a C++ Project (Chromium Example)

```bash
# 1. Generate compile_commands.json
cd chromium/src
gn gen out/Default --export-compile-commands

# 2. Initialize CodeGraph
codegraph init --lang cpp --name chromium

# 3. Edit .vscode/code-graph/codegraph.yaml
#    - Set rootDirs to the subsystem you want to explore
#    - Set parser.cpp.compileCommands to compile_commands.json
#    - Set parser.cpp.clangdPath to your clangd binary
#    - Configure boringFunctions to skip LOG*, DCHECK*, etc.

# 4. Check setup
codegraph doctor

# 5. Index a subsystem (don't index all of Chromium at once!)
codegraph index third_party/blink/renderer/modules/clipboard

# 6. Explore
codegraph explore
```

---

## Setting Up for a TypeScript Project

```bash
cd my-ts-project

# 1. Initialize
codegraph init --lang ts

# 2. Index
codegraph index ./src

# 3. Discover scenarios
codegraph discover --hint "API request handling"

# 4. Trace and walk
codegraph trace "handle-api-request"
codegraph walk "handle-api-request"
```

---

## Command Reference

| Command | Purpose |
|---------|---------|
| `codegraph init` | Create config in `.vscode/code-graph/` |
| `codegraph doctor` | Check Neo4j, AI, clangd, etc. |
| `codegraph index <dir>` | Parse and store code in Neo4j |
| `codegraph stats` | Show graph node/edge counts |
| `codegraph functions` | Search/browse functions |
| `codegraph query callers <fn>` | Who calls this function? |
| `codegraph query callees <fn>` | What does this function call? |
| `codegraph query path <a> <b>` | Find call path between functions |
| `codegraph discover` | AI discovers usage scenarios |
| `codegraph scenarios` | List all scenarios |
| `codegraph trace <id>` | AI traces a scenario step by step |
| `codegraph walk <id>` | Interactive step-through REPL |
| `codegraph view <id>` | View scenario + steps |
| `codegraph correct <id>` | Override an AI decision |
| `codegraph export <id>` | Export as JSON/Markdown/Mermaid/Cypher |
| `codegraph import <file>` | Import scenario from JSON |
| `codegraph explore` | Interactive menu-driven explorer |
| `codegraph serve` | Start web UI + API server |

All commands accept:
- `-c, --config <path>` — Path to config or project root
- `-v, --verbose` — Enable verbose output
- `-h, --help` — Show help

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `codegraph.yaml not found` | Run `codegraph init` in your project root |
| Neo4j connection refused | `docker ps \| grep neo4j` — is it running? |
| `clangd not found` | Set `parser.cpp.clangdPath` in config to the full path |
| AI returns empty/bad results | Try `ai.provider: mock` to test without AI; check API key |
| 0 functions indexed (C++) | Ensure `rootDirs` points to actual `.cc`/`.h` files, not a parent directory |
| Slow indexing | Narrow `rootDirs` scope; add patterns to `excludeDirs` |
| `${ENV_VAR}` resolves to empty | Export the variable in your shell: `export VAR=value` |
