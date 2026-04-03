# CodeGraph — Design Document

**A tool for AI-assisted code understanding through graph-based call-path analysis**

---

## 1. Problem Statement

Understanding large codebases (e.g., Chromium, ~35M lines of C++) requires manually tracing call stacks: reading a function, imagining variable values, evaluating branch conditions, looking up virtual function implementations, and mentally following execution paths across thousands of files. This is slow, error-prone, and impossible to share or persist.

### What CodeGraph Does

CodeGraph automates this process by:

1. **Parsing** a codebase into a graph database (Neo4j) — functions, calls, branches, virtual dispatch, data flow.
2. **Using AI** to discover realistic scenarios (e.g., "user drops a file onto a Chromium tab") and trace full execution paths for each scenario.
3. **Providing a visual walkthrough** — line-by-line, with AI-imagined variable values and justifications for every branch/dispatch decision.
4. **Accepting human corrections** — users can override AI decisions via chat prompts, and the graph updates accordingly.

### Target Users

- Engineers onboarding onto large codebases
- Engineers investigating bugs or performance issues
- Architecture reviewers trying to understand control flow

---

## 2. Architecture Overview

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
│  │ clangd / │                    │   Neo4j     │                   │
│  │ ts-morph │                    │   Database  │                   │
│  │ LSP      │                    │             │                   │
│  └──────────┘                    └─────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Summary

| Component | Responsibility | Tech |
|---|---|---|
| **Parser Layer** | Extract AST, call graph, types, virtual dispatch | clangd (C++), ts-morph (TS), tree-sitter (polyglot) |
| **Neo4j Graph DB** | Store code structure, scenarios, corrections | Neo4j 5.x, neo4j-driver |
| **AI Agent Layer** | Scenario discovery, variable imagination, justification | OpenAI / Copilot API, LangChain.js |
| **Core Engine** | Orchestrates parsing, AI calls, graph writes | Node.js / TypeScript |
| **Scenario Engine** | Creates/manages scenarios, traces call paths | TypeScript |
| **Correction Engine** | Processes human corrections, updates graph | TypeScript |
| **Query Engine** | Graph queries, path traversal, search | Cypher, TypeScript |
| **API Server** | Exposes all functionality via GraphQL + REST | Express, Apollo Server |
| **Web UI** | Interactive graph visualization, walkthrough | React, Cytoscape.js, Monaco Editor |
| **VS Code Extension** | In-editor integration, jump-to-definition aware | VS Code Extension API |
| **CLI / REPL** | Command-line access, scripting | Commander.js, Inquirer.js |

---

## 3. Data Model — Neo4j Graph Schema

### 3.1 Node Types

```cypher
// === Code Structure Nodes ===

(:File {
  path: String,           // "src/browser/drop_handler.cc"
  language: String,       // "cpp"
  lastParsed: DateTime,
  hash: String            // content hash for incremental updates
})

(:Function {
  id: String,             // unique ID (file:line or mangled name)
  name: String,           // "HandleFileDrop"
  qualifiedName: String,  // "content::DropHandler::HandleFileDrop"
  filePath: String,
  startLine: Int,
  endLine: Int,
  signature: String,      // "void HandleFileDrop(const DropData& data)"
  isVirtual: Boolean,
  isOverride: Boolean,
  visibility: String,     // "public" | "protected" | "private"
  language: String
})

(:Class {
  name: String,
  qualifiedName: String,
  filePath: String,
  isAbstract: Boolean
})

(:Interface {
  name: String,
  qualifiedName: String,
  filePath: String
})

(:Branch {
  id: String,
  type: String,           // "if" | "else" | "switch_case" | "ternary"
  condition: String,       // "data.file_count > 0"
  filePath: String,
  line: Int
})

(:Variable {
  name: String,
  type: String,
  scope: String,           // "local" | "parameter" | "member" | "global"
  filePath: String,
  line: Int
})

// === Scenario Nodes ===

(:Scenario {
  id: String,              // "drop-file-in-tab"
  name: String,            // "Dropping a file onto a Chromium tab"
  description: String,
  discoveredBy: String,    // "ai" | "human"
  confidence: Float,       // 0.0 - 1.0 (AI confidence)
  status: String,          // "draft" | "validated" | "corrected"
  createdAt: DateTime,
  updatedAt: DateTime
})

(:ScenarioStep {
  id: String,
  stepNumber: Int,
  functionId: String,
  line: Int,
  action: String,          // "call" | "branch_taken" | "branch_skipped"
                           // | "dispatch" | "return" | "assign"
  justification: String,   // AI explanation of why this path
  variableState: JSON,     // {"data.file_count": 3, "is_valid": true}
  correctedBy: String,     // null | userId
  correctionNote: String   // human correction note
})

(:Correction {
  id: String,
  type: String,            // "variable_constraint" | "dispatch_override"
                           // | "branch_override" | "note"
  prompt: String,          // original user chat message
  rule: String,            // extracted rule: "data.file_count != 0"
  scope: String,           // "global" | "scenario" | "function"
  appliedAt: DateTime,
  userId: String
})
```

### 3.2 Relationship Types

```cypher
// === Code Structure Relationships ===

(:File)-[:CONTAINS]->(:Function)
(:File)-[:CONTAINS]->(:Class)
(:Function)-[:CALLS {line: Int, column: Int}]->(:Function)
(:Function)-[:HAS_BRANCH {line: Int}]->(:Branch)
(:Function)-[:READS]->(:Variable)
(:Function)-[:WRITES]->(:Variable)
(:Class)-[:EXTENDS]->(:Class)
(:Class)-[:IMPLEMENTS]->(:Interface)
(:Function)-[:MEMBER_OF]->(:Class)
(:Function)-[:OVERRIDES]->(:Function)
(:Function)-[:VIRTUAL_DISPATCH {
  resolvedTo: [String],   // list of possible implementations
  aiSelected: String,     // which one AI chose for a scenario
  justification: String   // why
}]->(:Function)

// === Scenario Relationships ===

(:Scenario)-[:STARTS_AT]->(:Function)
(:Scenario)-[:HAS_STEP {order: Int}]->(:ScenarioStep)
(:ScenarioStep)-[:EXECUTES]->(:Function)
(:ScenarioStep)-[:NEXT]->(:ScenarioStep)
(:ScenarioStep)-[:TAKES_BRANCH]->(:Branch)
(:ScenarioStep)-[:SKIPS_BRANCH]->(:Branch)
(:ScenarioStep)-[:DISPATCHES_TO]->(:Function)

// === Correction Relationships ===

(:Correction)-[:APPLIES_TO]->(:ScenarioStep)
(:Correction)-[:APPLIES_TO]->(:Function)
(:Correction)-[:APPLIES_TO]->(:Variable)
(:Correction)-[:APPLIES_TO]->(:Scenario)
(:Correction)-[:SUPERSEDES]->(:Correction)
```

### 3.3 Example: "Drop File in Chromium Tab" Graph

