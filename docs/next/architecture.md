# Architecture Deep Dive

This document describes the internal architecture of CodeGraph — how data flows through the system, how the graph database is structured, and how the AI agents collaborate.

---

## System Architecture

CodeGraph is organized as an npm workspace monorepo with four packages:

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
│                 │  API Server  │  ← Express + Apollo Server         │
│                 │  GraphQL     │    /graphql (Apollo)                │
│                 │  REST        │    /api (Express Router)            │
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
│                 │   Core       │  ← @codegraph/core                 │
│                 │   Engine     │                                    │
│                 └──────┬───────┘                                    │
│                        │                                            │
│       ┌────────────────┼────────────────┐                           │
│       │                │                │                           │
│  ┌────▼─────┐   ┌──────▼──────┐   ┌────▼──────┐                   │
│  │ Parser   │   │   AI Agent  │   │  Neo4j    │                   │
│  │ Layer    │   │   Layer     │   │  Driver   │                   │
│  │          │   │ (5 agents)  │   │           │                   │
│  └────┬─────┘   └─────────────┘   └────┬──────┘                   │
│       │                                 │                           │
│  ┌────▼─────┐                    ┌──────▼──────┐                   │
│  │ ts-morph │                    │   Neo4j 5   │                   │
│  │ clangd   │                    │   Database  │                   │
│  │ tree-sit │                    │             │                   │
│  └──────────┘                    └─────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Package Dependency Graph

```
@codegraph/cli ──────────┐
@codegraph/server ───────┤──▶ @codegraph/core
@codegraph/web ──(API)───┘         │
                                   ├──▶ ts-morph (TypeScript parsing)
                                   ├──▶ neo4j-driver (graph database)
                                   ├──▶ openai (AI API)
                                   ├──▶ zod (config validation)
                                   └──▶ winston (logging)
```

---

## Data Flow Diagrams

### Indexing Flow

```
  Source Files (.ts, .cpp, .c)
        │
        ▼
  ┌─────────────────┐
  │  Parser Layer    │   TypeScriptParser (ts-morph)
  │                  │   ClangParser (clangd + libclang)
  │  parseFile()     │   TreeSitterParser (fallback)
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  ParseResult     │   { functions, classes, calls, branches,
  │                  │     variables, inheritances }
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  CodeIndexer     │   Transforms ParseResult into Cypher
  │                  │   CREATE/MERGE statements
  │  index()         │   Handles incremental updates via
  │                  │   content hashing on :File nodes
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  Neo4j           │   :File, :Function, :Class, :Branch,
  │  Graph DB        │   :Variable nodes + relationship edges
  └─────────────────┘
```

### Scenario Discovery Flow

```
  User runs: codegraph discover --hint "file drag and drop"
        │
        ▼
  ┌─────────────────────┐
  │  QueryEngine         │   Searches graph for entry points,
  │                      │   event handlers, public APIs
  │  searchFunctions()   │
  └──────────┬──────────┘
             │ function summaries
             ▼
  ┌─────────────────────┐
  │  ScenarioDiscovery   │   AI agent with prompt:
  │  Agent               │   "Given these entry points, identify
  │                      │    realistic user-facing scenarios"
  │  discover()          │
  └──────────┬──────────┘
             │ DiscoveredScenario[]
             ▼
  ┌─────────────────────┐
  │  ScenarioEngine      │   Creates :Scenario nodes in Neo4j
  │                      │   with status = "draft"
  │  createScenario()    │
  └──────────┬──────────┘
             │
             ▼
  ┌─────────────────────┐
  │  PathTracerAgent     │   Iterates line-by-line through the
  │                      │   entry function:
  │  trace()             │   - Function call → resolve, recurse
  │                      │   - Branch → AI evaluates condition
  │  Uses:               │   - Virtual dispatch → AI selects impl
  │  VariableImaginer    │   - Variable → AI imagines value
  │  JustifierAgent      │
  └──────────┬──────────┘
             │ ScenarioStep[]
             ▼
  ┌─────────────────────┐
  │  Neo4j               │   :ScenarioStep nodes linked by
  │                      │   :NEXT, :EXECUTES, :TAKES_BRANCH,
  │                      │   :DISPATCHES_TO relationships
  └─────────────────────┘
```

### Correction Flow

```
  User: "file_count is 0 for directories"
        │
        ▼
  ┌──────────────────────┐
  │  CorrectionInterpreter│  AI parses natural language into
  │  Agent                │  StructuredCorrection:
  │                       │  { type: "variable_constraint",
  │  interpret()          │    rule: "file_count == 0",
  │                       │    scope: "scenario" }
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐
  │  CorrectionValidator  │  Validates against graph schema:
  │                       │  Does this variable exist?
  │  validate()           │  Is the scenario/step valid?
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐
  │  GraphUpdater         │  Writes :Correction node to Neo4j
  │                       │  Links via :APPLIES_TO to target
  │  apply()              │  Updates :ScenarioStep fields
  └──────────┬───────────┘
             │
             ▼
  ┌──────────────────────┐
  │  Cascading Re-tracer  │  Re-traces all steps downstream
  │                       │  from the correction point
  │  retrace()            │  Returns affected step count
  └──────────────────────┘
```

