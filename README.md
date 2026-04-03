<p align="center">
  <strong>CodeGraph</strong><br>
  AI-assisted code understanding through graph-based call-path analysis
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#features">Features</a> •
  <a href="#cli-reference">CLI Reference</a> •
  <a href="#api-reference">API Reference</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## What is CodeGraph?

CodeGraph parses a codebase into a **Neo4j graph database** — functions, calls, branches, virtual dispatch, data flow — then uses **AI agents** to discover realistic usage scenarios, trace full execution paths, and provide step-by-step walkthroughs with imagined variable values and branch justifications.

When the AI gets something wrong, you tell it in plain English. CodeGraph interprets your correction, updates the graph, and re-traces affected steps downstream.

```
You: "file_count is 0 for directories, so the else branch is taken here"

CodeGraph: ✅ Got it.
  - Changed branch decision to FALSE (else branch)
  - Set file_count = 0
  - Re-tracing steps 13–47 with this correction...
  - ⟳ Re-trace complete: 8 steps changed downstream.
```

### Who is this for?

- **Engineers onboarding** onto large, unfamiliar codebases
- **Bug investigators** tracing execution paths through complex control flow
- **Architecture reviewers** trying to understand cross-module interactions

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CodeGraph System                            │
│                                                                     │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────┐                │
│  │  CLI /   │   │   Web UI     │   │  VS Code     │                │
│  │  REPL    │   │  (React)     │   │  Extension   │                │
│  └────┬─────┘   └──────┬───────┘   └──────┬───────┘                │
│       │                │                   │                        │
│       └────────────────┼───────────────────┘                        │
│                        │                                            │
│                 ┌──────▼───────┐                                    │
│                 │  GraphQL /   │                                    │
│                 │  REST API    │                                    │
│                 │  Server      │                                    │
│                 └──────┬───────┘                                    │
│                        │                                            │
│       ┌────────────────┼────────────────┐                           │
│       │                │                │                           │
│  ┌────▼─────┐   ┌──────▼──────┐   ┌────▼──────┐                   │
│  │ Scenario │   │  Correction │   │  Query    │                   │
│  │ Engine   │   │  Engine     │   │  Engine   │                   │
│  └────┬─────┘   └──────┬──────┘   └────┬──────┘                   │
│       │                │                │                           │
│       └────────────────┼────────────────┘                           │
│                        │                                            │
│                 ┌──────▼───────┐                                    │
│                 │   Core       │                                    │
│                 │   Engine     │                                    │
│                 └──────┬───────┘                                    │
│                        │                                            │
│       ┌────────────────┼────────────────┐                           │
│       │                │                │                           │
│  ┌────▼─────┐   ┌──────▼──────┐   ┌────▼──────┐                   │
│  │ Parser   │   │   AI Agent  │   │  Neo4j    │                   │
│  │ Layer    │   │   Layer     │   │  Driver   │                   │
│  └────┬─────┘   └─────────────┘   └────┬──────┘                   │
│       │                                 │                           │
│  ┌────▼─────┐                    ┌──────▼──────┐                   │
│  │ ts-morph │                    │   Neo4j     │                   │
│  │ clangd   │                    │   Database  │                   │
│  └──────────┘                    └─────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Features

| Feature | Description |
|---|---|
| **Code Parsing** | Parses TypeScript (ts-morph) and C/C++ (clangd) into a Neo4j graph — functions, classes, calls, branches, variables, inheritance |
| **AI Scenario Discovery** | AI discovers realistic usage scenarios from entry points and event handlers |
| **Execution Path Tracing** | Traces step-by-step execution paths with branch decisions and virtual dispatch resolution |
| **Variable Imagination** | AI imagines concrete variable values for each scenario context |
| **Justifications** | Every branch decision and dispatch has a human-readable AI explanation |
| **Human Corrections** | Override AI decisions in natural language — corrections cascade to downstream steps |
| **Interactive Walkthrough** | Step through execution paths line-by-line in the terminal (REPL) or web UI |
| **Graph Queries** | Query callers, callees, call chains, class hierarchies via Cypher |
| **Web UI** | React + Cytoscape.js interactive graph visualization with walkthrough and correction chat |
| **GraphQL + REST API** | Full API server with Apollo Server (GraphQL) and Express (REST) |
| **Incremental Indexing** | Re-index only changed files based on content hashing |
| **Mock Mode** | Run tests without an AI API key using `CODEGRAPH_AI_MOCK=true` |

