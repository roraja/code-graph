# CodeGraph Workspace Floorplan

**CodeGraph** parses codebases into a Neo4j graph, then uses AI agents to discover usage scenarios, trace execution paths, and support human corrections — surfaced via CLI, GraphQL/REST API, React web UI, and VS Code extension.

Five components: **core** (engines), **cli** (Commander.js), **server** (Express + Apollo), **web** (React + Vite), **codegraph-navigator** (VS Code extension).

## How to Navigate

1. Read this file first.
2. Based on the task, load **one domain context** from `.context/domains/`.
3. If the task follows a known workflow, also load a **process context** from `.context/processes/`.
4. Only load additional domain contexts if the task clearly spans multiple modules.

## Domain Routing Table

| If the task involves... | Load this context | Primary folders |
|-------------------------|-------------------|-----------------|
| Parsers (TypeScript, C++), AST extraction | `domains/core.md` | `packages/core/src/parser/` |
| Neo4j graph layer, indexing, queries | `domains/core.md` | `packages/core/src/graph/` |
| AI agents, scenario discovery, tracing | `domains/core.md` | `packages/core/src/ai/`, `packages/core/src/scenario/` |
| Corrections, re-tracing logic | `domains/core.md` | `packages/core/src/correction/` |
| Config loading, Zod validation, logging | `domains/core.md` | `packages/core/src/config/` |
| CLI commands, interactive REPL, prompts | `domains/cli.md` | `packages/cli/src/commands/` |
| GraphQL schema, resolvers, REST routes | `domains/server.md` | `packages/server/src/` |
| React UI, Cytoscape graphs, Zustand stores | `domains/web.md` | `packages/web/src/` |
| VS Code extension, sidebar views, step walker | `domains/vscode-extension.md` | `codegraph-navigator/src/` |
| Tests (unit, integration, E2E, fixtures) | `domains/testing.md` | `packages/core/src/**/*.test.ts`, `test/` |

## Process Routing Table

| If you are trying to... | Load this process |
|-------------------------|-------------------|
| Add a new feature end-to-end | `processes/new-feature.md` |
| Add a new language parser | `processes/add-parser.md` |
| Add a new CLI command | `processes/add-cli-command.md` |
| Debug a test or runtime failure | `processes/debug-failure.md` |

## Package Dependency Flow

```
@codegraph/core   <- foundation (no deps on other packages)
    ^
@codegraph/cli    <- depends on core
@codegraph/server <- depends on core
@codegraph/web    <- standalone SPA (connects to server via REST API at runtime)

codegraph-navigator <- standalone VS Code extension (shells out to `codegraph` CLI, no code dependency on any package)
```

## Configuration Location

Config lives at `.vscode/code-graph/codegraph.yaml` (primary) with fallback to legacy `.codegraph.yaml`. The `findProjectRoot()` function walks up the directory tree checking both locations.

## VS Code Integration

The workspace has VS Code-specific files in `.vscode/`:

| File | Purpose |
|------|---------|
| `.vscode/settings.json` | Neo4j connection settings, CodeGraph extension settings (`codegraph.cliPath`, `codegraph.autoOpenStep`) |
| `.vscode/tasks.json` | Build/install tasks for the VS Code extension (install deps, build, package VSIX, install VSIX, watch mode) |
| `.vscode/launch.json` | Debug launch config for running the extension in an Extension Development Host |
| `.vscode/code-graph/logs/` | Datewise log files from the VS Code extension (`YYYY-MM-DD.log`) |

## File Naming Conventions

| Category | Pattern | Example |
|----------|---------|---------|
| Feature docs | `docs/features/NN-slug.md` | `docs/features/01-cpp-parser-support.md` |
| Bug fix docs | `docs/bug-fixes/NN-slug.md` | `docs/bug-fixes/01-neo4j-connection-pool-leak.md` |
| Copilot executions | `docs/copilot-executions/NN-slug.md` | `docs/copilot-executions/01-add-python-parser.md` |

## Global Guardrails

These apply everywhere in the codebase:

- **Strict TypeScript**: All packages use `"strict": true` — no `any` unless unavoidable
- **Barrel exports**: Every public type/class must be re-exported from `src/index.ts`
- **Zod validation**: All config fields must have Zod schemas — never trust raw input
- **Constructor injection**: Pass dependencies as constructor arguments, no service locators
- **Error narrowing**: Always narrow `catch (error)` with `error instanceof Error ? error.message : String(error)`
- **No raw Cypher**: Use typed `QueryEngine` methods in public API, not raw query strings
- **Mock AI**: All AI-dependent code must work with `MockAIProvider` (`CODEGRAPH_AI_MOCK=true`)
- **Conventional Commits**: `feat:`, `fix:`, `docs:`, `refactor:`, etc.
- **No credentials in code**: Use `${ENV_VAR}` substitution in config YAML

## Quick Troubleshooting

| Symptom | First thing to check |
|---------|---------------------|
| Build fails with import errors | Run `npm run build` from root — packages may need to build in dependency order |
| Tests fail with "Cannot find module @codegraph/core" | Build core first: `cd packages/core && npm run build` |
| Integration tests fail | Is Neo4j running? `docker ps` or check `bolt://localhost:7687` |
| AI tests fail with auth errors | Set `CODEGRAPH_AI_MOCK=true` or provide `CODEGRAPH_AI_API_KEY` |
| Config not found | `findProjectRoot()` looks for `.vscode/code-graph/codegraph.yaml` then `.codegraph.yaml` |
| Web UI shows blank page | Build web: `cd packages/web && npm run build`, then `codegraph serve` |
| Lint errors on test files | Tests are `.ts` not `.tsx` — check `--ext` flag matches |
| VS Code extension shows empty views | Open Output panel → "CodeGraph Navigator" to see CLI bridge errors. Check `codegraph` is in PATH and Neo4j is running |
| VS Code extension build fails | Run from extension dir: `cd codegraph-navigator && npm run build` (not the root `npm run build`) |
