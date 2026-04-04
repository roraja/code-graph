# Domain: CLI (@codegraph/cli)

## Scope

The CLI tool providing 18 commands via Commander.js. Located in `packages/cli/`.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry point — registers all commands, global options (`--config`, `--verbose`) |
| `src/helpers.ts` | `CLIContext` / `FullCLIContext` factory — wires up core engines for commands |
| `src/commands/*.ts` | One file per command |

## Commands

`init`, `index-cmd`, `discover`, `trace`, `walk`, `correct`, `query`, `serve`, `doctor`, `stats`, `scenarios`, `explore`, `interactive`, `view-scenario`, `export`, `import-scenario`, `functions`, `diff`

## Patterns

Every command follows this pattern:

```ts
export function registerXxxCommand(program: Command): void {
  program
    .command('xxx')
    .description('...')
    .option('--flag <value>', 'Description', defaultValue)
    .action(async (opts) => {
      const ctx = await createContext(opts);
      // ... logic
    });
}
```

- **Colored output**: `chalk.green()`, `chalk.red()`, `chalk.dim()`
- **Spinners**: `ora('Loading...').start()` → `.succeed()` / `.fail()`
- **Interactive prompts**: `inquirer` for complex workflows (e.g., `walk`, `explore`)
- **Table output**: `cli-table3` for formatted data display
- **Context creation**: Commands that need core engines call `createContext(opts)` from `helpers.ts`

## Adding a New Command

See `processes/add-cli-command.md`.
