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
| `src/ai/copilot-cli-provider.ts` | `CopilotCLIProvider` — AI provider that invokes GitHub Copilot CLI in single-shot mode. Uses `-p @filepath` to pass prompts via temp file (avoids ARG_MAX). Instructs copilot to write JSON output to a temp file for reliable response extraction. Falls back to stdout JSON extraction. `CopilotCLIConfig` interface |
| `src/ai/scenario-discovery.ts` | `ScenarioDiscoveryAgent` — `discover(input)` finds realistic user-facing scenarios. Types: `FunctionSummary`, `ScenarioDiscoveryInput`, `DiscoveredScenario`, `CallEdgeSummary`, `BranchSummary`, `ClassSummary`, `InheritanceSummary`, `CodebaseSummary` |
| `src/ai/path-tracer.ts` | `PathTracerAgent` — `traceStep(input)` decides branch direction or dispatch target at a single decision point. Types: `ScenarioContext`, `PathTraceInput`, `PathTraceResult` |
| `src/ai/variable-imaginer.ts` | `VariableImaginerAgent` — `imagine(input)` infers realistic variable values. Types: `VariableImaginationInput`, `VariableImaginationResult` |
| `src/ai/justifier.ts` | `JustifierAgent` — `justify(input)` generates human-readable explanations for tracing decisions. Types: `JustificationRequest`, `Justification` |
| `src/ai/correction-interpreter.ts` | `CorrectionInterpreterAgent` — `interpret(input)` converts natural-language corrections into structured rules. Types: `CorrectionContext`, `CorrectionInterpreterInput`, `CorrectionType`, `StructuredCorrection` |
| **Scenario Layer** | |
| `src/scenario/engine.ts` | `ScenarioEngine` — CRUD for scenarios and steps. `createScenario()`, `getScenario()`, `listScenarios()`, `updateStatus()`, `saveSteps()`, `getSteps()`, `getStep()`, `updateStep()`, `deleteScenario()`, `getScenariosForFunction()`. Types: `ScenarioStatus` (`draft` / `traced` / `validated` / `corrected`), `Scenario`, `ScenarioStep` (with `action`: `call` / `branch_taken` / `branch_skipped` / `dispatch` / `return` / `assign`), `CreateScenarioInput`, `CallStackFrame`, `FrameVariable`. Also exports `normalizeTags()` |
| `src/scenario/tracer.ts` | `ScenarioTracer` — orchestrates step-by-step tracing. `trace(scenario, config)` walks the call graph, asks AI agents for branch/dispatch decisions. Constructor takes `(parser, queryEngine, pathTracer, variableImaginer, justifier)`. Types: `TraceConfig`, `TraceResult`, `DEFAULT_TRACE_CONFIG` |
| `src/scenario/file-reader.ts` | `ScenarioFileReader` — reads scenarios and steps from JSON files on disk at `.vscode/code-graph/scenarios/*.json`. Replaces Neo4j-based reads for the read path. Methods: `listScenarios(status?, tags?)`, `getScenario(id)`, `getSteps(scenarioId, from?, to?)`, `getStep(scenarioId, stepNumber)`, `getScenariosForFunction(functionName)`, `getScenariosDir()`. Constructor takes `(projectRoot)` |
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

## Copilot CLI Integration Gotchas

These are hard-won learnings from debugging the CopilotCLIProvider:

1. **`-p -` does NOT read from stdin** — The Copilot CLI interprets `-p -` as a literal dash character prompt, not as "read from stdin". Use `-p @filepath` to pass large prompts via a temp file.

2. **`[System instructions: ...]` triggers prompt injection detection** — Copilot's built-in system prompt rejects text that looks like a system-prompt override. Frame system messages as `# Task Guidelines\n\n...` instead.

3. **`--no-custom-instructions` makes copilot MORE suspicious** — This flag causes copilot to treat any instructions in the prompt as injection attempts. Don't use it.

4. **Large prompts cause copilot to switch to agent mode** — When the prompt includes 100+ function source codes (~145KB), copilot ignores inline data and starts reading files with its tools, returning conversational text instead of JSON. Keep prompts small and let copilot search the codebase itself.

5. **`--available-tools` (no value) disables all tools** — Useful when you want copilot to analyze only the provided data without searching/reading files. However, for large codebases, it's better to let copilot use tools and keep the prompt minimal.

6. **Output file pattern for reliable JSON extraction** — Instruct copilot to write JSON to a temp file (`IMPORTANT: Write your complete JSON response to this file: /tmp/xxx/output.json`). Read the file after copilot exits. This avoids all stdout noise issues.

7. **`--silent` suppresses progress lines but not tool output** — The `--silent` flag hides usage summaries and progress indicators but copilot's conversational responses still appear in stdout.

8. **C++ codebases have no "exported" functions** — The `isExported` field on `FunctionNode` is always `false` for C++ code. The discover command must fall back to using all functions when no exported functions exist.

9. **ARG_MAX limits**: Even with a 2MB ARG_MAX, passing prompts as command-line arguments can fail because `copilot` is a Node.js wrapper that calls `spawnSync(nativeBinary, process.argv.slice(2))`, creating a chain of exec calls that accumulate overhead. Use `-p @filepath` instead.

10. **Reference implementation**: The `bd-build-service-go` HandleCopilotRun handler (in `internal/handlers/async_handlers.go`) uses the same temp-file + launcher-script pattern for passing prompts to copilot. Consult it for proven patterns.
