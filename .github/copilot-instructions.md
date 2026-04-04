# Copilot Instructions for CodeGraph

This file provides guidance to GitHub Copilot when working with code in this repository.

## Project Overview

**CodeGraph** is a TypeScript monorepo that parses codebases into a **Neo4j graph database** — functions, calls, branches, virtual dispatch, data flow — then uses **AI agents** to discover realistic usage scenarios, trace full execution paths, and provide step-by-step walkthroughs with imagined variable values and branch justifications. Users can correct AI decisions in natural language, and corrections cascade downstream.

Four packages form the system:
- **@codegraph/core** — Parsers, Neo4j graph layer, AI agents, scenario engine, correction engine
- **@codegraph/cli** — 18 CLI commands (Commander.js) for indexing, discovering, tracing, walking, correcting
- **@codegraph/server** — Express + Apollo GraphQL API server
- **@codegraph/web** — React + Vite SPA with Cytoscape.js graph visualization and Zustand state

## Navigating This Codebase

**Read `.context/FLOORPLAN.md` to find the right context for your task.**

The workspace uses a layered context architecture:

| Layer | Location | Purpose |
|-------|----------|---------|
| **Floorplan** | `.context/FLOORPLAN.md` | Top-level routing table — which domain/process context to load |
| **Domain contexts** | `.context/domains/*.md` | Module-level reference (core, cli, server, web, testing) |
| **Process contexts** | `.context/processes/*.md` | Step-by-step workflows (new feature, new parser, new CLI command, debug) |

Only load the context(s) relevant to your current task. Do not load everything.

## Quick Commands

```bash
# Install and build
npm install
npm run build

# Run all unit tests
npm test

# Single test file
cd packages/core && npx vitest run src/parser/typescript.test.ts

# Watch mode
cd packages/core && npx vitest watch

# Integration tests (requires Neo4j running)
npm run test:integration

# E2E tests
npm run test:e2e

# Lint
npm run lint

# Mock AI mode (no API key needed)
CODEGRAPH_AI_MOCK=true npm test

# Dev mode
cd packages/server && npm run dev
cd packages/web && npm run dev

# Clean build artifacts
npm run clean
```

## Code Conventions

### TypeScript
- Target ES2022, module system Node16 (ESNext for web package)
- Strict mode enabled everywhere — each package extends `tsconfig.base.json`
- Barrel exports via `src/index.ts` in each package
- Tests (`*.test.ts`) excluded from compilation

### Naming
- **Classes**: PascalCase (`GraphDriver`, `TypeScriptParser`)
- **Interfaces**: PascalCase, `I` prefix for contracts (`ICodeParser`) but not for data shapes (`GraphDriverConfig`)
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

### Configuration
- Project config: `.codegraph.yaml` (see `.codegraph.yaml.example`)
- Zod schemas validate all config sections
- Environment variable substitution: `${CODEGRAPH_NEO4J_PASSWORD}`
- Key env vars: `CODEGRAPH_NEO4J_PASSWORD`, `CODEGRAPH_AI_API_KEY`, `CODEGRAPH_AI_MOCK`
- Logging env vars: `CODEGRAPH_LOG_LEVEL`, `CODEGRAPH_LOG_JSON`, `CODEGRAPH_SILENT`

### Testing (Vitest)
- Globals enabled — use `describe`, `it`, `expect`, `vi` without imports
- Unit tests: `*.test.ts` co-located with source (30s timeout)
- Integration tests: `*.integration.test.ts` in core (60s timeout, requires Neo4j)
- E2E tests: `test/e2e/` directory
- Parser tests use in-memory ts-morph projects (no file I/O)
- Mock factories: `createMockDriver()`, `createMockQueryEngine()` returning objects with `vi.fn()` methods

### Commit Messages
Follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, etc.

## Key Patterns

1. **Core layered architecture**: Parser → Graph → AI → Scenario → Correction. Each layer depends only on layers below it. See `.context/domains/core.md`.
2. **AI provider abstraction**: `AIProvider` interface with `OpenAIProvider` (production) and `MockAIProvider` (testing with canned/pattern-based responses). Set `CODEGRAPH_AI_MOCK=true` to test without API key.
3. **CLI command registration**: Each command exports `registerXxxCommand(program: Command): void`. Entry point registers all 18 commands. Shared context via `CLIContext` / `FullCLIContext` from `helpers.ts`.
4. **Server context factory**: `createServerContext()` wires up all core engines. `startServer()` mounts REST (`/api/*`) + GraphQL (`/graphql`) + optional static web UI.
5. **Scenario lifecycle**: `draft → traced → validated → corrected`. Corrections are interpreted by AI into structured rules (`variable_constraint`, `branch_override`, `dispatch_override`, etc.) with cascading re-traces.
6. **Logging**: Winston singleton with module loggers via `createModuleLogger('moduleName')`. Structured format with timestamp, level, message, metadata.
7. **Config loading**: `findProjectRoot()` walks up directory tree → loads `.codegraph.yaml` → Zod validation → `${ENV_VAR}` substitution.

## Things to Avoid