```cypher
// Scenario
CREATE (s:Scenario {
  id: "drop-file-in-tab",
  name: "User drops a file onto a Chromium tab",
  description: "Traces from OS drag event through Chromium's content layer to renderer"
})

// Steps
CREATE (s)-[:HAS_STEP {order: 1}]->(s1:ScenarioStep {
  stepNumber: 1,
  action: "call",
  justification: "OS sends WM_DROPFILES → Chromium's message loop dispatches to WebContentsViewAura",
  variableState: '{"drop_data.filenames": ["report.pdf"]}'
})

CREATE (s1)-[:EXECUTES]->(f1:Function {
  qualifiedName: "WebContentsViewAura::OnDragEntered"
})
```

---

## 4. Parser Layer — Detailed Design

### 4.1 Parser Interface

Every language parser implements this interface:

```typescript
interface ICodeParser {
  /** Supported language identifiers */
  languages: string[];

  /** Parse a single file, return extracted nodes and edges */
  parseFile(filePath: string): Promise<ParseResult>;

  /** Resolve which concrete function a virtual/interface call dispatches to */
  resolveDispatch(
    callSite: CallSite,
    context: DispatchContext
  ): Promise<DispatchResolution[]>;

  /** Find all implementations of an abstract method or interface method */
  findImplementations(
    method: FunctionNode
  ): Promise<FunctionNode[]>;
}

interface ParseResult {
  functions: FunctionNode[];
  classes: ClassNode[];
  calls: CallEdge[];
  branches: BranchNode[];
  variables: VariableNode[];
  inheritances: InheritanceEdge[];
}

interface DispatchResolution {
  targetFunction: FunctionNode;
  confidence: number;       // 0.0 - 1.0
  evidence: string;         // "only concrete subclass in this translation unit"
}
```

### 4.2 C/C++ Parser (Primary for Chromium)

**Engine**: `clangd` via LSP protocol + `libclang` bindings

```typescript
class ClangParser implements ICodeParser {
  languages = ["c", "cpp", "cc", "cxx", "h", "hpp"];

  // Uses clangd's LSP for:
  // - textDocument/documentSymbol → functions, classes
  // - textDocument/references → call sites
  // - textDocument/implementation → virtual dispatch resolution
  // - textDocument/typeHierarchy → class hierarchy

  // Uses libclang (via node-libclang) for:
  // - Full AST traversal for branch extraction
  // - Template instantiation resolution
  // - Macro expansion
}
```

**Why clangd + libclang?**

| Need | clangd (LSP) | libclang (AST) |
|---|---|---|
| Find function definitions | ✅ `textDocument/definition` | ✅ cursor traversal |
| Find all callers | ✅ `textDocument/references` | ❌ single-TU only |
| Virtual dispatch | ✅ `textDocument/implementation` | ❌ |
| Branch conditions | ❌ no AST detail | ✅ `IfStmt`, `SwitchStmt` |
| Variable types | ✅ `textDocument/hover` | ✅ `CXType` |
| Macro expansion | ❌ | ✅ |

**Setup for Chromium**: Requires `compile_commands.json` (generated by `gn gen out/Default --export-compile-commands`).

### 4.3 TypeScript/JavaScript Parser

**Engine**: `ts-morph` (TypeScript Compiler API wrapper)

```typescript
class TypeScriptParser implements ICodeParser {
  languages = ["ts", "tsx", "js", "jsx"];

  // ts-morph provides:
  // - Full type-resolved AST
  // - Call expression resolution (including through type narrowing)
  // - Interface implementation lookup
  // - Control flow analysis (if/else, switch, ternary)
}
```

### 4.4 Tree-sitter Fallback

For languages without deep semantic parsers, `tree-sitter` provides syntactic parsing:

```typescript
class TreeSitterParser implements ICodeParser {
  // Provides function/class extraction and call-site detection
  // without type resolution. AI fills in the gaps.
  languages = ["python", "java", "go", "rust"]; // extensible
}
```

### 4.5 Incremental Parsing

```typescript
interface IncrementalParser {
  /** Only re-parse files whose content hash changed */
  parseIncremental(
    rootDir: string,
    previousHashes: Map<string, string>
  ): Promise<IncrementalParseResult>;
}

interface IncrementalParseResult {
  added: ParseResult;
  removed: { functions: string[]; classes: string[]; /* ... */ };
  modified: ParseResult;
  unchanged: number;  // file count
}
```

File content hashes are stored in Neo4j on `(:File)` nodes. On re-index, only changed files are re-parsed. Edges touching removed/modified nodes are re-computed.

---

## 5. AI Agent Layer — Detailed Design

### 5.1 Agent Architecture

The AI layer uses **LangChain.js** with tool-calling agents. Each agent has a specific role:

```typescript
// Agent registry
const agents = {
  scenarioDiscovery: ScenarioDiscoveryAgent,
  pathTracer: PathTracerAgent,
  variableImaginer: VariableImaginerAgent,
  justifier: JustifierAgent,
  correctionInterpreter: CorrectionInterpreterAgent,
};
```

### 5.2 Scenario Discovery Agent

**Role**: Given a codebase and optional user hints, discover realistic usage scenarios.

**Input**: Codebase summary (entry points, public APIs, event handlers, UI elements)

**Output**: List of `Scenario` objects with entry functions and descriptions

```typescript
interface ScenarioDiscoveryInput {
  entryPoints: FunctionSummary[];      // main(), event handlers, API endpoints
  publicAPIs: FunctionSummary[];
  eventHandlers: FunctionSummary[];
  userHint?: string;                   // "I'm interested in file drag-and-drop"
  existingScenarios: ScenarioSummary[];  // avoid duplicates
}

interface DiscoveredScenario {
  name: string;
  description: string;
  entryFunction: string;               // qualified name
  expectedBehavior: string;
  triggerCondition: string;            // "User drags a file from desktop onto browser tab"
  confidence: number;
}
```

**Prompt Template** (simplified):

```
You are a code analysis expert. Given the following codebase entry points
and event handlers, identify realistic user-facing scenarios.

For each scenario:
1. Give it a descriptive name
2. Identify the entry function where execution begins
3. Describe the trigger condition (what the user/system does)
4. Describe expected behavior
5. Rate your confidence (0.0 - 1.0)

Focus on scenarios that involve interesting control flow:
branching, virtual dispatch, cross-module calls.

Entry points:
{entryPoints}

Event handlers:
{eventHandlers}

User hint: {userHint}
```

### 5.3 Path Tracer Agent

**Role**: Given a scenario and entry function, trace the execution path step by step.

**How it works** (iterative):

```
1. Start at entry function
2. For each line:
   a. If it's a function call → resolve target, push onto stack, recurse
   b. If it's a branch (if/else/switch):
      - AI evaluates condition given scenario context + imagined variables
      - AI provides justification ("In this scenario, data.file_count > 0
        because the user dropped at least one file")
      - Records which branch is taken/skipped
   c. If it's virtual dispatch:
      - Parser provides list of implementations
      - AI selects the most likely one given context
      - AI provides justification
   d. If it's a variable assignment → update variable state
3. Continue until return or depth limit
```