---

## Neo4j Graph Schema

### Node Types

#### Code Structure Nodes

| Node Label | Key Properties | Description |
|---|---|---|
| `:File` | `path`, `language`, `lastParsed`, `hash` | A parsed source file |
| `:Function` | `id`, `name`, `qualifiedName`, `filePath`, `startLine`, `endLine`, `signature`, `isVirtual`, `isOverride`, `visibility`, `language` | A function or method |
| `:Class` | `name`, `qualifiedName`, `filePath`, `isAbstract` | A class or struct |
| `:Interface` | `name`, `qualifiedName`, `filePath` | A TypeScript/Java interface |
| `:Branch` | `id`, `type`, `condition`, `filePath`, `line` | An if/else/switch/ternary branch |
| `:Variable` | `name`, `type`, `scope`, `filePath`, `line` | A variable declaration |

#### Scenario Nodes

| Node Label | Key Properties | Description |
|---|---|---|
| `:Scenario` | `id`, `name`, `description`, `discoveredBy`, `confidence`, `status`, `createdAt` | A traced execution scenario |
| `:ScenarioStep` | `id`, `stepNumber`, `functionId`, `line`, `action`, `justification`, `variableState` | A single step in a scenario's execution path |
| `:Correction` | `id`, `type`, `prompt`, `rule`, `scope`, `appliedAt`, `userId` | A human correction applied to the graph |

### Relationship Types

#### Code Structure Relationships

```cypher
(:File)-[:CONTAINS]->(:Function)
(:File)-[:CONTAINS]->(:Class)
(:Function)-[:CALLS {line, column}]->(:Function)
(:Function)-[:HAS_BRANCH {line}]->(:Branch)
(:Function)-[:READS]->(:Variable)
(:Function)-[:WRITES]->(:Variable)
(:Class)-[:EXTENDS]->(:Class)
(:Class)-[:IMPLEMENTS]->(:Interface)
(:Function)-[:MEMBER_OF]->(:Class)
(:Function)-[:OVERRIDES]->(:Function)
(:Function)-[:VIRTUAL_DISPATCH {resolvedTo, aiSelected, justification}]->(:Function)
```

#### Scenario Relationships

```cypher
(:Scenario)-[:STARTS_AT]->(:Function)
(:Scenario)-[:HAS_STEP {order}]->(:ScenarioStep)
(:ScenarioStep)-[:EXECUTES]->(:Function)
(:ScenarioStep)-[:NEXT]->(:ScenarioStep)
(:ScenarioStep)-[:TAKES_BRANCH]->(:Branch)
(:ScenarioStep)-[:SKIPS_BRANCH]->(:Branch)
(:ScenarioStep)-[:DISPATCHES_TO]->(:Function)
```

#### Correction Relationships

```cypher
(:Correction)-[:APPLIES_TO]->(:ScenarioStep | :Function | :Variable | :Scenario)
(:Correction)-[:SUPERSEDES]->(:Correction)
```

### Example Cypher Queries

```cypher
-- Which scenarios call a specific function?
MATCH (s:Scenario)-[:HAS_STEP]->(:ScenarioStep)-[:EXECUTES]->(f:Function)
WHERE f.qualifiedName = "FileProcessingPipeline.handleFileDrop"
RETURN s.name, s.id

-- What is the call stack for a scenario at step N?
MATCH path = (s:Scenario {id: "handle-file-drop"})-[:HAS_STEP]->(step:ScenarioStep)
WHERE step.stepNumber <= 12
MATCH (step)-[:EXECUTES]->(f:Function)
RETURN step.stepNumber, f.qualifiedName, step.action, step.justification
ORDER BY step.stepNumber

-- Which branches are taken in a scenario?
MATCH (s:Scenario {id: "handle-file-drop"})-[:HAS_STEP]->(step:ScenarioStep)
MATCH (step)-[:TAKES_BRANCH]->(b:Branch)
RETURN b.condition, b.line, b.filePath, step.justification

-- Find the shortest call path between two functions
MATCH path = shortestPath(
  (a:Function {name: "handleUserFileDrop"})-[:CALLS*..10]->(b:Function {name: "resizeImage"})
)
RETURN [n IN nodes(path) | n.qualifiedName] AS callChain

-- Find all functions in a class hierarchy
MATCH (parent:Class {name: "IFileProcessor"})<-[:IMPLEMENTS]-(child:Class)
MATCH (child)<-[:MEMBER_OF]-(f:Function)
RETURN child.name, f.name, f.signature
```