- Never commit API keys or credentials — use environment variables
- Never use raw Cypher results in public API — use typed `QueryEngine` methods
- Never skip Zod validation when adding config fields
- Never create CLI commands without the `registerXxxCommand()` pattern
- Never add exports to a package without updating the barrel `src/index.ts`

## Execution Logging (Mandatory)

**During EVERY prompt execution — no matter how big or small — you MUST create a detailed execution log in `docs/copilot-executions/` in REAL-TIME.**

This is mandatory and must never be skipped. The log documents exactly what happened during the prompt so work is traceable, reproducible, and reviewable.

### File naming
- Files are sequenced: `01-short-title.md`, `02-another-title.md`, etc.
- Check the last sequence number in `docs/copilot-executions/` and increment by 1. If no files exist, start with `01-`.
- The title should be a short, descriptive kebab-case summary of what the prompt asked for.

### Required sections
Every execution log must include **all** of the following sections with detailed content:

```markdown
# <NN> - <Prompt Title>

**Date**: YYYY-MM-DD HH:MM UTC
**Prompt**: <The user's original prompt, quoted verbatim or closely paraphrased>

## 1. Code Reading & Analysis
- List every file read/explored during this prompt, with why it was read
- Note relevant line numbers, functions, classes inspected
- Include any grep/search queries run and what they found

## 2. Issues Identified
- Describe each issue found, with exact file path and line number(s)
- Explain why it's a problem (root cause analysis)
- Include relevant code snippets if helpful

## 3. Plan
- What approach/strategy was decided on to address the prompt
- Any alternatives considered and why they were rejected
- Dependencies or ordering constraints

## 4. Changes Made
- For each file changed:
  - File path
  - What was changed (before → after summary)
  - Why the change was made
- For new files created: file path and purpose
- Write down the exact code diff for all changes made, with line numbers and context
- If no code changes were made, explain why

## 5. Commands Run
- Every command executed (build, test, lint, etc.)
- The result/output of each command (pass/fail, key output lines)
- Any retries or troubleshooting steps

## 6. Result
- Final outcome: what was achieved
- Any remaining issues or follow-up needed
- Verification steps taken (tests, manual checks, etc.)

## 7. Files Changed Summary
| File | Action | Description |
|------|--------|-------------|
| path/to/file | Modified/Created/Deleted | Brief description |
```

### Rules
- **Never skip this step**, even for single-line changes, doc-only changes, or exploratory prompts
- Write the log at the very end, after all work is complete
- Be detailed and specific — vague entries like "read some files" or "fixed the bug" are not acceptable
- Include actual file paths, line numbers, command outputs, and error messages
- If a prompt was purely exploratory (no code changes), still document what was read and what was learned

### Related documentation requirements
- After implementing any feature or significant modification, create or update a doc in `docs/features/`. Each feature doc should be named `<NN>-<feature-name>.md` (e.g., `01-cpp-parser-support.md`). Include: overview, design, implementation details, usage, testing, and code references. Check the last sequence number and increment by 1.
- After fixing a bug, create or update a doc in `docs/bug-fixes/`. Each bug fix doc should be named `<NN>-<bug-description>.md` (e.g., `01-neo4j-connection-pool-leak.md`). Include: problem statement, root cause analysis, solution implemented, testing verification, and code references. Check the last sequence number and increment by 1.

## File Naming Conventions

| Category           | Pattern                                | Example                                        |
|--------------------|----------------------------------------|------------------------------------------------|
| Feature docs       | `docs/features/NN-slug.md`            | `docs/features/01-cpp-parser-support.md`       |
| Bug fix docs       | `docs/bug-fixes/NN-slug.md`           | `docs/bug-fixes/01-neo4j-connection-pool-leak.md` |
| Copilot executions | `docs/copilot-executions/NN-slug.md`  | `docs/copilot-executions/01-add-python-parser.md` |

## Continuous Learning

Whenever you discover a learning — a better way to work, a faster debugging technique, a bug pattern, a gotcha, or any insight that would help future tasks — **update the relevant context files** so the knowledge is preserved:

1. **Update domain contexts**: If the learning is about a specific package or module, update the relevant `.context/domains/*.md` file
2. **Update process contexts**: If the learning changes a workflow, update the relevant `.context/processes/*.md` file
3. **Update the floorplan**: If the learning changes routing (e.g., new domain area), update `.context/FLOORPLAN.md`
4. **Update this file**: If the learning is a broadly applicable pattern, convention, or "thing to avoid", add it to the appropriate section here

The goal: **every session should leave the context system smarter than it found it.**

## Environment

Key env vars (see `.codegraph.yaml.example` for full config):
- `CODEGRAPH_NEO4J_PASSWORD` — Neo4j password (referenced in config as `${CODEGRAPH_NEO4J_PASSWORD}`)
- `CODEGRAPH_AI_API_KEY` — OpenAI API key (referenced in config as `${CODEGRAPH_AI_API_KEY}`)
- `CODEGRAPH_AI_MOCK` — Set to `true` for mock AI responses (no API key needed)
- `CODEGRAPH_LOG_LEVEL` — Winston log level
- `CODEGRAPH_LOG_JSON` — JSON log output format
- `CODEGRAPH_SILENT` — Suppress all logging
