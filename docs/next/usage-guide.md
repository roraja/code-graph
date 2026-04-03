# Usage Guide

A detailed walkthrough of CodeGraph using the included sample project. By the end of this guide you will have indexed a codebase, discovered scenarios, traced execution paths, submitted corrections, and explored the results in the web UI.

---

## Prerequisites

Before starting, make sure you have:

1. **Node.js 20+** installed
2. **Neo4j 5.x** running (see [Quick Start](../../README.md#quick-start) for Docker setup)
3. **CodeGraph built** — `npm install && npm run build` from the repo root

---

## Step 1: Install and Configure

### Start Neo4j

```bash
docker run -d \
  --name codegraph-neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/codegraph123 \
  -e NEO4J_PLUGINS='["apoc"]' \
  -v codegraph-data:/data \
  neo4j:5
```

### Set environment variables

```bash
export CODEGRAPH_NEO4J_PASSWORD=codegraph123

# Use a real API key for AI features:
export CODEGRAPH_AI_API_KEY=sk-...

# Or use mock mode (no API key needed):
export CODEGRAPH_AI_MOCK=true
```

### Initialize the sample project

```bash
cd test/fixtures/sample-project

codegraph init --lang ts --neo4j bolt://localhost:7687
```

This creates `.codegraph.yaml` in the sample project directory. Edit it if needed:

```yaml
project:
  name: "sample-project"
  languages: ["ts"]
  rootDirs: ["src"]
  excludeDirs: ["node_modules", "dist"]

neo4j:
  uri: "bolt://localhost:7687"
  username: "neo4j"
  password: "${CODEGRAPH_NEO4J_PASSWORD}"

ai:
  provider: "openai"       # or "mock"
  model: "gpt-4-turbo"
  apiKey: "${CODEGRAPH_AI_API_KEY}"
  temperature: 0.2

server:
  port: 3000
  host: "127.0.0.1"
```

---

## Step 2: Index the Sample Project

```bash
codegraph index ./src
```

CodeGraph parses all TypeScript files in `src/`, extracts code structure, and writes it to Neo4j.

**Expected output:**

```
⠋ Indexing ./src...
  Parsing: src/types.ts
  Parsing: src/validators.ts
  Parsing: src/processors.ts
  Parsing: src/pipeline.ts
  Parsing: src/events.ts
  Parsing: src/index.ts

✓ Indexing complete
  Files indexed:     6
  Functions:         18
  Classes:           7
  Call edges:        24
  Branches:          5
  Duration:          1.2s
```

### Verify with `codegraph stats`

```bash
codegraph stats
```

```
╔══════════════════════════════╗
║      CodeGraph Statistics    ║
╠══════════════════════════════╣
║  Files          │ 6          ║
║  Functions      │ 18         ║
║  Classes        │ 7          ║
║  Call edges     │ 24         ║
║  Branches       │ 5          ║
║  Scenarios      │ 0          ║
║  Corrections    │ 0          ║
╚══════════════════════════════╝
```

---

## Step 3: Discover Scenarios

```bash
codegraph discover --hint "user drops files"
```

The AI analyzes entry points, event handlers, and public APIs to identify realistic usage scenarios.

**Expected output:**

```
⠋ Discovering scenarios...

✓ Found 3 scenarios:

  1. handle-file-drop
     "User drops image and document files onto the application"
     Entry: handleUserFileDrop
     Confidence: 0.92

  2. handle-invalid-file
     "User drops an oversized or unsupported file type"
     Entry: handleUserFileDrop
     Confidence: 0.85

  3. handle-empty-drop
     "User triggers a drop event with an empty file list"
     Entry: handleUserFileDrop
     Confidence: 0.78
```

### List scenarios

```bash
codegraph scenarios
```

```
┌───┬─────────────────────┬────────┬──────┬────────────┐
│ # │ Name                │ Status │ Steps│ Confidence │
├───┼─────────────────────┼────────┼──────┼────────────┤
│ 1 │ handle-file-drop    │ draft  │ —    │ 0.92       │
│ 2 │ handle-invalid-file │ draft  │ —    │ 0.85       │
│ 3 │ handle-empty-drop   │ draft  │ —    │ 0.78       │
└───┴─────────────────────┴────────┴──────┴────────────┘
```

---

## Step 4: Trace a Scenario

```bash
codegraph trace "handle-file-drop"
```

The AI traces the execution path step by step — following function calls, evaluating branch conditions, resolving dispatch, and imagining variable values.

**Expected output:**

```
⠋ Tracing scenario "handle-file-drop"...
  Entry: handleUserFileDrop
  ✓ Step 1: handleUserFileDrop — create validators and processors
  ✓ Step 2: FileProcessingPipeline constructor
  ✓ Step 3: FileDropEventHandler constructor
  ✓ Step 4: LoggingEventHandler constructor
  ✓ Step 5: LoggingEventHandler.handle — branch: event === 'file-drop' → TRUE
  ✓ Step 6: FileDropEventHandler.handle
  ✓ Step 7: FileProcessingPipeline.handleFileDrop
  ✓ Step 8: Branch: files.length === 0 → FALSE (4 files dropped)
  ✓ Step 9: validateFile — SizeValidator.validate → TRUE
  ✓ Step 10: validateFile — TypeValidator.validate → TRUE
  ✓ Step 11: findProcessor — ImageProcessor.supports("image/png") → TRUE
  ✓ Step 12: ImageProcessor.process
  ...

✓ Trace complete
  Steps created:          22
  Functions traversed:    12
  Branch decisions:       5
  Dispatches resolved:    3
  Duration:               3.4s
```

---

## Step 5: Interactive Walkthrough

```bash
codegraph walk "handle-file-drop"
```

This starts an interactive REPL that lets you step through the scenario line by line:

```
╔══════════════════════════════════════════════════════════════╗
║  Scenario: handle-file-drop                                 ║
║  User drops image and document files onto the application   ║
╠══════════════════════════════════════════════════════════════╣
║  Step 1 / 22                                                ║
║  📍 Function: handleUserFileDrop                            ║
║  📁 File: src/index.ts                                      ║
║                                                              ║
║  40│ export async function handleUserFileDrop(              ║
║  41│   fileNames: string[]                                  ║
║  42│ ): Promise<void> {                                     ║
║  43│ ▶ const validators = [new SizeValidator(), ...];       ║
║  44│   const processors = [new ImageProcessor(), ...];      ║
║                                                              ║
║  ┌─ Variable State ──────────────────────────────────────┐  ║
║  │ fileNames = ["photo.png", "document.pdf",             │  ║
║  │              "notes.txt", "data.json"]                 │  ║
║  └───────────────────────────────────────────────────────┘  ║
║                                                              ║
║  ┌─ Justification ──────────────────────────────────────┐   ║
║  │ Entry point of the file drop workflow. The user       │   ║
║  │ drops 4 files of different types: an image, a PDF,    │   ║
║  │ a text file, and a JSON file.                         │   ║
║  └───────────────────────────────────────────────────────┘   ║
╚══════════════════════════════════════════════════════════════╝

codegraph> _
```

### REPL Commands

| Command | Action |
|---|---|
| `n` or `next` | Advance to next step |
| `p` or `prev` | Go back to previous step |
| `j 12` | Jump to step 12 |
| `vars` | Show all imagined variable values at current step |
| `why` | Show AI justification for current step |
| `correct` | Enter correction mode |
| `graph` | Show the call graph at current point |
| `q` or `quit` | Exit the walkthrough |

**Example — viewing a branch decision:**

```
codegraph> j 8

  Step 8 / 22
  📍 Function: FileProcessingPipeline.handleFileDrop
  📁 File: src/pipeline.ts

  13│   if (files.length === 0) {       ← BRANCH: FALSE
  14│     return [];                     ← SKIPPED
  15│   }

  ┌─ Justification ──────────────────────────────────────┐
  │ Taking FALSE branch: files.length is 4 (the user     │
  │ dropped 4 files), so the early return is skipped     │
  │ and processing continues.                             │
  │                                                       │
  │ Confidence: 0.98                                      │
  └───────────────────────────────────────────────────────┘

codegraph> _
```

---

## Step 6: Submit Corrections

If the AI made an incorrect assumption, you can correct it:

### Via the walkthrough REPL

```
codegraph> correct
Enter correction: The user only dropped 1 file — a PDF document

✅ Correction applied:
  - Type: variable_constraint
  - Rule: fileNames.length == 1, fileNames = ["report.pdf"]
  - Scope: scenario
  - Re-tracing from step 1...
  - ⟳ Re-trace complete: 14 steps changed downstream.
```

### Via the CLI

```bash
codegraph correct "handle-file-drop" --step 8 \
  --message "files array is empty in this scenario"
```

### Correction types

| Type | Example |
|---|---|
| Variable constraint | "file_count is always 0 for directories" |
| Branch override | "The else branch is taken here" |
| Dispatch override | "Use DocumentProcessor, not ImageProcessor" |
| Scenario note | "This scenario handles both files and directories" |
| Function skip | "Ignore the logging handler — it's just decoration" |
| Function include | "Trace into resizeImage, it's important" |
| Global rule | "SizeValidator always passes in test mode" |

---

## Step 7: Use the Web UI

```bash
codegraph serve --port 3000
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Views

**Scenario List** (`/`)
- Lists all discovered scenarios with status (draft, traced, validated, corrected)
- Filter and search scenarios
- Click a scenario to view its detail

**Scenario Detail** (`/scenario/:id`)
- Interactive call graph (Cytoscape.js):
  - Functions as nodes, colored by file/module
  - Calls as directed edges
  - Branches shown as diamonds
  - Virtual dispatch shown as dashed edges
  - Click a node to see source code
  - Hover for AI justification
- Source code panel with highlighted execution path
- AI justification panel
- Correction chat input

**Walkthrough** (`/scenario/:id/walk`)
- Step-by-step walkthrough with prev/next navigation
- Variable state panel
- Justification panel
- Correction chat

---

## Step 8: Query the Graph

### Via CLI

```bash
# Find who calls handleFileDrop
codegraph query callers "FileProcessingPipeline.handleFileDrop"

# Find what handleFileDrop calls
codegraph query callees "FileProcessingPipeline.handleFileDrop"

# Find the call path from entry point to a specific function
codegraph query path --from "handleUserFileDrop" --to "resizeImage"
```

### Via GraphQL

```bash
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ searchFunctions(query: \"handleFileDrop\") { qualifiedName signature filePath startLine } }"
  }'
```

### Via REST

```bash
# Search functions
curl "http://localhost:3000/api/functions/search?q=validate&limit=10"

# Get scenario steps
curl "http://localhost:3000/api/scenarios/handle-file-drop/steps"

# Health check
curl "http://localhost:3000/api/health"
```

### Via Neo4j Browser

Open [http://localhost:7474](http://localhost:7474) and run Cypher queries directly:

```cypher
// List all functions
MATCH (f:Function) RETURN f.qualifiedName, f.signature LIMIT 20

// Find the call graph for handleFileDrop
MATCH (caller:Function)-[:CALLS]->(callee:Function)
WHERE caller.name = 'handleFileDrop' OR callee.name = 'handleFileDrop'
RETURN caller.qualifiedName, callee.qualifiedName

// Find all scenarios and their entry functions
MATCH (s:Scenario)-[:STARTS_AT]->(f:Function)
RETURN s.name, s.status, f.qualifiedName

// Get the walkthrough steps for a scenario
MATCH (s:Scenario {id: "handle-file-drop"})-[:HAS_STEP]->(step:ScenarioStep)
MATCH (step)-[:EXECUTES]->(f:Function)
RETURN step.stepNumber, f.qualifiedName, step.action, step.justification
ORDER BY step.stepNumber
```

---

## Using with Chromium

CodeGraph was designed with large C++ codebases like Chromium in mind.

### Setup

```bash
# 1. Generate compile_commands.json
cd chromium/src
gn gen out/Default --export-compile-commands

# 2. Initialize CodeGraph
codegraph init --lang cpp \
  --neo4j bolt://localhost:7687 \
  --compile-commands out/Default/compile_commands.json

# 3. Index a subsystem (full Chromium is huge — start small)
codegraph index src/content/browser/web_contents --include-deps

# 4. Check results
codegraph stats

# 5. Discover drag-and-drop scenarios
codegraph discover --hint "drag and drop files"
```

### Tips for large codebases

- **Index selectively** — start with a specific subsystem, not the entire source tree
- **Use `--include-deps`** — index header dependencies so call edges resolve correctly
- **Configure `boringFunctions`** — skip logging, assertions, and ref-counting to reduce trace noise:
  ```yaml
  tracing:
    boringFunctions: ["LOG*", "DCHECK*", "base::*Ref*"]
    boringNamespaces: ["base::internal", "testing"]
  ```
- **Use `focusFunctions`** — ensure important functions are always traced, even if deep

---

## Using with a Node.js/TypeScript Project

```bash
cd /path/to/your/ts-project

# Initialize
codegraph init --lang ts --neo4j bolt://localhost:7687

# Edit .codegraph.yaml to match your project structure
# - Set rootDirs to your source directories
# - Set excludeDirs to skip node_modules, dist, test, etc.

# Index
codegraph index ./src

# Discover and explore
codegraph discover --hint "API request handling"
codegraph trace "handle-api-request"
codegraph walk "handle-api-request"
```

---

## Configuration Tips

### Multiple source directories

```yaml
project:
  rootDirs:
    - src/core
    - src/api
    - src/services
  excludeDirs:
    - node_modules
    - dist
    - __tests__
    - "*.test.ts"
```

### Low AI temperature for deterministic traces

```yaml
ai:
  temperature: 0.1   # lower = more deterministic
```

### Increase trace depth for deep call stacks

```yaml
tracing:
  maxDepth: 100
  maxStepsPerFunction: 500
```

---

## Troubleshooting

### "No .codegraph.yaml found"

Run `codegraph init` in your project root, or specify the config path:

```bash
codegraph --config /path/to/project index ./src
```

### Neo4j connection refused

Make sure Neo4j is running and accessible:

```bash
# Check Docker container
docker ps | grep neo4j

# Restart if needed
docker restart codegraph-neo4j

# Verify connectivity
codegraph doctor
```

### "CODEGRAPH_AI_API_KEY is not set"

Either set the environment variable:
```bash
export CODEGRAPH_AI_API_KEY=sk-...
```

Or use mock mode for testing:
```bash
export CODEGRAPH_AI_MOCK=true
```

Or set `ai.provider: "mock"` in `.codegraph.yaml`.

### Slow indexing

- Reduce the scope: index specific directories instead of the entire project
- Use `--incremental` to skip unchanged files
- Check that `excludeDirs` is properly configured to skip `node_modules`, `dist`, etc.

### Empty scenario discovery

- Make sure the codebase is indexed (`codegraph stats` should show functions)
- Try a more specific hint: `codegraph discover --hint "file upload handling"`
- Try specifying an entry point: `codegraph discover --entry-point "handleUserFileDrop"`

### Port already in use

```bash
codegraph serve --port 4000   # use a different port
```
