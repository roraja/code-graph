# Domain: Core Engine (@codegraph/core)

## Scope

The foundational package containing all core engines: parser, graph, AI, scenario, and correction. All other packages depend on this. Located in `packages/core/`.

## Architecture (Layered)

Each layer depends only on layers below it:

```
config/        ← Logger, config loader (Zod + YAML)
    ↑
parser/        ← ICodeParser interface, TypeScript parser (ts-morph), C++ parser (regex-based)
    ↑
graph/         ← GraphDriver (Neo4j), GraphSchema, CodeIndexer, QueryEngine
    ↑
ai/            ← AIProvider interface, OpenAI + Mock + CopilotCLI implementations, specialized agents
    ↑
scenario/      ← ScenarioEngine (CRUD), ScenarioTracer (step-by-step tracing)
    ↑
correction/    ← CorrectionEngine (natural-language → structured rules → re-trace)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Barrel exports — all public API |
| **Parser Layer** | |
| `src/parser/interface.ts` | `ICodeParser` contract + data types (`FunctionNode`, `ClassNode`, `CallEdge`, `BranchNode`, `VariableNode`, `InheritanceEdge`, `ParameterInfo`, `PropertyInfo`, `CallSite`, `DispatchContext`, `DispatchResolution`, `ParseResult`) |
| `src/parser/typescript.ts` | TypeScript parser using ts-morph — extracts functions (including constructors, accessors, arrow functions), classes, interfaces, calls, branches, variables, inheritance |
| `src/parser/typescript.test.ts` | Unit tests for the TypeScript parser (in-memory ts-morph projects) |
| `src/parser/cpp.ts` | C++ parser using regex-based extraction (not clangd) — extracts functions, classes, calls, branches, variables for Chromium-style C++ code. `CppParserConfig` for configuration. `resolveDispatch` and `findImplementations` are stubs returning empty arrays |
| **Graph Layer** | |
| `src/graph/driver.ts` | Neo4j connection wrapper (`GraphDriver`) — `connect()`, `disconnect()`, `run()`, `runInTransaction()`, `isConnected()`. Factory method `GraphDriver.create(config)`. `GraphDriverConfig` interface |
| `src/graph/driver.test.ts` | Unit tests for GraphDriver |
| `src/graph/schema.ts` | `GraphSchema` — creates indexes/constraints (`initialize()`), `clear()`, `getStats()`. `GraphStats` interface |
| `src/graph/indexer.ts` | `CodeIndexer` — `indexParseResult()`, `indexDirectory()`, `removeFile()`. Stores parse results into Neo4j using MERGE (idempotent upserts). Creates `:File`, `:Function`, `:Class`, `:Branch`, `:Variable` nodes and `:CONTAINS`, `:CALLS`, `:MEMBER_OF`, `:OVERRIDES`, `:EXTENDS`, `:IMPLEMENTS`, `:READS`, `:WRITES`, `:HAS_BRANCH` relationships |
| `src/graph/queries.ts` | `QueryEngine` — typed query methods: `getFunction()`, `getFunctionByName()`, `getCallers()`, `getCallees()`, `getCallChain()`, `getClassHierarchy()`, `getBranches()`, `getImplementations()`, `searchFunctions()`, `getScenario()`, `getScenarioSteps()`, `getScenariosForFunction()`, `getStats()`. Result types: `CallRelation`, `CallChainNode`, `ClassHierarchyEntry`, `ScenarioResult`, `ScenarioStepResult`, `DatabaseStats` |
| **AI Layer** | |
| `src/ai/agent.ts` | `AIProvider` interface with `chat(messages, options)`. `OpenAIProvider` (production), `MockAIProvider` (testing with canned responses, pattern rules, and smart defaults). `AIAgent` base class with `chat()` and `chatJSON()`. `createAIProvider(config)` factory supporting `'openai'`, `'mock'`, `'copilot'`. Types: `AIConfig`, `ChatMessage`, `ChatOptions`, `MockResponseRule` |
| `src/ai/agent.test.ts` | Unit tests for AI agent and providers |
| `src/ai/copilot-cli-provider.ts` | `CopilotCLIProvider` — AI provider that invokes GitHub Copilot CLI in single-shot mode (`copilot -p "..." --yolo --autopilot`). `CopilotCLIConfig` interface |
| `src/ai/scenario-discovery.ts` | `ScenarioDiscoveryAgent` — `discover(input)` finds realistic user-facing scenarios. Types: `FunctionSummary`, `ScenarioDiscoveryInput`, `DiscoveredScenario` |
| `src/ai/path-tracer.ts` | `PathTracerAgent` — `traceStep(input)` decides branch direction or dispatch target at a single decision point. Types: `ScenarioContext`, `PathTraceInput`, `PathTraceResult` |
| `src/ai/variable-imaginer.ts` | `VariableImaginerAgent` — `imagine(input)` infers realistic variable values. Types: `VariableImaginationInput`, `VariableImaginationResult` |
| `src/ai/justifier.ts` | `JustifierAgent` — `justify(input)` generates human-readable explanations for tracing decisions. Types: `JustificationRequest`, `Justification` |
| `src/ai/correction-interpreter.ts` | `CorrectionInterpreterAgent` — `interpret(input)` converts natural-language corrections into structured rules. Types: `CorrectionContext`, `CorrectionInterpreterInput`, `CorrectionType`, `StructuredCorrection` |
| **Scenario Layer** | |
| `src/scenario/engine.ts` | `ScenarioEngine` — CRUD for scenarios and steps. `createScenario()`, `getScenario()`, `listScenarios()`, `updateStatus()`, `saveSteps()`, `getSteps()`, `getStep()`, `updateStep()`, `deleteScenario()`, `getScenariosForFunction()`. Types: `ScenarioStatus` (`draft` / `traced` / `validated` / `corrected`), `Scenario`, `ScenarioStep` (with `action`: `call` / `branch_taken` / `branch_skipped` / `dispatch` / `return` / `assign`), `CreateScenarioInput` |
| `src/scenario/tracer.ts` | `ScenarioTracer` — orchestrates step-by-step tracing. `trace(scenario, config)` walks the call graph, asks AI agents for branch/dispatch decisions. Constructor takes `(parser, queryEngine, pathTracer, variableImaginer, justifier)`. Types: `TraceConfig`, `TraceResult`, `DEFAULT_TRACE_CONFIG` |
| **Correction Layer** | |
| `src/correction/engine.ts` | `CorrectionEngine` — `submitCorrection(message, context, userId)`, `getCorrections()`, `undoCorrection()`. Interprets corrections via AI, persists to Neo4j, applies effects (variable_constraint, branch_override, dispatch_override, scenario_note, function_skip, function_include, global_rule), triggers cascading re-traces. Types: `CorrectionType`, `CorrectionScope` (`global` / `scenario` / `function` / `step`), `StructuredCorrection`, `Correction`, `CorrectionContext`, `CorrectionResult` |
| **Config** | |
| `src/config/loader.ts` | `loadConfig(projectRoot?)` — loads from `.vscode/code-graph/codegraph.yaml` (primary) or `.codegraph.yaml` (legacy). Zod validation + `${ENV_VAR}` substitution. `findProjectRoot()`, `getCodeGraphDir()`, `createDefaultConfig()`, `serializeConfig()`. `CodeGraphConfig` type |
| `src/config/logger.ts` | Winston logger singleton (`logger`) + `createModuleLogger(moduleName)` child logger factory |
| **Public API** | |
| `src/api.ts` | High-level facade. `CodeGraphClient` class wraps all core engines (GraphDriver, GraphSchema, CodeIndexer, QueryEngine, ScenarioEngine, ScenarioTracer, CorrectionEngine, all AI agents) behind a unified API. `createCodeGraphClient(options?)` factory. `CodeGraphClientOptions` interface (`projectRoot?`, `mock?`). `ScenarioView` type (`{ scenario, steps }`). `FunctionInfo` type alias for `FunctionNode`. Includes built-in mock/demo data for offline mode |

## Patterns

- **Parser contract**: `ICodeParser` has 4 methods: `parseFile()`, `parseDirectory()`, `resolveDispatch(callSite, context)`, `findImplementations(method)` — note `findImplementations` takes a `FunctionNode` parameter
- **Content hashing**: TypeScript parser uses a simple string hash; C++ parser uses SHA-256. Both support incremental parsing via content hash
- **AI provider abstraction**: All AI calls go through `AIProvider.chat(messages, options)` — swap OpenAI/CopilotCLI for Mock in tests. Three providers: `OpenAIProvider`, `MockAIProvider`, `CopilotCLIProvider`
- **AI agent base class**: All specialized agents extend `AIAgent` which provides `chat()` and `chatJSON()` methods
- **Scenario steps**: Each `ScenarioStep` has `action` (call, branch_taken, branch_skipped, dispatch, return, assign), justification, variable state, and confidence score
- **Module loggers**: Every module creates its own logger: `const log = createModuleLogger('parser')`
- **Config locations**: Primary path `.vscode/code-graph/codegraph.yaml`, legacy `.codegraph.yaml`. Config schema supports `project`, `neo4j`, `parser` (cpp/typescript), `ai` (provider: openai/mock/copilot, default: copilot), `tracing`, `server`, `editor` (sshHost) sections
- **Public API facade**: `CodeGraphClient` in `src/api.ts` provides a high-level entry point used by the VS Code extension and other consumers. Wraps engine construction and connection lifecycle. Supports mock mode with built-in demo data

## Adding New Functionality

- **New parser**: Implement `ICodeParser`, see `processes/add-parser.md`
- **New AI agent**: Create in `src/ai/`, extend `AIAgent`, follow the pattern in `scenario-discovery.ts`
- **New AI provider**: Implement `AIProvider` interface, add to `createAIProvider()` factory in `agent.ts`
- **New graph query**: Add typed method to `QueryEngine` in `src/graph/queries.ts`
- **New correction type**: Add to `CorrectionType` union in `src/correction/engine.ts`, handle in `applyCorrection()` switch
- **New config section**: Add Zod schema in `src/config/loader.ts`, add to `CodeGraphConfigSchema`
- **New public API method**: Add to `CodeGraphClient` in `src/api.ts` if consumers need access
- **Always**: Re-export from `src/index.ts`