**Depth limiting**: Configurable max depth (default: 50 call levels). Functions in a configurable "boring list" (e.g., logging, assertions, ref-counting) are auto-summarized without tracing.

```typescript
interface PathTracerConfig {
  maxDepth: number;            // default: 50
  maxStepsPerFunction: number; // default: 200
  boringFunctions: string[];   // ["LOG()", "DCHECK()", "AddRef()"]
  boringNamespaces: string[];  // ["base::internal", "std::"]
  focusFunctions: string[];    // always trace these, even if deep
}
```

### 5.4 Variable Imaginer Agent

**Role**: Given a scenario context and a variable, imagine a realistic concrete value.

```typescript
interface VariableImaginationRequest {
  variable: { name: string; type: string; scope: string };
  scenarioContext: string;
  surroundingCode: string;    // 10 lines around the variable
  existingState: Record<string, any>;  // already-imagined variables
}

interface VariableImaginationResult {
  value: any;                  // concrete value
  justification: string;      // why this value
  alternatives: any[];         // other plausible values
  confidence: number;
}
```

**Example**:
```
Variable: drop_data.filenames (type: std::vector<base::FilePath>)
Scenario: "User drops a file onto a Chromium tab"
→ Value: ["report.pdf"]
→ Justification: "User dropped a single PDF file. Using one file keeps the
   trace simple. The filename is realistic for a document drop."
→ Alternatives: [["image.png", "photo.jpg"], []]
```

### 5.5 Justifier Agent

**Role**: For every branch decision and virtual dispatch, provide a human-readable explanation.

Every `ScenarioStep` node has a `justification` field. The justifier generates these.

```typescript
interface JustificationRequest {
  decision: {
    type: "branch" | "dispatch";
    condition?: string;           // for branches
    implementations?: string[];   // for dispatch
    chosen: string;               // which branch/implementation was chosen
  };
  scenarioContext: string;
  variableState: Record<string, any>;
  codeSnippet: string;           // relevant source code
}

// Output
interface Justification {
  explanation: string;
  // Example: "Taking the 'if' branch because drop_data.file_count is 1
  //           (> 0). In this scenario, the user dropped a file, so
  //           file_count must be positive."
  confidence: number;
  assumptions: string[];
  // ["User dropped exactly one file", "File is a regular file, not a directory"]
}
```

### 5.6 AI Token Budget Management

Large codebases produce large contexts. We manage token budgets:

```typescript
interface TokenBudget {
  maxContextTokens: number;       // default: 120000 (GPT-4 turbo)
  reserveForResponse: number;     // default: 4000
  codeSnippetMaxLines: number;    // default: 50 lines per snippet
  maxFunctionsInContext: number;  // default: 20
}
```

**Strategy**: Only include relevant code in AI context:
- Current function source
- Caller function source (summarized)
- Type definitions for parameters
- Previously imagined variable state
- Relevant corrections from the user

---

## 6. Correction Engine — Detailed Design

### 6.1 Correction Types

| Correction Type | Example User Prompt | Graph Effect |
|---|---|---|
| **Variable constraint** | "The value of `file_count` can never be 0 in this scenario" | Add constraint on `:Variable`, re-evaluate branches |
| **Branch override** | "In this scenario, the else branch is taken" | Update `:ScenarioStep` action, re-trace from this point |
| **Dispatch override** | "Here, `WebContentsViewWin` is used, not `WebContentsViewAura`" | Update `:DISPATCHES_TO`, re-trace subtree |
| **Scenario note** | "This scenario also handles directories, not just files" | Update `:Scenario` description, may trigger re-trace |
| **Function skip** | "Ignore this function, it's just logging" | Add to boringFunctions, remove steps |
| **Function include** | "Actually trace into `ValidateDropData`, it's important" | Remove from boringFunctions, re-trace with expansion |
| **Global rule** | "In Chromium, `BrowserThread::CurrentlyOn(BrowserThread::UI)` is always true on the UI thread" | Create global `:Correction` node, apply to all scenarios |

### 6.2 Correction Processing Pipeline

```
User types correction in chat
        │
        ▼
┌──────────────────┐
│ CorrectionParser │  ← AI agent interprets natural language
│ (LLM)            │     into structured correction
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ CorrectionValidator│  ← Validates against graph schema
│                    │     (does this function/variable exist?)
└────────┬───────────┘
         │
         ▼
┌──────────────────┐
│ GraphUpdater     │  ← Writes correction to Neo4j
│                  │     Creates (:Correction) node + edges
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Cascading        │  ← Re-traces affected scenario steps
│ Re-tracer        │     downstream from correction point
└──────────────────┘
```

### 6.3 Correction Interpreter Agent

```typescript
interface CorrectionInterpreterInput {
  userMessage: string;
  currentContext: {
    scenario?: ScenarioSummary;
    currentStep?: ScenarioStepDetail;
    currentFunction?: FunctionSummary;
    variableState?: Record<string, any>;
  };
}

interface StructuredCorrection {
  type: CorrectionType;
  target: {
    scenarioId?: string;
    functionId?: string;
    variableName?: string;
    stepId?: string;
    branchId?: string;
    line?: number;
  };
  rule: string;          // machine-interpretable rule
  scope: "global" | "scenario" | "function" | "step";
  confidence: number;    // how confident the AI is in its interpretation
  clarificationNeeded?: string;  // ask user if ambiguous
}
```

### 6.4 Correction Chat Interface

```
╔══════════════════════════════════════════════════════════════╗
║  Scenario: Dropping a file onto a Chromium tab              ║
║  Step 12 of 47 — WebContentsViewAura::OnDragEntered         ║
║  Line 234: if (drop_data.file_count > 0)                    ║
║  ┌─────────────────────────────────────────────────────────┐ ║
║  │  AI Decision: Taking TRUE branch                       │ ║
║  │  Justification: In this scenario the user dropped      │ ║
║  │  a file, so file_count = 1 (> 0).                     │ ║
║  │  Variables: {file_count: 1, is_valid: true}           │ ║
║  └─────────────────────────────────────────────────────────┘ ║
║                                                              ║
║  You: "Actually, the user could drop a directory here too.   ║
║        And file_count would be 0 because directories aren't  ║
║        counted. This should take the else branch."           ║
║                                                              ║
║  CodeGraph: ✅ Got it. I've updated this step:               ║
║    - Changed branch decision to FALSE (else branch)          ║
║    - Set file_count = 0                                      ║
║    - Added note: "Directories are not counted in file_count" ║
║    - Re-tracing steps 13-47 with this correction...          ║
║    - ⟳ Re-trace complete: 8 steps changed downstream.       ║
║                                                              ║
║  [Continue walkthrough] [View changed steps] [Undo]         ║
╚══════════════════════════════════════════════════════════════╝
```