---

## AI Agent Architecture

CodeGraph uses five specialized AI agents, each with a focused responsibility:

```
┌────────────────────────────────────────────────────────────────────┐
│                        AI Agent Layer                              │
│                                                                    │
│  ┌─────────────────────┐   ┌──────────────────────┐               │
│  │ ScenarioDiscovery   │   │ PathTracer           │               │
│  │ Agent               │   │ Agent                │               │
│  │                     │   │                      │               │
│  │ IN: entry points,   │   │ IN: scenario +       │               │
│  │     event handlers, │   │     entry function   │               │
│  │     user hint       │   │ OUT: ScenarioStep[]  │               │
│  │ OUT: Scenario[]     │   │                      │               │
│  └─────────────────────┘   │ Uses:                │               │
│                            │  ├─ VariableImaginer │               │
│                            │  └─ JustifierAgent   │               │
│  ┌─────────────────────┐   └──────────────────────┘               │
│  │ CorrectionInterp.  │                                          │
│  │ Agent               │   ┌──────────────────────┐               │
│  │                     │   │ VariableImaginer     │               │
│  │ IN: user message +  │   │ Agent                │               │
│  │     context         │   │                      │               │
│  │ OUT: Structured     │   │ IN: variable + code  │               │
│  │      Correction     │   │ OUT: concrete value  │               │
│  └─────────────────────┘   │     + justification  │               │
│                            └──────────────────────┘               │
│                                                                    │
│                            ┌──────────────────────┐               │
│                            │ Justifier            │               │
│                            │ Agent                │               │
│                            │                      │               │
│                            │ IN: decision context │               │
│                            │ OUT: human-readable  │               │
│                            │      explanation     │               │
│                            └──────────────────────┘               │
└────────────────────────────────────────────────────────────────────┘
```

### Agent Details

| Agent | Role | Input | Output |
|---|---|---|---|
| **ScenarioDiscoveryAgent** | Discover realistic usage scenarios from the codebase | Entry points, event handlers, public APIs, optional user hint | List of `DiscoveredScenario` objects with entry functions and descriptions |
| **PathTracerAgent** | Trace step-by-step execution paths for a scenario | Scenario context + entry function | Ordered list of `ScenarioStep` objects |
| **VariableImaginerAgent** | Imagine concrete variable values for a scenario context | Variable metadata, surrounding code, existing variable state | Concrete value, justification, alternatives, confidence |
| **JustifierAgent** | Explain branch decisions and dispatch resolutions | Decision type, condition/implementations, code snippet | Human-readable explanation, assumptions, confidence |
| **CorrectionInterpreterAgent** | Parse natural language corrections into structured form | User message + current context (scenario, step, function) | `StructuredCorrection` with type, target, rule, scope |

### Agent Chaining

During path tracing, agents collaborate in a pipeline:

```
PathTracerAgent iterates through source lines:
  │
  ├── Function call encountered
  │   └── Resolve target → recurse into callee
  │
  ├── Branch (if/else/switch) encountered
  │   ├── VariableImaginerAgent: imagine values for condition variables
  │   ├── PathTracerAgent: evaluate condition with imagined values
  │   └── JustifierAgent: explain why this branch is taken/skipped
  │
  ├── Virtual dispatch encountered
  │   ├── Parser provides list of implementations
  │   ├── PathTracerAgent: select most likely implementation
  │   └── JustifierAgent: explain the dispatch decision
  │
  └── Variable assignment encountered
      └── VariableImaginerAgent: update variable state
```

---

## Parser Layer Design

### Parser Interface

Every language parser implements `ICodeParser`:

```typescript
interface ICodeParser {
  languages: string[];
  parseFile(filePath: string): Promise<ParseResult>;
  resolveDispatch(callSite: CallSite, context: DispatchContext): Promise<DispatchResolution[]>;
  findImplementations(method: FunctionNode): Promise<FunctionNode[]>;
}

interface ParseResult {
  functions: FunctionNode[];
  classes: ClassNode[];
  calls: CallEdge[];
  branches: BranchNode[];
  variables: VariableNode[];
  inheritances: InheritanceEdge[];
}
```

### TypeScript Parser

Built on **ts-morph** (TypeScript Compiler API wrapper). Provides:
- Full type-resolved AST traversal
- Call expression resolution including through type narrowing
- Interface implementation lookup
- Control flow analysis (if/else, switch, ternary)

### C/C++ Parser

Uses **clangd** (LSP) + **libclang** (AST):

