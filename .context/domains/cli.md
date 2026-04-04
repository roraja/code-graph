# Domain: CLI (@codegraph/cli)

## Scope

The CLI tool providing 18 commands via Commander.js. Located in `packages/cli/`.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry point — creates Commander program, registers all 18 commands, global options (`--config`, `--verbose`). Default action launches `explore` in mock mode |
| `src/helpers.ts` | `CLIContext` / `FullCLIContext` interfaces and factory functions. Provides `loadCLIConfig()`, `connectDriver()`, `createProvider()`, `loadContext()`, `loadFullContext()`, error handling (`handleError()`, `gracefulExit()`), spinner helpers (`startSpinner()`, `formatDuration()`), pretty-printing (`printHeader()`, `printScenarioSummary()`, `printStepDetail()`, `printCallTree()`), and mock data generators (`getMockFunctions()`, `getMockScenarios()`, `getMockSteps()`, `getMockCallers()`, `getMockCallees()`) |
| `src/commands/*.ts` | One file per command (18 total) |

## Commands

| File | Command | Description |
|------|---------|-------------|
| `init.ts` | `init` | Initialize a new project |
| `index-cmd.ts` | `index <dir>` | Index a codebase |
| `discover.ts` | `discover` | Discover scenarios via AI |
| `trace.ts` | `trace <id>` | Trace a scenario |
| `walk.ts` | `walk <id>` | Interactive walkthrough |
| `correct.ts` | `correct <id>` | Submit a correction |
| `query.ts` | `query callers/callees/path` | Query the graph (3 subcommands) |
| `serve.ts` | `serve` | Start the API server |
| `doctor.ts` | `doctor` | Check system health |
| `stats.ts` | `stats` | Show graph statistics |
| `scenarios.ts` | `scenarios` | List scenarios |
| `explore.ts` | `explore` | Interactive codebase exploration |
| `interactive.ts` | `interactive` | Alias for explore |
| `view-scenario.ts` | `view <id>` | Rich scenario viewer |
| `export.ts` | `export <id>` | Export scenario (json/markdown/mermaid/cypher) |
| `import-scenario.ts` | `import <file>` | Import scenario from JSON |
| `functions.ts` | `functions` | Browse/search functions |
| `diff.ts` | `diff <id>` | Compare scenario versions |

## Context Interfaces

```ts
// Base context — config, driver, schema, indexer, queryEngine, scenarioEngine, aiProvider
interface CLIContext { ... }

// Extended — adds scenarioTracer, correctionEngine, discoveryAgent
interface FullCLIContext extends CLIContext { ... }
```

`loadContext(configPath?)` creates a `CLIContext`. `loadFullContext(configPath?)` creates a `FullCLIContext` with all AI agents wired up.

## Patterns

Every command follows this pattern:

```ts
export function registerXxxCommand(program: Command): void {
  program
    .command('xxx')
    .description('...')
    .option('--flag <value>', 'Description', defaultValue)
    .action(async (opts) => {
      const ctx = await loadContext(opts.config);
      // ... logic
    });
}
```

- **Colored output**: `chalk.green()`, `chalk.red()`, `chalk.dim()`
- **Spinners**: `ora('Loading...').start()` → `.succeed()` / `.fail()` (via `startSpinner()`)
- **Interactive prompts**: `inquirer` for complex workflows (e.g., `walk`, `explore`)
- **Table output**: `cli-table3` for formatted data display
- **Mock/demo mode**: Commands support `--mock` flag for demo mode without Neo4j, using mock data from `helpers.ts`
- **Pretty printing**: `printScenarioSummary()`, `printStepDetail()`, `printCallTree()` provide rich CLI output

## Adding a New Command

See `processes/add-cli-command.md`.