---

## 7. Scenario Engine — Detailed Design

### 7.1 Scenario Lifecycle

```
                  ┌──────────┐
                  │  Draft   │  ← AI discovered or user requested
                  └────┬─────┘
                       │ trace()
                       ▼
                  ┌──────────┐
                  │  Traced  │  ← Full call path traced, steps generated
                  └────┬─────┘
                       │ user reviews
                       ▼
              ┌────────┴────────┐
              │                 │
         ┌────▼─────┐    ┌─────▼────┐
         │Validated │    │Corrected │  ← user applied corrections
         └──────────┘    └────┬─────┘
                              │ re-trace()
                              ▼
                         ┌──────────┐
                         │Validated │
                         └──────────┘
```

### 7.2 Scenario Storage & Versioning

Every correction creates a new version. Users can diff and revert:

```cypher
// Query: Get all versions of a scenario
MATCH (s:Scenario {id: "drop-file-in-tab"})
MATCH (s)-[:HAS_VERSION]->(v:ScenarioVersion)
RETURN v ORDER BY v.version DESC

// Query: Get the diff between two versions
MATCH (v1:ScenarioVersion {scenarioId: "drop-file-in-tab", version: 2})
MATCH (v2:ScenarioVersion {scenarioId: "drop-file-in-tab", version: 3})
MATCH (v2)-[:HAS_STEP]->(s2:ScenarioStep)
WHERE NOT EXISTS {
  MATCH (v1)-[:HAS_STEP]->(s1:ScenarioStep {functionId: s2.functionId, line: s2.line})
  WHERE s1.action = s2.action
}
RETURN s2 AS changedSteps
```

### 7.3 Scenario Query Examples

```cypher
// "Which scenarios call function X?"
MATCH (s:Scenario)-[:HAS_STEP]->(:ScenarioStep)-[:EXECUTES]->(f:Function)
WHERE f.qualifiedName = "content::DropHandler::HandleFileDrop"
RETURN s.name, s.id

// "What is the call stack for scenario Y at step N?"
MATCH path = (s:Scenario {id: "drop-file-in-tab"})-[:HAS_STEP]->(step:ScenarioStep)
WHERE step.stepNumber <= 12
MATCH (step)-[:EXECUTES]->(f:Function)
RETURN step.stepNumber, f.qualifiedName, step.action, step.justification
ORDER BY step.stepNumber

// "Which branches are taken in scenario Y?"
MATCH (s:Scenario {id: "drop-file-in-tab"})-[:HAS_STEP]->(step:ScenarioStep)
MATCH (step)-[:TAKES_BRANCH]->(b:Branch)
RETURN b.condition, b.line, b.filePath, step.justification

// "Find all scenarios where variable X > 0"
MATCH (s:Scenario)-[:HAS_STEP]->(step:ScenarioStep)
WHERE step.variableState CONTAINS '"file_count"'
RETURN s.name, step.variableState
```

---

## 8. Visualization — Web UI Design

### 8.1 Main Views

#### View 1: Scenario List

```
┌──────────────────────────────────────────────────────────────┐
│ CodeGraph — chromium/src                          [⚙ Config] │
├──────────────────────────────────────────────────────────────┤
│ 📋 Scenarios (23 discovered, 5 validated)                    │
│                                                              │
│ 🔍 [Search scenarios...]                                     │
│                                                              │
│ ┌────┬─────────────────────────────┬──────────┬────────────┐ │
│ │ #  │ Scenario                    │ Status   │ Steps      │ │
│ ├────┼─────────────────────────────┼──────────┼────────────┤ │
│ │ 1  │ Drop file onto tab          │ ✅ Valid  │ 47         │ │
│ │ 2  │ Paste text from clipboard   │ 🔄 Draft  │ —          │ │
│ │ 3  │ Open URL via address bar    │ 📝 Corr.  │ 112        │ │
│ │ 4  │ Tab close with beforeunload │ ✅ Valid  │ 83         │ │
│ │ ...│                             │          │            │ │
│ └────┴─────────────────────────────┴──────────┴────────────┘ │
│                                                              │
│ [+ Discover more scenarios]  [+ Create custom scenario]      │
└──────────────────────────────────────────────────────────────┘
```

#### View 2: Call Graph (Interactive)

Uses **Cytoscape.js** for graph rendering with:
- Nodes = functions (colored by module/namespace)
- Edges = calls (directed)
- Branch nodes shown as diamonds
- Virtual dispatch shown as dashed edges with labels
- Click a node to see source code
- Hover to see AI justification

```
┌──────────────────────────────────────────────────────────────┐
│ Scenario: Drop file onto tab                    [← Back]    │
├────────────────────────────────┬─────────────────────────────┤
│                                │ 📄 Source: drop_handler.cc  │
│    ┌──────────────┐            │                             │
│    │ OnDragEntered │           │ 230│ void HandleFileDrop(   │
│    └──────┬───────┘            │ 231│   const DropData& d) { │
│           │                    │ 232│   if (d.file_count > 0)│
│    ┌──────▼───────┐            │ 233│  ▶  HandleFiles(d);    │
│    │HandleFileDrop│            │ 234│   else                 │
│    └──────┬───────┘            │ 235│     HandleOther(d);    │
│           │                    │ 236│ }                      │
│     ◆ file_count>0             │                             │
│    ╱ TRUE    ╲ FALSE           │ ┌───────────────────────────┤
│   ╱           ╲                │ │ 🤖 AI Justification      │
│ ┌▼──────┐  ┌───▼────┐         │ │ Branch TRUE: file_count=1 │
│ │Handle │  │Handle  │         │ │ because user dropped a    │
│ │Files  │  │Other   │         │ │ file (scenario premise).  │
│ └───┬───┘  └────────┘         │ │                           │
│     │                          │ │ Variables:                │
│ ┌───▼────────┐                 │ │ • d.file_count = 1       │
│ │ValidateDrop│                 │ │ • d.filenames = ["x.pdf"]│
│ └────────────┘                 │ └───────────────────────────┤
│                                │ 💬 Correction chat          │
│ [Zoom] [Fit] [Filter]         │ [Type correction here... ]  │
└────────────────────────────────┴─────────────────────────────┘
```

#### View 3: Step-by-Step Walkthrough