| Need | clangd (LSP) | libclang (AST) |
|---|---|---|
| Function definitions | ✅ `textDocument/definition` | ✅ cursor traversal |
| Find all callers | ✅ `textDocument/references` | ❌ single-TU only |
| Virtual dispatch | ✅ `textDocument/implementation` | ❌ |
| Branch conditions | ❌ | ✅ `IfStmt`, `SwitchStmt` |
| Macro expansion | ❌ | ✅ |

### Adding a New Language Parser

1. Create a new file `packages/core/src/parser/<language>.ts`
2. Implement `ICodeParser` — the `parseFile` method must return a `ParseResult`
3. Export it from `packages/core/src/index.ts`
4. Register the parser in the `CodeIndexer` for the new language identifier

The tree-sitter fallback parser (`TreeSitterParser`) provides syntactic-level parsing for languages without deep semantic parsers (Python, Java, Go, Rust). It extracts functions and call sites but cannot resolve types — the AI fills in gaps.

---

## Correction Engine Pipeline

```
                    User Message (natural language)
                              │
                              ▼
              ┌───────────────────────────────┐
              │  1. INTERPRET                  │
              │  CorrectionInterpreterAgent    │
              │                               │
              │  Parses: "file_count is 0"    │
              │  Into:                         │
              │    type: variable_constraint   │
              │    rule: file_count == 0       │
              │    scope: scenario             │
              └───────────┬───────────────────┘
                          │
                          ▼
              ┌───────────────────────────────┐
              │  2. VALIDATE                   │
              │  CorrectionValidator           │
              │                               │
              │  Checks:                       │
              │  - Does variable exist in      │
              │    the graph?                  │
              │  - Is the scenario/step valid? │
              │  - Is the rule well-formed?    │
              └───────────┬───────────────────┘
                          │
                          ▼
              ┌───────────────────────────────┐
              │  3. APPLY                      │
              │  GraphUpdater                  │
              │                               │
              │  - Create :Correction node     │
              │  - Link :APPLIES_TO target     │
              │  - Update :ScenarioStep fields │
              │  - Handle :SUPERSEDES chain    │
              └───────────┬───────────────────┘
                          │
                          ▼
              ┌───────────────────────────────┐
              │  4. CASCADE                    │
              │  Cascading Re-tracer           │
              │                               │
              │  - Re-trace all steps after    │
              │    the correction point        │
              │  - AI re-evaluates branches    │
              │    with updated variable state │
              │  - Returns count of changed    │
              │    steps                       │
              └───────────────────────────────┘
```

### Correction Types

| Type | Example User Prompt | Effect |
|---|---|---|
| `variable_constraint` | "file_count can never be 0 here" | Add constraint, re-evaluate branches |
| `branch_override` | "The else branch is taken" | Update step action, re-trace from this point |
| `dispatch_override` | "Use WebContentsViewWin, not Aura" | Update `:DISPATCHES_TO`, re-trace subtree |
| `scenario_note` | "This also handles directories" | Update scenario description, may re-trace |
| `function_skip` | "Ignore this — it's just logging" | Add to `boringFunctions`, remove steps |
| `function_include` | "Trace into ValidateDropData" | Remove from boring list, expand trace |
| `global_rule` | "BrowserThread::CurrentlyOn(UI) is always true" | Create global correction, apply everywhere |

---

## Token Budget Management

Large codebases produce large AI contexts. The token budget strategy ensures prompts stay within model limits:

```typescript
interface TokenBudget {
  maxContextTokens: number;       // default: 120,000 (GPT-4 Turbo)
  reserveForResponse: number;     // default: 4,000
  codeSnippetMaxLines: number;    // default: 50 lines per snippet
  maxFunctionsInContext: number;  // default: 20
}
```

**Strategy — only include relevant code in AI context:**

1. Current function source (full)
2. Caller function source (summarized to signature + key lines)
3. Type definitions for parameters
4. Previously imagined variable state
5. Relevant user corrections

Code snippets are truncated to `codeSnippetMaxLines`. If the total exceeds `maxContextTokens`, the system progressively summarizes caller context and drops the oldest variable state entries.

---

## Performance Considerations

| Concern | Strategy |
|---|---|
| Large codebase indexing | Incremental parsing via content hashing on `:File.hash` — only changed files are re-parsed |
| Neo4j write throughput | Batch Cypher transactions — one transaction per file with UNWIND for bulk node/edge creation |
| AI API latency | Parallel agent calls where independent; caching of variable imagination results within a scenario |
| Graph query performance | Neo4j indexes on `:Function(id)`, `:Function(qualifiedName)`, `:Scenario(id)`, `:File(path)` |
| Memory usage | Stream-based parsing — process one file at a time, write to Neo4j, release AST |
| Web UI rendering | Cytoscape.js with compound node grouping and level-of-detail rendering for large graphs |
