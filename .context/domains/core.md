# Domain: Core Engine (@codegraph/core)

## Scope

The foundational package containing all core engines: parser, graph, AI, scenario, and correction. All other packages depend on this. Located in `packages/core/`.

## Architecture (Layered)

Each layer depends only on layers below it:

```
config/        ← Logger, config loader (Zod + YAML)
    ↑
parser/        ← ICodeParser interface, TypeScript parser (ts-morph), C++ parser (clangd)
    ↑
graph/         ← GraphDriver (Neo4j), GraphSchema, CodeIndexer, QueryEngine
    ↑
ai/            ← AIProvider interface, OpenAI + Mock implementations, specialized agents
    ↑
scenario/      ← ScenarioEngine (CRUD), ScenarioTracer (step-by-step tracing)
    ↑
correction/    ← CorrectionEngine (natural-language → structured rules → re-trace)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Barrel exports — all public API |
| `src/parser/interface.ts` | `ICodeParser` contract + data types (`FunctionNode`, `ClassNode`, `CallEdge`, `BranchNode`, `VariableNode`) |
| `src/parser/typescript.ts` | TypeScript parser using ts-morph — extracts functions, classes, calls, branches, variables, inheritance |
| `src/graph/driver.ts` | Neo4j connection wrapper — pooling, transactions, error recovery |
| `src/graph/schema.ts` | Graph schema definitions |
| `src/graph/indexer.ts` | Stores parse results into Neo4j |
| `src/graph/queries.ts` | Typed query engine — `getFunction()`, `getCallers()`, `getCallees()`, `findCallPaths()`, `getClassHierarchy()` |
| `src/ai/agent.ts` | `AIProvider` interface + `OpenAIProvider` / `MockAIProvider` |
| `src/ai/scenario-discovery.ts` | Discovers execution scenarios via AI |
| `src/ai/path-tracer.ts` | Traces execution paths through call graph |
| `src/ai/variable-imaginer.ts` | Infers variable values at each step |
| `src/ai/justifier.ts` | Generates justifications for branch/dispatch decisions |
| `src/ai/correction-interpreter.ts` | Interprets user corrections into structured rules |
| `src/scenario/engine.ts` | Scenario CRUD — lifecycle: `draft → traced → validated → corrected` |
| `src/scenario/tracer.ts` | Step-by-step tracing orchestrator — walks calls, asks AI for branch/dispatch decisions |
| `src/correction/engine.ts` | Correction types: `variable_constraint`, `branch_override`, `dispatch_override`, `scenario_note`, `function_skip`, `function_include`, `global_rule` |
| `src/config/loader.ts` | Loads `.codegraph.yaml` with Zod validation + `${ENV_VAR}` substitution |
| `src/config/logger.ts` | Winston logger singleton + `createModuleLogger(moduleName)` |

## Patterns

- **Parser contract**: `ICodeParser` has 4 methods: `parseFile()`, `parseDirectory()`, `resolveDispatch()`, `findImplementations()`
- **Content hashing**: TypeScript parser hashes file contents for incremental parsing — only re-parses changed files
- **AI provider abstraction**: All AI calls go through `AIProvider.chat(messages, options)` — swap OpenAI for Mock in tests
- **Scenario steps**: Each `ScenarioStep` has `actionType` (call, branch_taken, branch_skipped, dispatch, return), justification, variable state, and confidence score
- **Module loggers**: Every module creates its own logger: `const logger = createModuleLogger('parser')`

## Adding New Functionality

- **New parser**: Implement `ICodeParser`, see `processes/add-parser.md`
- **New AI agent**: Create in `src/ai/`, follow the pattern in `scenario-discovery.ts`
- **New graph query**: Add typed method to `QueryEngine` in `src/graph/queries.ts`
- **New correction type**: Add to discriminated union in `src/correction/engine.ts`, update Zod schema
- **Always**: Re-export from `src/index.ts`