```
┌──────────────────────────────────────────────────────────────┐
│ Walkthrough: Drop file onto tab          Step 12 / 47       │
│ [◀ Prev] [▶ Next] [⏸ Pause] [⏭ Jump to step...]           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ 📍 Function: content::DropHandler::HandleFileDrop            │
│ 📁 File: src/content/browser/web_contents/drop_handler.cc   │
│ 📞 Called from: WebContentsViewAura::OnDragEntered (step 11) │
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 230  void HandleFileDrop(const DropData& data) {        │ │
│ │ 231    int count = data.file_count;                      │ │
│ │ 232    // AI: count = 1 (user dropped one file)         │ │
│ │ 233 ▶  if (count > 0) {            ← BRANCH: TRUE      │ │
│ │ 234      HandleFiles(data);         ← NEXT STEP (13)    │ │
│ │ 235    } else {                     ← SKIPPED           │ │
│ │ 236      HandleTextDrop(data);                          │ │
│ │ 237    }                                                │ │
│ │ 238  }                                                  │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─ Variable State ──────────────────────────────────────────┐│
│ │ data.file_count     = 1          (imagined by AI)        ││
│ │ data.filenames      = ["x.pdf"]  (imagined by AI)        ││
│ │ data.mime_type      = "application/pdf" (imagined)       ││
│ │ count               = 1          (assigned line 231)     ││
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─ Justification ──────────────────────────────────────────┐ │
│ │ 🤖 Taking TRUE branch (line 233)                        │ │
│ │                                                          │ │
│ │ Reasoning: In the "drop file" scenario, the user        │ │
│ │ dragged a file from their desktop. The OS creates a     │ │
│ │ DropData with file_count = number of dragged files.     │ │
│ │ Since at least one file was dropped, count > 0 is true. │ │
│ │                                                          │ │
│ │ Assumptions:                                             │ │
│ │ • User dropped exactly 1 file (simplest case)           │ │
│ │ • File is a regular file (not directory/symlink)         │ │
│ │                                                          │ │
│ │ Confidence: 0.95                                        │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ 💬 [Type a correction or question...                    📤] │
└──────────────────────────────────────────────────────────────┘
```

### 8.2 UI Technology

| Component | Technology | Rationale |
|---|---|---|
| Framework | React 18 + TypeScript | Standard, large ecosystem |
| Graph rendering | Cytoscape.js | Best for interactive code graphs, supports large graphs |
| Code display | Monaco Editor (read-only) | Same engine as VS Code, syntax highlighting |
| State management | Zustand | Lightweight, TypeScript-native |
| Styling | Tailwind CSS | Rapid development |
| Chat interface | Custom React component | Correction chat |
| API communication | Apollo Client (GraphQL) | Typed queries matching server schema |
| Build | Vite | Fast dev server |

---

## 9. API Server Design

### 9.1 GraphQL Schema (Key Types)

```graphql
type Query {
  # Scenarios
  scenarios(filter: ScenarioFilter): [Scenario!]!
  scenario(id: ID!): Scenario
  scenarioSteps(scenarioId: ID!, from: Int, to: Int): [ScenarioStep!]!

  # Code structure
  function(id: ID!): Function
  functionCallers(id: ID!): [Function!]!
  functionCallees(id: ID!): [Function!]!
  implementations(interfaceMethod: ID!): [Function!]!
  classHierarchy(classId: ID!): ClassHierarchy!

  # Search
  searchFunctions(query: String!, limit: Int): [Function!]!
  searchScenarios(query: String!, limit: Int): [Scenario!]!

  # Corrections
  corrections(scenarioId: ID, scope: CorrectionScope): [Correction!]!
}

type Mutation {
  # Indexing
  indexCodebase(rootDir: String!, config: IndexConfig): IndexJob!
  reindexFile(filePath: String!): IndexResult!

  # Scenarios
  discoverScenarios(hint: String, count: Int): [Scenario!]!
  createScenario(input: CreateScenarioInput!): Scenario!
  traceScenario(scenarioId: ID!): TraceResult!

  # Corrections
  submitCorrection(input: CorrectionInput!): CorrectionResult!
  undoCorrection(correctionId: ID!): CorrectionResult!

  # Walkthrough
  retraceFromStep(scenarioId: ID!, stepNumber: Int!): TraceResult!
}

type Subscription {
  # Live updates during indexing / tracing
  indexProgress(jobId: ID!): IndexProgress!
  traceProgress(scenarioId: ID!): TraceProgress!
}

input CorrectionInput {
  scenarioId: ID!
  stepNumber: Int
  message: String!           # natural language correction
  type: CorrectionType       # optional, AI infers if not provided
}

type CorrectionResult {
  correction: Correction!
  affectedSteps: [ScenarioStep!]!
  retraceTriggered: Boolean!
}
```

### 9.2 REST Endpoints (for CLI / simpler integrations)

```
POST   /api/index                    # Start indexing
GET    /api/index/:jobId/status      # Indexing progress
GET    /api/scenarios                 # List scenarios
POST   /api/scenarios/discover       # AI discover scenarios
GET    /api/scenarios/:id            # Get scenario detail
POST   /api/scenarios/:id/trace      # Trace a scenario
GET    /api/scenarios/:id/steps      # Get walkthrough steps
POST   /api/corrections              # Submit correction
GET    /api/functions/search?q=      # Search functions
GET    /api/functions/:id/callers    # Who calls this function
GET    /api/functions/:id/callees    # What does this function call
GET    /api/graph/:scenarioId        # Graph data for visualization
```

---

## 10. VS Code Extension

### 10.1 Features

| Feature | Description |
|---|---|
| **CodeLens: "N scenarios"** | Above each function, shows how many scenarios include it. Click to see list. |
| **CodeLens: "View call graph"** | Opens the graph view centered on this function |
| **Gutter decorations** | In walkthrough mode, highlights which lines are executed, branch decisions |
| **Inline variable state** | Shows AI-imagined variable values as inline decorations |
| **Correction via command palette** | `CodeGraph: Submit Correction` opens chat panel |
| **Tree view: Scenarios** | Sidebar panel listing all scenarios with status |
| **Go to step** | From scenario list, jump to the exact file:line of any step |

### 10.2 Extension Architecture

```typescript
// Extension activates when workspace has .codegraph config or user runs command
export function activate(context: vscode.ExtensionContext) {
  const client = new CodeGraphClient(config.serverUrl);

  // Register CodeLens provider
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: "file" },
      new ScenarioCodeLensProvider(client)
    )
  );

  // Register tree view
  const scenarioTreeProvider = new ScenarioTreeProvider(client);
  vscode.window.createTreeView("codegraph.scenarios", {
    treeDataProvider: scenarioTreeProvider,
  });

  // Register walkthrough decoration provider
  const walkthroughProvider = new WalkthroughDecorationProvider(client);

  // Register commands
  vscode.commands.registerCommand("codegraph.submitCorrection", async () => {
    const panel = vscode.window.createWebviewPanel(/*...*/);
    // Opens chat panel for corrections
  });
}
```

---

## 11. CLI Design

### 11.1 Commands

