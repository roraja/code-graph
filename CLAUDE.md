# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**CodeGraph** is a TypeScript monorepo that parses codebases into a **Neo4j graph database** (functions, calls, branches, virtual dispatch, data flow), then uses **AI agents** to discover usage scenarios, trace execution paths, and provide step-by-step walkthroughs with imagined variable values and branch justifications. Users can correct AI decisions in natural language, and corrections cascade downstream.

## Build & Development Commands

```bash
# Install and build all packages
npm install
npm run build

# Run all unit tests (no external dependencies)
npm test

# Run a single test file
cd packages/core && npx vitest run src/parser/typescript.test.ts

# Run a single test by name
cd packages/core && npx vitest run -t "should extract exported function declarations"

# Watch mode
cd packages/core && npx vitest watch

# Integration tests (requires Neo4j running on bolt://localhost:7687)
npm run test:integration

# E2E tests (requires Neo4j + built packages)
npm run test:e2e

# Lint
npm run lint

# Run tests with mock AI (no API key needed)
CODEGRAPH_AI_MOCK=true npm test

# Dev mode — server and web UI
cd packages/server && npm run dev
cd packages/web && npm run dev

# Clean build artifacts
npm run clean

# Run CLI from source
node packages/cli/dist/index.js <command>
```

## Architecture

Four npm workspace packages with a strict dependency flow:

```
@codegraph/core   ← foundation (no deps on other packages)
    ↑
@codegraph/cli    ← depends on core (Commander.js CLI, 18 commands)
@codegraph/server ← depends on core (Express + Apollo GraphQL API)
@codegraph/web    ← standalone SPA (React + Vite, connects to server via GraphQL at runtime)
```

### Core Engine Layers (`packages/core/src/`)

Each layer depends only on layers below it:

```
config/        ← Winston logger, YAML config loader (Zod validation + ${ENV_VAR} substitution)
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

### Navigating with Context Files

The workspace has a layered context system — load only what's relevant:

1. **Start with** `.context/FLOORPLAN.md` — routing table to find the right context
2. **Domain contexts** in `.context/domains/` — per-module reference (core, cli, server, web, testing)
3. **Process contexts** in `.context/processes/` — step-by-step workflows (new feature, new parser, new CLI command, debug)

## Code Conventions

### TypeScript
- Target ES2022, module system Node16 (ESNext for web package)
- Strict mode everywhere — each package extends `tsconfig.base.json`
- Barrel exports via `src/index.ts` in each package — all public types/classes must be re-exported
- Tests (`*.test.ts`) excluded from compilation

### Naming
- **Classes**: PascalCase (`GraphDriver`, `TypeScriptParser`)
- **Interfaces**: `I` prefix for contracts (`ICodeParser`) but not for data shapes (`GraphDriverConfig`)
- **Functions**: camelCase (`loadConfig`, `createModuleLogger`)
- **Discriminated unions** for enums: `CorrectionType`, `StepAction`, `ScenarioStatus`
- **CLI commands**: one file per command, named after the command (`discover.ts`, `trace.ts`)

### Dependency Injection
Constructor injection — engines receive dependencies as constructor arguments:
```ts
class ScenarioEngine {
  constructor(
    private driver: GraphDriver,
    private queryEngine: QueryEngine,
    private logger: Logger
  ) {}
}
```

### Error Handling
Try-catch with type narrowing, never swallow errors in async functions:
```ts
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`Failed to connect: ${message}`);
}
```

### Commit Messages
Follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, etc.

## Key Patterns

1. **AI provider abstraction**: `AIProvider` interface with `OpenAIProvider` (production) and `MockAIProvider` (testing). Set `CODEGRAPH_AI_MOCK=true` to test without an API key. All AI-dependent code must work with both providers.

2. **CLI command registration**: Each command exports `registerXxxCommand(program: Command): void`. Entry point registers all 18 commands. Shared context via `CLIContext` / `FullCLIContext` from `helpers.ts`. Uses chalk (colored output), ora (spinners), inquirer (prompts), cli-table3 (tables).

3. **Server context factory**: `createServerContext()` wires up all core engines. `startServer()` mounts REST (`/api/*`) + GraphQL (`/graphql`) + optional static web UI from `packages/web/dist`.

4. **Scenario lifecycle**: `draft → traced → validated → corrected`. Corrections are interpreted by AI into structured rules (`variable_constraint`, `branch_override`, `dispatch_override`, `scenario_note`, `function_skip`, `function_include`, `global_rule`) with cascading re-traces.

5. **Config loading**: `findProjectRoot()` walks up directory tree → loads `.codegraph.yaml` → Zod validation → `${ENV_VAR}` substitution. See `.codegraph.yaml.example` for all options.

6. **Logging**: Winston singleton with module loggers via `createModuleLogger('moduleName')`. Structured format with timestamp, level, message, metadata.

7. **Parser contract**: `ICodeParser` has 4 methods: `parseFile()`, `parseDirectory()`, `resolveDispatch()`, `findImplementations()`. TypeScript parser uses content hashing for incremental parsing.

8. **Mock factories for tests**: `createMockDriver()` and `createMockQueryEngine()` return objects with `vi.fn()` methods. Parser tests use in-memory ts-morph projects (no file I/O).

## Testing

| Level | Location | Command | Requires |
|-------|----------|---------|----------|
| Unit | `packages/core/src/**/*.test.ts` + `test/unit/` | `npm test` | Nothing |
| Integration | `packages/core/src/**/*.integration.test.ts` | `npm run test:integration` | Neo4j |
| E2E | `test/e2e/` | `npm run test:e2e` | Neo4j + built packages |

- Framework: **Vitest** with globals enabled (`describe`, `it`, `expect`, `vi` — no imports needed)
- Unit tests: 30s timeout, integration tests: 60s timeout

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `CODEGRAPH_NEO4J_PASSWORD` | Neo4j password (referenced in `.codegraph.yaml` as `${CODEGRAPH_NEO4J_PASSWORD}`) |
| `CODEGRAPH_AI_API_KEY` | OpenAI API key |
| `CODEGRAPH_AI_MOCK` | Set to `true` for mock AI responses (no API key needed) |
| `CODEGRAPH_LOG_LEVEL` | Winston log level |
| `CODEGRAPH_LOG_JSON` | JSON log output format |
| `CODEGRAPH_SILENT` | Suppress all logging |

## Things to Avoid

- Never use raw Cypher results in public API — use typed `QueryEngine` methods
- Never skip Zod validation when adding config fields
- Never create CLI commands without the `registerXxxCommand()` pattern
- Never add exports to a package without updating the barrel `src/index.ts`
- Use `any` only when unavoidable

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Build fails with import errors | Run `npm run build` from root — packages build in dependency order |
| "Cannot find module @codegraph/core" | Build core first: `cd packages/core && npm run build` |
| Integration tests fail | Check Neo4j is running: `docker ps`, verify `bolt://localhost:7687` |
| AI tests fail with auth errors | Set `CODEGRAPH_AI_MOCK=true` or provide `CODEGRAPH_AI_API_KEY` |
| Config not found | `findProjectRoot()` walks up from cwd looking for `.codegraph.yaml` |
| Web UI shows blank page | Build web: `cd packages/web && npm run build`, then `codegraph serve` |

## Documentation Requirements

When working with GitHub Copilot, execution logs are written to `docs/copilot-executions/NN-slug.md`, feature docs to `docs/features/NN-slug.md`, and bug fix docs to `docs/bug-fixes/NN-slug.md`. Each uses incrementing sequence numbers. Update relevant `.context/` files when discovering new patterns or gotchas.