---

## Quick Start

### Prerequisites

| Dependency | Version | Purpose |
|---|---|---|
| **Node.js** | 20+ | Runtime |
| **Neo4j** | 5.x | Graph database |
| **clangd** | 15+ | C/C++ language server (only for C++ projects) |

### 1. Install Neo4j via Docker

```bash
docker run -d \
  --name codegraph-neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/codegraph123 \
  -e NEO4J_PLUGINS='["apoc"]' \
  -v codegraph-data:/data \
  neo4j:5
```

Verify Neo4j is running at [http://localhost:7474](http://localhost:7474).

### 2. Clone and install

```bash
git clone https://github.com/AroojRaja/code-graph.git
cd code-graph
npm install
npm run build
```

### 3. Initialize a project

```bash
# Initialize with the included sample project
codegraph init --lang ts --neo4j bolt://localhost:7687

# Or point at your own project
cd /path/to/your/project
codegraph init --lang ts --neo4j bolt://localhost:7687
```

This creates a `.codegraph.yaml` configuration file.

### 4. Index code

```bash
codegraph index ./src
```

CodeGraph parses all source files, extracts functions, classes, calls, branches, and variables, and writes them to Neo4j.

### 5. Discover scenarios

```bash
codegraph discover --hint "file processing"
```

The AI analyzes entry points and event handlers to find realistic usage scenarios.

### 6. Trace and walkthrough

```bash
# Trace a scenario — AI follows the execution path, making branch/dispatch decisions
codegraph trace "handle-file-drop"

# Interactive step-by-step walkthrough
codegraph walk "handle-file-drop"
```

### 7. Start web UI

```bash
codegraph serve --port 3000
# Open http://localhost:3000
```

---

## Sample Workflow

The repository includes a sample TypeScript project at `test/fixtures/sample-project/` — a file processing pipeline with validators, processors, event handlers, and branching logic. It's ideal for trying CodeGraph end-to-end.

```bash
# 1. Set environment
export CODEGRAPH_NEO4J_PASSWORD=codegraph123
export CODEGRAPH_AI_API_KEY=sk-...    # or use CODEGRAPH_AI_MOCK=true

# 2. Initialize for the sample project
cd test/fixtures/sample-project
codegraph init --lang ts --neo4j bolt://localhost:7687

# 3. Index
codegraph index ./src

# Expected output:
#   Files indexed: 6
#   Functions: 18
#   Classes: 7
#   Call edges: 24
#   Branches: 5

# 4. Discover scenarios
codegraph discover --hint "user drops files"

# Expected output:
#   Found 3 scenarios:
#   1. [handle-file-drop] User drops image and document files
#   2. [handle-invalid-file] User drops an oversized or unsupported file
#   3. [handle-empty-drop] User triggers a drop event with no files

# 5. Trace
codegraph trace "handle-file-drop"

# 6. Walk through interactively
codegraph walk "handle-file-drop"
#   n/next     → next step
#   p/prev     → previous step
#   vars       → show variable state
#   why        → show AI justification
#   correct    → submit a correction
#   q/quit     → exit

# 7. Check stats
codegraph stats
```

---

## Real-World Example: Chromium Clipboard readText

The repository includes a pre-built scenario tracing `navigator.clipboard.readText()` through the Chromium codebase — from JavaScript API to OS clipboard access. This demonstrates CodeGraph on a real, large-scale C++ codebase.

```bash
# Import the pre-built Chromium clipboard scenario
codegraph import scenarios/async-clipboard-read-text.json

# View the 15-step execution trace
codegraph view async-clipboard-read-text

# Walk through it interactively
codegraph walk async-clipboard-read-text

# Export as Mermaid flowchart for docs
codegraph export async-clipboard-read-text --format mermaid
```

The scenario traces through:
1. **Blink Renderer** — `Clipboard::readText()` → `ClipboardPromise::CreateForReadText()`
2. **Permission Check** — `ValidatePreconditions(CLIPBOARD_READ)`
3. **System Clipboard Bridge** — `SystemClipboard::ReadPlainText()`
4. **Mojo IPC** — Synchronous cross-process call from renderer to browser
5. **Browser Process** — `ClipboardHostImpl::ReadText()` → paste policy check
6. **Platform Dispatch** — Virtual dispatch to `ClipboardOzone`/`ClipboardWin`/`ClipboardMac`
7. **Promise Resolution** — Text returned through IPC → JS Promise resolves

Each step includes AI justification for branch decisions (e.g., "Permission is GRANTED because...") and imagined variable values. You can correct any step:

```bash
codegraph correct async-clipboard-read-text --step 5 \
  --message "On macOS, the platform permission check IS enabled by default"
```

---

```
codegraph <command> [options]
```

**Global options:**

| Option | Description |
|---|---|
| `-c, --config <path>` | Path to `.codegraph.yaml` or project root |
| `-v, --verbose` | Enable verbose output |
| `--version` | Show version |
| `--help` | Show help |

### Commands

#### `codegraph init`

Initialize a new CodeGraph project. Creates `.codegraph.yaml` in the current directory.

```bash
codegraph init --lang ts --neo4j bolt://localhost:7687
codegraph init --lang cpp --compile-commands out/Default/compile_commands.json
```

#### `codegraph index <dir>`

Parse and index a codebase directory into Neo4j.

```bash
codegraph index ./src
codegraph index ./src --incremental        # only re-parse changed files
codegraph index ./src/content/browser      # index a subdirectory
```

#### `codegraph discover`

Use AI to discover realistic usage scenarios from the indexed codebase.

```bash
codegraph discover
codegraph discover --hint "drag and drop"
codegraph discover --hint "authentication flow" --count 5
codegraph discover --entry-point "WebContentsViewAura::OnDragEntered"
```

#### `codegraph scenarios`

List discovered scenarios.

```bash
codegraph scenarios
codegraph scenarios --status validated
codegraph scenarios --status draft
```

#### `codegraph trace <id>`

Trace a scenario through the codebase — the AI follows the execution path, making branch and dispatch decisions.

```bash
codegraph trace "handle-file-drop"
codegraph trace "handle-file-drop" --max-depth 30
```

#### `codegraph walk <id>`

Start an interactive REPL walkthrough of a traced scenario.

```bash
codegraph walk "handle-file-drop"
```

**REPL commands:**

| Command | Description |
|---|---|
| `n` / `next` | Go to next step |
| `p` / `prev` | Go to previous step |
| `j <N>` | Jump to step N |
| `vars` | Show current variable state |
| `why` | Show AI justification for current step |
| `correct` | Enter correction mode |
| `graph` | Show call graph at current point |
| `q` / `quit` | Exit walkthrough |

#### `codegraph correct <id>`

Submit a human correction to a scenario.

```bash
codegraph correct "handle-file-drop" --step 12 \
  --message "file_count is 0 for directories"
```

#### `codegraph query`

Query the code graph.

```bash
codegraph query callers "FileProcessingPipeline.handleFileDrop"
codegraph query callees "FileProcessingPipeline.handleFileDrop"
codegraph query path --from "handleUserFileDrop" --to "resizeImage"
```

#### `codegraph serve`

Start the API server (GraphQL + REST) and optionally serve the web UI.

```bash
codegraph serve
codegraph serve --port 4000
```

#### `codegraph doctor`

Check system health — verifies Neo4j connection, clangd availability, configuration, etc.

```bash
codegraph doctor
```

#### `codegraph stats`

Show aggregate graph statistics.

```bash
codegraph stats
codegraph stats --format json
```

#### `codegraph explore`

**Interactive explorer** — menu-driven access to all features. Launches automatically when no command is given. Use `--mock` for demo mode without Neo4j.

```bash
codegraph explore
codegraph explore --mock     # demo mode, no Neo4j needed
codegraph                    # same as 'explore'
```

#### `codegraph view <id>`

Rich scenario viewer with multiple output formats. AI-friendly JSON output.

```bash
codegraph view async-clipboard-read-text              # table view
codegraph view async-clipboard-read-text --step 8     # single step detail
codegraph view async-clipboard-read-text --format json # JSON for AI
```

#### `codegraph functions`

Browse and search indexed functions.

```bash
codegraph functions --search "readText"
codegraph functions --file src/pipeline.ts
codegraph functions --class FileProcessingPipeline --format json
```

#### `codegraph export <id>`

Export a scenario to JSON, Markdown, Mermaid flowchart, or Cypher.

```bash
codegraph export async-clipboard-read-text --format json > scenario.json
codegraph export async-clipboard-read-text --format mermaid
codegraph export async-clipboard-read-text --format markdown
```

#### `codegraph import <file>`

Import a scenario from a JSON file.

```bash
codegraph import scenarios/async-clipboard-read-text.json
```

#### `codegraph diff <id>`

Compare scenario versions after corrections.

```bash
codegraph diff async-clipboard-read-text --v1 1 --v2 2
```

> **Full CLI reference:** See [`docs/next/cli-reference.md`](docs/next/cli-reference.md)

---

## Configuration Reference

CodeGraph is configured via `.codegraph.yaml` in the project root. See [`.codegraph.yaml.example`](.codegraph.yaml.example) for a fully commented example.

```yaml
project:
  name: "my-project"
  languages: ["ts"]                    # "ts", "cpp", "c"
  rootDirs: ["src"]                    # directories to index
  excludeDirs: ["node_modules", "dist", ".git"]

neo4j:
  uri: "bolt://localhost:7687"
  username: "neo4j"
  password: "${CODEGRAPH_NEO4J_PASSWORD}"  # env var substitution
  database: "neo4j"

parser:
  typescript:
    tsconfig: "tsconfig.json"
  cpp:                                 # only for C++ projects
    compileCommands: "out/Default/compile_commands.json"
    clangdPath: "/usr/bin/clangd"

ai:
  provider: "openai"                   # "openai" | "mock"
  model: "gpt-4-turbo"
  apiKey: "${CODEGRAPH_AI_API_KEY}"
  maxTokensPerRequest: 120000
  temperature: 0.2                     # low for deterministic analysis

tracing:
  maxDepth: 50                         # max call depth to trace
  maxStepsPerFunction: 200
  boringFunctions: ["LOG*", "DCHECK*"] # auto-summarize, don't trace
  boringNamespaces: ["testing"]
  focusFunctions: []                   # always trace, even if deep

server:
  port: 3000
  host: "127.0.0.1"
```

**Environment variables:**

| Variable | Description |
|---|---|
| `CODEGRAPH_NEO4J_PASSWORD` | Neo4j password (referenced in config as `${CODEGRAPH_NEO4J_PASSWORD}`) |
| `CODEGRAPH_AI_API_KEY` | OpenAI API key (referenced in config as `${CODEGRAPH_AI_API_KEY}`) |
| `CODEGRAPH_AI_MOCK` | Set to `true` to use mock AI responses (no API key needed) |

---

## API Reference

### GraphQL API

Available at `http://localhost:3000/graphql` when the server is running.

#### Queries

```graphql
# List all scenarios
query {
  scenarios(filter: { status: validated }) {
    id
    name
    description
    status
    confidence
  }
}

# Get scenario with walkthrough steps
query {
  scenario(id: "handle-file-drop") {
    name
    steps {
      stepNumber
      functionName
      action
      justification
      variableState
      confidence
    }
  }
}

# Search functions
query {
  searchFunctions(query: "handleFileDrop", limit: 10) {
    id
    qualifiedName
    signature
    filePath
    startLine
  }
}

# Find callers of a function
query {
  callers(functionId: "pipeline-handleFileDrop") {
    function { qualifiedName signature }
    line
    callExpression
  }
}

# Find call chain between two functions
query {
  callChain(fromId: "handleUserFileDrop", toId: "resizeImage", maxDepth: 10)
}

# Get graph statistics
query {
  stats {
    totalNodes
    totalRelationships
    nodes
    relationships
  }
}
```

#### Mutations

```graphql
# Index codebase
mutation {
  indexCodebase(config: { rootDirs: ["src"], excludeDirs: ["node_modules"] }) {
    filesProcessed
    functionsIndexed
    classesIndexed
    callEdgesIndexed
    durationMs
  }
}

# Discover scenarios
mutation {
  discoverScenarios(hint: "file processing") {
    id
    name
    description
    confidence
  }
}

# Trace a scenario
mutation {
  traceScenario(scenarioId: "handle-file-drop") {
    stepsCreated
    functionsTraversed
    branchDecisions
    dispatchesResolved
    durationMs
  }
}

# Submit a correction
mutation {
  submitCorrection(input: {
    scenarioId: "handle-file-drop"
    stepNumber: 5
    message: "The file is actually a directory, so validation fails"
  }) {
    correction { id type rule scope }
    affectedSteps { stepNumber functionName }
    retraceTriggered
  }
}
```

### REST API

All endpoints are under `/api`.

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/stats` | Graph statistics |
| `GET` | `/api/scenarios` | List scenarios (`?status=validated`) |
| `POST` | `/api/scenarios/discover` | Discover scenarios (`{ hint: "..." }`) |
| `GET` | `/api/scenarios/:id` | Get scenario by ID |
| `GET` | `/api/scenarios/:id/steps` | Get walkthrough steps (`?from=1&to=10`) |
| `POST` | `/api/scenarios/:id/trace` | Trace a scenario |
| `POST` | `/api/corrections` | Submit correction |
| `GET` | `/api/corrections` | List corrections (`?scenarioId=...&scope=global`) |
| `GET` | `/api/functions/search` | Search functions (`?q=handle&limit=25`) |
| `GET` | `/api/functions/:id/callers` | Who calls this function |
| `GET` | `/api/functions/:id/callees` | What this function calls |

---

## Testing

```bash
# Unit tests (no external dependencies)
npm test

# Integration tests (requires Neo4j running)
npm run test:integration

# E2E tests (full workflow)
npm run test:e2e

# Lint
npm run lint

# Run tests with mock AI (no API key needed)
CODEGRAPH_AI_MOCK=true npm test
```

See [docs/next/testing.md](docs/next/testing.md) for the full testing guide.

---

## Project Structure

```
code-graph/
├── packages/
│   ├── core/                    # Core engine (parsers, graph, AI, scenarios, corrections)
│   │   └── src/
│   │       ├── parser/          # ICodeParser interface, TypeScript parser, clang parser
│   │       ├── graph/           # Neo4j driver, schema, indexer, query engine
│   │       ├── ai/              # AI agents (discovery, path-tracer, variable-imaginer, justifier)
│   │       ├── scenario/        # Scenario engine, tracer
│   │       ├── correction/      # Correction engine
│   │       └── config/          # Config loader, logger
│   ├── cli/                     # CLI tool (Commander.js)
│   │   └── src/commands/        # init, index, discover, trace, walk, correct, query, serve, doctor, stats
│   ├── server/                  # API server (Express + Apollo Server)
│   │   └── src/
│   │       ├── graphql/         # Schema, resolvers
│   │       └── rest/            # REST routes
│   └── web/                     # Web UI (React + Vite)
│       └── src/
│           ├── components/      # ScenarioList, ScenarioDetail, Walkthrough, CallGraph, CorrectionChat
│           └── stores/          # Zustand state management
├── test/
│   ├── fixtures/
│   │   └── sample-project/      # Sample TypeScript project for demos and testing
│   ├── unit/                    # Unit tests
│   ├── integration/             # Integration tests
│   └── e2e/                     # End-to-end tests
├── docs/
│   └── next/
│       ├── design.md            # Full design document
│       ├── architecture.md      # Architecture deep dive
│       ├── testing.md           # Testing guide
│       └── usage-guide.md       # Detailed usage guide
├── package.json                 # Workspace root
└── tsconfig.base.json           # Shared TypeScript config
```

---

## Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 20+ |
| Language | TypeScript | 5.3 |
| Graph DB | Neo4j | 5.x |
| Neo4j driver | neo4j-driver | 5.17 |
| AI | OpenAI API | 4.28 |
| TS parsing | ts-morph | 21.0 |
| C++ parsing | clangd (LSP) | 15+ |
| Config validation | Zod | 3.22 |
| Config format | YAML | yaml 2.3 |
| CLI framework | Commander.js | 12.0 |
| CLI prompts | Inquirer.js | 9.2 |
| CLI output | chalk, ora, cli-table3 | latest |
| API server | Express | 4.18 |
| GraphQL | Apollo Server | 4.10 |
| Web framework | React | 18.2 |
| Graph rendering | Cytoscape.js | 3.28 |
| State management | Zustand | 4.5 |
| GraphQL client | Apollo Client | 3.9 |
| Build tool (web) | Vite | 5.0 |
| Testing | Vitest | 1.2 |
| Logging | Winston | 3.11 |
| Linting | ESLint | 8.56 |

---

## Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feature/my-feature`
3. Install dependencies: `npm install`
4. Make changes and add tests
5. Run the test suite: `npm test && npm run lint`
6. Commit with [conventional commits](https://www.conventionalcommits.org/): `git commit -m "feat: add support for Python parser"`
7. Push and open a pull request

### Development setup

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests
npm test

# Start the server in development mode
cd packages/server && npm run dev

# Start the web UI in development mode
cd packages/web && npm run dev
```

---

## License

MIT © CodeGraph Contributors
