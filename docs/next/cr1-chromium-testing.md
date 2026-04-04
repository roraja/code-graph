# Testing CodeGraph with the cr1 Chromium Workspace

## Execution Status (2026-04-03)

### What Was Executed

CodeGraph was initialized and run against the cr1 Chromium workspace at `/workspace/cr1/src`.

| Step | Command | Result |
|------|---------|--------|
| Neo4j startup | `docker run ... neo4j:5` | ✅ Running on `bolt://localhost:7687` |
| Init | `codegraph init --lang cpp --neo4j bolt://localhost:7687` | ✅ Created `.codegraph.yaml` |
| Doctor | `codegraph doctor` | ✅ All checks passed (⚠ clangd warning) |
| Index (C++) | `codegraph index third_party/blink/renderer/modules/clipboard` | ⚠ 0 files — **C++ parser not implemented** |
| Import scenario | `codegraph import async-clipboard-read-text.json` | ✅ 1 scenario, 15 steps imported |
| Stats | `codegraph stats` | ✅ 16 nodes, 29 relationships |
| Scenarios | `codegraph scenarios` | ✅ 1 scenario listed (traced, 95% confidence) |
| View | `codegraph view async-clipboard-readtext-api-call` | ✅ Full 15-step trace displayed |
| View step | `codegraph view ... --step 8` | ✅ Mojo IPC step with source, vars, justification |

### Key Finding: C++ Parser Not Implemented

The `codegraph index` command uses `TypeScriptParser` (ts-morph) internally. **There is no C++ parser implementation** — only the configuration schema (`parser.cpp.compileCommands`, `parser.cpp.clangdPath`) and the `codegraph doctor` clangd check exist. The index command is hardcoded to TypeScript.

**What works today:**
- ✅ Importing pre-built scenarios (JSON) into Neo4j
- ✅ Viewing, listing, exporting scenarios
- ✅ Graph database storage and querying
- ✅ Interactive walkthrough (`codegraph walk`)

**What needs C++ parser implementation:**
- ❌ Automated code parsing (`codegraph index` for C++ files)
- ❌ AI-powered scenario discovery (`codegraph discover`)
- ❌ Automated tracing (`codegraph trace`)

### Chromium Clipboard Scenario

The hand-crafted `scenarios/async-clipboard-read-text.json` was imported. It traces 15 steps of `navigator.clipboard.readText()`:

```
Clipboard::readText (renderer, JS binding)
  → ClipboardPromise::CreateForReadText
    → HandleReadText (permission check)
      → Permission GRANTED (branch_taken)
      → macOS check SKIPPED (branch_skipped)
        → SystemClipboard::ReadPlainText
          → Snapshot cache SKIPPED (branch_skipped)
          → Mojo IPC → ClipboardHostImpl::ReadText (browser process)
            → IsRendererPasteAllowed (branch_taken)
            → ExtractText → ui::Clipboard::ReadText (virtual dispatch)
              → OnReadText → PasteIfPolicyAllowed → Promise resolved
```

---

## Prerequisites for Testing Against cr1

### 1. Environment

| Requirement | Details |
|---|---|
| **cr1 Chromium source** | `/workspace/cr1/src` (currently not available on this machine — was at `/workspace/cr1/src` in a different environment) |
| **Neo4j 5.x** | Docker container with APOC plugin |
| **clangd** | Required by the C++ parser — must match the Chromium build toolchain |
| **compile_commands.json** | Generated via `gn gen out/Default --export-compile-commands` in the Chromium source |
| **Node.js 20+** | For running CodeGraph |
| **OpenAI API key** | For AI-powered scenario discovery and tracing (or use `CODEGRAPH_AI_MOCK=true` for dry runs) |

### 2. Chromium Build Setup

```bash
# In the cr1 workspace
cd /workspace/cr1/src

# Generate compile_commands.json (required by C++ parser)
gn gen out/Default --export-compile-commands

# Verify it exists
ls -la out/Default/compile_commands.json
```

---

## Step-by-Step: Running CodeGraph on cr1

### Step 1: Start Neo4j

```bash
docker run -d \
  --name codegraph-neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/codegraph123 \
  -e NEO4J_PLUGINS='["apoc"]' \
  -v codegraph-data:/data \
  neo4j:5

export CODEGRAPH_NEO4J_PASSWORD=codegraph123
```

### Step 2: Build CodeGraph

```bash
cd /home/roraja/src/code-graph  # or wherever code-graph is checked out
npm install
npm run build
```

### Step 3: Initialize in the Chromium workspace

```bash
cd /workspace/cr1/src

# Initialize CodeGraph for C++
codegraph init --lang cpp \
  --neo4j bolt://localhost:7687 \
  --compile-commands out/Default/compile_commands.json
```

This creates `.codegraph.yaml`. Edit it to scope the indexing:

```yaml
project:
  name: "chromium"
  languages: ["cpp"]
  rootDirs:
    - third_party/blink/renderer/modules/clipboard
    - content/browser/renderer_host
    - ui/base/clipboard
  excludeDirs:
    - out
    - third_party/blink/renderer/modules/clipboard/test

neo4j:
  uri: "bolt://localhost:7687"
  username: "neo4j"
  password: "${CODEGRAPH_NEO4J_PASSWORD}"
  database: "neo4j"

parser:
  compileCommands: "out/Default/compile_commands.json"

ai:
  provider: "openai"
  model: "gpt-4-turbo"
  apiKey: "${CODEGRAPH_AI_API_KEY}"
  temperature: 0.2

tracing:
  maxDepth: 50
  maxStepsPerFunction: 200
  boringFunctions:
    - "LOG*"
    - "DCHECK*"
    - "DLOG*"
    - "DVLOG*"
    - "base::*Ref*"
    - "base::internal::*"
    - "TRACE_EVENT*"
  boringNamespaces:
    - "base::internal"
    - "testing"
```

### Step 4: Index (start small!)

**Do NOT index all of Chromium.** Start with the clipboard subsystem:

```bash
# Index just the clipboard-related directories
codegraph index third_party/blink/renderer/modules/clipboard --include-deps
codegraph index content/browser/renderer_host/clipboard_host_impl.cc --include-deps
codegraph index ui/base/clipboard --include-deps

# Verify
codegraph stats
```

### Step 5: Discover scenarios

```bash
# AI discovers clipboard-related scenarios
codegraph discover --hint "async clipboard readText API call"

# Or import the existing hand-crafted scenario
codegraph import ../../home/roraja/src/code-graph/scenarios/async-clipboard-read-text.json

# List what's available
codegraph scenarios
```

### Step 6: Trace a scenario

```bash
codegraph trace "async-clipboard-read-text"
```

### Step 7: Walk through it

```bash
codegraph walk "async-clipboard-read-text"

# In the REPL:
#   n / next — advance one step
#   p / prev — go back
#   j 8     — jump to step 8
#   vars    — show variable state
#   why     — show AI justification
#   correct — override an AI decision
#   q       — quit
```

### Step 8: Launch the web UI

```bash
codegraph serve --port 3000
# Open http://localhost:3000
```

---

## Recommended Test Scenarios for Chromium

| Scenario | Entry Point | Why It's a Good Test |
|---|---|---|
| **Clipboard readText** | `Clipboard::readText` | Cross-process (renderer → browser), Mojo IPC, permission checks, virtual dispatch |
| **Clipboard write** | `Clipboard::writeText` | Similar path, reverse direction |
| **Drag and drop files** | `WebContentsImpl::OnDragEnter` | Complex event routing, platform abstraction |
| **Navigation start** | `NavigationRequest::BeginNavigation` | Deep call stack, many branches, security checks |
| **Service worker fetch** | `ServiceWorkerFetchDispatcher::Run` | Async callbacks, Mojo, multiple process hops |

---

## Known Limitations & Gotchas

1. **C++ parser depends on clangd** — Must have a working `compile_commands.json`. Chromium's build system uses GN/Ninja, so you need `gn gen --export-compile-commands`.

2. **Chromium is massive** — Indexing all 35M+ lines will overwhelm Neo4j and take hours. Always scope to a subsystem.

3. **Macros and templates** — Chromium heavily uses macros (`CONTENT_EXPORT`, `IPC_MESSAGE_HANDLER`, etc.) and templates. The C++ parser may not resolve all of these — check `codegraph stats` after indexing.

4. **Cross-process boundaries** — Mojo IPC boundaries are the hardest part. The parser sees the Mojo interface definition but may not automatically link the renderer-side proxy to the browser-side implementation. You may need to use corrections or manual scenario steps for these boundaries.

5. **`boringFunctions` config is critical** — Without it, traces will be flooded with `DCHECK`, `LOG`, `base::RefCounted` noise. Configure `tracing.boringFunctions` aggressively.

6. **cr1 workspace location** — The cr1 checkout was at `/workspace/cr1/src` in a previous environment (detached at commit `1453a202fccc7`). This path may not exist on the current machine. If you need to re-clone, see internal Chromium checkout docs.

---

## Verifying Results

### Quick smoke test

```bash
# After indexing, check that functions were found
codegraph stats
# Expected: Functions > 0, Call edges > 0

# Search for a known function
codegraph functions --search "Clipboard::readText"

# Query callers
codegraph query callers "Clipboard::readText"
```

### Via Neo4j Browser

Open http://localhost:7474 and run:

```cypher
// Check indexed functions
MATCH (f:Function)
WHERE f.filePath CONTAINS 'clipboard'
RETURN f.qualifiedName, f.filePath, f.startLine
ORDER BY f.filePath
LIMIT 50

// Check call edges
MATCH (caller:Function)-[:CALLS]->(callee:Function)
WHERE caller.filePath CONTAINS 'clipboard' OR callee.filePath CONTAINS 'clipboard'
RETURN caller.qualifiedName AS caller, callee.qualifiedName AS callee
LIMIT 50
```

### Unit tests (no cr1 needed)

```bash
cd /home/roraja/src/code-graph
npm test   # Runs all unit tests with mocks — no Neo4j or cr1 required
```

### Integration tests (Neo4j required, no cr1 needed)

```bash
npm run test:integration   # Uses test fixtures, not Chromium source
```