```bash
# Initialize a project
codegraph init --lang cpp --neo4j bolt://localhost:7687

# Index the codebase
codegraph index ./src --compile-commands ./out/Default/compile_commands.json
codegraph index ./src --incremental   # only changed files

# Discover scenarios
codegraph discover --hint "file drag and drop" --count 5
codegraph discover --entry-point "WebContentsViewAura::OnDragEntered"

# List scenarios
codegraph scenarios list
codegraph scenarios list --status validated

# Trace a scenario
codegraph trace "drop-file-in-tab"
codegraph trace "drop-file-in-tab" --max-depth 30

# Walk through a scenario (interactive REPL)
codegraph walk "drop-file-in-tab"
# Inside walkthrough:
#   n/next     - next step
#   p/prev     - previous step
#   j 25       - jump to step 25
#   vars       - show variable state
#   why        - show justification for current step
#   correct    - enter correction mode
#   graph      - show call graph at current point
#   q/quit     - exit

# Submit corrections
codegraph correct "drop-file-in-tab" --step 12 \
  --message "file_count is 0 for directories"

# Query the graph
codegraph query callers "content::DropHandler::HandleFileDrop"
codegraph query callees "content::DropHandler::HandleFileDrop"
codegraph query path --from "main" --to "HandleFileDrop"

# Export
codegraph export "drop-file-in-tab" --format json
codegraph export "drop-file-in-tab" --format markdown
codegraph export "drop-file-in-tab" --format dot  # Graphviz

# Server
codegraph serve --port 3000   # starts API server + Web UI
```

### 11.2 Configuration File (`.codegraph.yaml`)

```yaml
# .codegraph.yaml — project root
project:
  name: "chromium"
  languages: ["cpp", "c"]
  rootDirs:
    - src/content
    - src/chrome/browser
  excludeDirs:
    - third_party
    - out
    - build

neo4j:
  uri: "bolt://localhost:7687"
  username: "neo4j"
  password: "${CODEGRAPH_NEO4J_PASSWORD}"  # env var
  database: "chromium"

parser:
  cpp:
    compileCommands: "out/Default/compile_commands.json"
    clangdPath: "/usr/bin/clangd"
  typescript:
    tsconfig: "tsconfig.json"

ai:
  provider: "openai"                  # or "copilot", "anthropic"
  model: "gpt-4-turbo"
  apiKey: "${CODEGRAPH_AI_API_KEY}"
  maxTokensPerRequest: 120000
  temperature: 0.2                     # low for deterministic analysis

tracing:
  maxDepth: 50
  maxStepsPerFunction: 200
  boringFunctions:
    - "LOG*"
    - "DCHECK*"
    - "base::*Ref*"
    - "std::*"
  boringNamespaces:
    - "base::internal"
    - "testing"

server:
  port: 3000
  host: "0.0.0.0"
```

---

## 12. Installation & Setup

### 12.1 Prerequisites

| Dependency | Version | Purpose |
|---|---|---|
| Node.js | 20+ | Runtime |
| Neo4j | 5.x | Graph database |
| clangd | 15+ | C/C++ language server (for C++ projects) |
| Python | 3.10+ | Some parser tooling (tree-sitter bindings) |

### 12.2 Install Steps

```bash
# 1. Install Neo4j (Docker recommended)
docker run -d \
  --name codegraph-neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/codegraph123 \
  -e NEO4J_PLUGINS='["apoc"]' \
  -v codegraph-data:/data \
  neo4j:5

# 2. Install CodeGraph
npm install -g @codegraph/cli

# 3. Verify
codegraph --version
codegraph doctor   # checks Neo4j connection, clangd, etc.
```

### 12.3 Setup with Chromium

```bash
# 1. Clone Chromium (if not already)
# See https://chromium.googlesource.com/chromium/src/+/main/docs/linux/build_instructions.md

# 2. Generate compile_commands.json
cd chromium/src
gn gen out/Default --export-compile-commands

# 3. Initialize CodeGraph
cd chromium/src
codegraph init --lang cpp \
  --neo4j bolt://localhost:7687 \
  --compile-commands out/Default/compile_commands.json

# 4. Index (selective — full Chromium is huge)
# Start with a specific subsystem:
codegraph index src/content/browser/web_contents \
  --include-deps    # also index headers/dependencies

# Or index specific files:
codegraph index \
  src/content/browser/web_contents/web_contents_view_aura.cc \
  src/content/browser/web_contents/web_contents_impl.cc

# 5. Check indexing results
codegraph stats
# Output:
#   Files indexed: 247
#   Functions: 3,421
#   Classes: 189
#   Call edges: 12,847
#   Branches: 8,932

# 6. Discover scenarios
codegraph discover --hint "drag and drop files"
# Output:
#   Found 4 scenarios:
#   1. [drop-file-in-tab] User drops a file onto a browser tab
#   2. [drop-text-in-input] User drops text into an input field
#   3. [drag-tab-to-window] User drags a tab to create new window
#   4. [drop-url-in-omnibox] User drops a URL into the address bar

# 7. Trace a scenario
codegraph trace "drop-file-in-tab"
# Output:
#   Tracing scenario "drop-file-in-tab"...
#   Entry: WebContentsViewAura::OnDragEntered
#   ✓ Traced 47 steps across 12 functions
#   ✓ 8 branch decisions (7 AI, 1 obvious)
#   ✓ 2 virtual dispatches resolved

# 8. Start walkthrough
codegraph walk "drop-file-in-tab"

# 9. Start Web UI
codegraph serve --port 3000
# Open http://localhost:3000
```

---

## 13. Testing Strategy

### 13.1 Test Pyramid

```
         ┌───────────┐
         │   E2E     │  ← 10 tests: Full workflow with real Neo4j + small codebase
         │  Tests    │
         ├───────────┤
         │Integration│  ← 50 tests: Parser + Neo4j, AI + Neo4j, API endpoints
         │  Tests    │
         ├───────────┤
         │  Unit     │  ← 200+ tests: Parsers, graph queries, correction logic
         │  Tests    │
         └───────────┘
```

### 13.2 Unit Tests

```typescript
// Parser tests — test against fixture files
describe("ClangParser", () => {
  it("extracts functions from a C++ file", async () => {
    const result = await parser.parseFile("fixtures/simple.cc");
    expect(result.functions).toContainEqual(
      expect.objectContaining({
        name: "HandleFileDrop",
        qualifiedName: "DropHandler::HandleFileDrop",
        isVirtual: false,
      })
    );
  });

  it("detects virtual function calls", async () => {
    const result = await parser.parseFile("fixtures/virtual_dispatch.cc");
    const call = result.calls.find(c => c.callee === "OnDragEntered");
    expect(call?.isVirtualDispatch).toBe(true);
  });

  it("extracts branch conditions", async () => {
    const result = await parser.parseFile("fixtures/branches.cc");
    expect(result.branches).toContainEqual(
      expect.objectContaining({
        type: "if",
        condition: "count > 0",
        line: 15,
      })
    );
  });
});

// Correction tests
describe("CorrectionEngine", () => {
  it("parses variable constraint from natural language", async () => {
    const correction = await engine.interpret({
      userMessage: "file_count can never be 0 in this scenario",
      currentContext: { scenario: mockScenario, currentStep: mockStep },
    });
    expect(correction.type).toBe("variable_constraint");
    expect(correction.rule).toBe("file_count != 0");
  });

  it("cascades correction to downstream steps", async () => {
    const result = await engine.apply(correction);
    expect(result.affectedSteps.length).toBeGreaterThan(0);
    expect(result.retraceTriggered).toBe(true);
  });
});

// Graph query tests
describe("QueryEngine", () => {
  it("finds all callers of a function", async () => {
    const callers = await queryEngine.callers("DropHandler::HandleFileDrop");
    expect(callers).toContainEqual(
      expect.objectContaining({
        qualifiedName: "WebContentsViewAura::OnDragEntered",
      })
    );
  });
});
```

### 13.3 Integration Tests

```typescript
// Full parse → store → query cycle
describe("Parse-Store-Query integration", () => {
  let neo4j: Neo4jDriver;

  beforeAll(async () => {
    neo4j = await connectNeo4j("bolt://localhost:7687", "test-db");
    await neo4j.clearDatabase();
  });

  it("indexes a small C++ project and queries call graph", async () => {
    // 1. Index
    await indexer.index("fixtures/small-project/", { neo4j });

    // 2. Query
    const callers = await query(neo4j, `
      MATCH (caller:Function)-[:CALLS]->(callee:Function {name: "ProcessDrop"})
      RETURN caller.qualifiedName
    `);
    expect(callers).toContain("DropHandler::HandleFileDrop");
  });
});

// AI agent integration (uses recorded fixtures / mock LLM in CI)
describe("AI Agent integration", () => {
  it("discovers scenarios from entry points", async () => {
    const scenarios = await scenarioAgent.discover({
      entryPoints: mockEntryPoints,
      userHint: "drag and drop",
    });
    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios[0]).toHaveProperty("entryFunction");
  });
});
```

### 13.4 E2E Tests

```typescript
describe("E2E: Full workflow", () => {
  it("indexes, discovers, traces, corrects, and re-traces", async () => {
    // 1. Index fixture project
    await cli("index fixtures/e2e-project/");

    // 2. Discover scenarios
    const scenarios = await cli("discover --hint 'process input'");
    expect(scenarios).toContain("process-user-input");

    // 3. Trace
    await cli("trace process-user-input");
    const steps = await cli("scenarios steps process-user-input");
    expect(steps.length).toBeGreaterThan(5);

    // 4. Correct
    await cli("correct process-user-input --step 3 " +
              "--message 'input is always non-empty'");

    // 5. Verify correction cascaded
    const updatedSteps = await cli("scenarios steps process-user-input");
    expect(updatedSteps).not.toEqual(steps);
  });
});
```

### 13.5 Test Fixtures

```
test/
├── fixtures/
│   ├── simple.cc                    # single file, basic functions
│   ├── virtual_dispatch.cc          # class hierarchy with virtual methods
│   ├── branches.cc                  # if/else, switch, ternary
│   ├── small-project/               # multi-file project
│   │   ├── main.cc
│   │   ├── handler.cc / .h
│   │   ├── processor.cc / .h
│   │   └── compile_commands.json
│   ├── e2e-project/                 # realistic small project for E2E
│   │   ├── src/
│   │   ├── include/
│   │   └── compile_commands.json
│   └── ai-responses/                # recorded AI responses for deterministic tests
│       ├── scenario-discovery.json
│       ├── path-trace-step-1.json
│       └── variable-imagination.json
├── unit/
│   ├── parser.test.ts
│   ├── correction.test.ts
│   ├── query.test.ts
│   └── graph-updater.test.ts
├── integration/
│   ├── parse-store-query.test.ts
│   ├── ai-agent.test.ts
│   └── api-server.test.ts
└── e2e/
    └── full-workflow.test.ts
```

### 13.6 Running Tests

```bash
# Unit tests (no external dependencies)
npm test

# Integration tests (requires Neo4j running)
npm run test:integration

# E2E tests (requires Neo4j + clangd)
npm run test:e2e

# All tests with coverage
npm run test:coverage

# Test with recorded AI responses (no API key needed)
CODEGRAPH_AI_MOCK=true npm test
```

---

## 14. Project Structure

```
code-graph/
├── packages/
│   ├── core/                        # Core engine
│   │   ├── src/
│   │   │   ├── parser/
│   │   │   │   ├── interface.ts     # ICodeParser interface
│   │   │   │   ├── clang.ts         # C/C++ parser (clangd + libclang)
│   │   │   │   ├── typescript.ts    # TypeScript parser (ts-morph)
│   │   │   │   └── treesitter.ts    # Fallback parser
│   │   │   ├── graph/
│   │   │   │   ├── driver.ts        # Neo4j driver wrapper
│   │   │   │   ├── schema.ts        # Graph schema (Cypher migrations)
│   │   │   │   ├── indexer.ts       # Code → graph writer
│   │   │   │   └── queries.ts       # Reusable Cypher queries
│   │   │   ├── ai/
│   │   │   │   ├── agent.ts         # Base agent class
│   │   │   │   ├── scenario-discovery.ts
│   │   │   │   ├── path-tracer.ts
│   │   │   │   ├── variable-imaginer.ts
│   │   │   │   ├── justifier.ts
│   │   │   │   └── correction-interpreter.ts
│   │   │   ├── scenario/
│   │   │   │   ├── engine.ts        # Scenario lifecycle
│   │   │   │   ├── tracer.ts        # Step-by-step tracer
│   │   │   │   └── versioning.ts    # Scenario version management
│   │   │   ├── correction/
│   │   │   │   ├── engine.ts        # Correction processing
│   │   │   │   ├── cascader.ts      # Downstream re-tracing
│   │   │   │   └── rules.ts         # Rule storage and matching
│   │   │   └── config.ts            # Configuration loader
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── server/                      # API server
│   │   ├── src/
│   │   │   ├── graphql/
│   │   │   │   ├── schema.graphql
│   │   │   │   ├── resolvers/
│   │   │   │   └── types.ts
│   │   │   ├── rest/
│   │   │   │   └── routes.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── web/                         # Web UI
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── ScenarioList.tsx
│   │   │   │   ├── CallGraph.tsx    # Cytoscape.js graph
│   │   │   │   ├── Walkthrough.tsx  # Step-by-step view
│   │   │   │   ├── CodeViewer.tsx   # Monaco-based code display
│   │   │   │   ├── CorrectionChat.tsx
│   │   │   │   └── JustificationPanel.tsx
│   │   │   ├── stores/
│   │   │   │   ├── scenario.ts      # Zustand store
│   │   │   │   └── graph.ts
│   │   │   └── App.tsx
│   │   ├── package.json
│   │   └── vite.config.ts
│   │
│   ├── cli/                         # CLI tool
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   │   ├── init.ts
│   │   │   │   ├── index.ts
│   │   │   │   ├── discover.ts
│   │   │   │   ├── trace.ts
│   │   │   │   ├── walk.ts          # Interactive REPL
│   │   │   │   ├── correct.ts
│   │   │   │   ├── query.ts
│   │   │   │   ├── serve.ts
│   │   │   │   └── doctor.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── vscode-extension/            # VS Code extension
│       ├── src/
│       │   ├── extension.ts
│       │   ├── providers/
│       │   │   ├── codelens.ts
│       │   │   ├── decorations.ts
│       │   │   └── treeview.ts
│       │   └── client.ts            # API client
│       ├── package.json
│       └── tsconfig.json
│
├── test/                            # Test suites (see §13.5)
├── docs/
│   └── next/
│       └── design.md                # This document
├── .codegraph.yaml.example
├── package.json                     # Monorepo root (npm workspaces)
├── tsconfig.base.json
└── README.md
```

---

## 15. Key Design Decisions & Trade-offs

### 15.1 Why Neo4j (not PostgreSQL, SQLite, etc.)

| Criterion | Neo4j | PostgreSQL | SQLite |
|---|---|---|---|
| Traverse call chains (N hops) | ✅ O(1) per hop via pointer chasing | ❌ Recursive CTEs, slow at depth | ❌ Same |
| "Find all paths from A to B" | ✅ `shortestPath()`, `allShortestPaths()` | ❌ Complex queries | ❌ |
| Schema flexibility (add edge types) | ✅ Schemaless | ❌ ALTER TABLE | ❌ |
| Variable-length path queries | ✅ `(a)-[:CALLS*1..10]->(b)` | ❌ | ❌ |
| Visualization integration | ✅ Native graph format → Cytoscape | ❌ Requires transform | ❌ |
| Horizontal scale | ⚠️ Single instance sufficient for most codebases | ✅ | ❌ |

**Decision**: Neo4j is the right tool for graph traversal queries that are the core of this tool. For metadata/config, we use a small SQLite sidecar.

### 15.2 Why LangChain.js (not raw OpenAI SDK)

- **Tool calling**: Agents need to call graph queries, read files, invoke parsers
- **Chain composition**: Scenario discovery → path tracing → variable imagination is a pipeline
- **Streaming**: Walkthrough justifications should stream to UI
- **Provider abstraction**: Switch between OpenAI, Anthropic, local models

### 15.3 Why Cytoscape.js (not D3.js, vis.js)

- Built for graph/network visualization specifically
- Handles 10,000+ nodes with WebGL renderer (`cytoscape-webgl`)
- Built-in layout algorithms (hierarchical, COSE for force-directed)
- Excellent event handling for interactive exploration
- Extensions for edge bundling, context menus, undo/redo

### 15.4 Incremental vs Full Re-index

Full Chromium indexing would take hours. Our strategy:
1. **First index**: User specifies subdirectories (`codegraph index src/content/browser/`)
2. **Dependency tracking**: When a file includes a header, we index the header too (with `--include-deps`)
3. **Incremental**: On re-index, only files with changed content hashes are re-parsed
4. **On-demand**: During tracing, if AI encounters a function in an un-indexed file, we index that file on the fly

---

## 16. Performance Considerations

### 16.1 Chromium Scale Estimates

| Metric | Subset (content/) | Full Chromium |
|---|---|---|
| Files | ~5,000 | ~100,000 |
| Functions (nodes) | ~50,000 | ~2,000,000 |
| Call edges | ~200,000 | ~10,000,000 |
| Initial index time | ~10 min | ~4 hours |
| Incremental re-index | ~seconds | ~minutes |
| Neo4j disk | ~500 MB | ~20 GB |
| Scenario trace (50 steps) | ~2 min (AI bound) | ~2 min (AI bound) |

### 16.2 Optimization Strategies

1. **Parallel parsing**: Parse files in parallel (worker threads), batch Neo4j writes
2. **LSP connection pooling**: Maintain persistent clangd connection, reuse across files
3. **AI response caching**: Cache AI responses for identical (function + context) pairs
4. **Graph query optimization**: Create Neo4j indexes on `qualifiedName`, `filePath`, `id`
5. **Lazy loading in UI**: Load graph data on demand as user explores (not full graph upfront)

### 16.3 Required Neo4j Indexes

```cypher
CREATE INDEX function_name FOR (f:Function) ON (f.qualifiedName);
CREATE INDEX function_file FOR (f:Function) ON (f.filePath);
CREATE INDEX file_path FOR (f:File) ON (f.path);
CREATE INDEX scenario_id FOR (s:Scenario) ON (s.id);
CREATE INDEX scenario_status FOR (s:Scenario) ON (s.status);
CREATE INDEX step_scenario FOR (s:ScenarioStep) ON (s.id);
CREATE INDEX class_name FOR (c:Class) ON (c.qualifiedName);
CREATE INDEX correction_type FOR (c:Correction) ON (c.type);
```

---

## 17. Security & Privacy

- **No code leaves the machine** by default. AI calls can be configured to use local models (Ollama, llama.cpp)
- **API keys** stored in environment variables, never in config files
- **Neo4j authentication** required in production mode
- **Server** binds to localhost by default; `--host 0.0.0.0` requires explicit opt-in
- **Corrections** are attributed to a userId for audit

---

## 18. Future Extensions

1. **Multi-language tracing**: Follow a call from C++ into JavaScript (via Chromium's Mojo IPC)
2. **Diff-aware scenarios**: "What changed in scenario X between commits A and B?"
3. **Team sharing**: Export/import scenarios and corrections
4. **CI integration**: "Does this PR change any validated scenario?"
5. **Live debugging integration**: Connect to a running process and verify AI predictions against actual runtime values
6. **Natural language queries**: "Show me what happens when the user types a URL and presses Enter"

---

## 19. Glossary

| Term | Definition |
|---|---|
| **Scenario** | A named, traced execution path through the code (e.g., "user drops file") |
| **Step** | One action in a scenario: a call, branch decision, dispatch, or assignment |
| **Justification** | AI-generated explanation of why a branch or dispatch decision was made |
| **Correction** | A human override of an AI decision, stored persistently |
| **Virtual dispatch** | A call through a base class pointer where the concrete implementation depends on runtime type |
| **Boring function** | A function excluded from tracing (e.g., logging, assertions) |
| **Imagined variable** | A variable whose value is invented by AI to match the scenario |
| **Cascade** | When a correction at step N triggers re-tracing of steps N+1 through end |

---

## 20. Summary

CodeGraph transforms code understanding from a manual, ephemeral process into a persistent, shareable, AI-assisted graph exploration. By combining static analysis (parsers, LSP) with AI reasoning (scenario discovery, variable imagination, justification) and human oversight (corrections), it creates a living map of how code actually executes in real-world scenarios.

The key differentiators are:
1. **Graph-native**: Call paths are first-class graph structures, not flat text
2. **AI + Human loop**: AI does the heavy lifting, humans correct mistakes
3. **Justification-first**: Every decision is explained, building trust
4. **Persistent**: Scenarios and corrections survive across sessions
5. **Visual**: See the forest (graph) and the trees (line-by-line walkthrough)
