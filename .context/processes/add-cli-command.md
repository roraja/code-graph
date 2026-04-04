# Process: Adding a New CLI Command

## When to Use

You need to add a new subcommand to the `codegraph` CLI tool.

## Steps

### Step 1: Create the Command File

Load: `.context/domains/cli.md`

Create `packages/cli/src/commands/<command-name>.ts`:

```ts
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { loadContext, startSpinner, handleError } from '../helpers.js';

export function registerMyCommandCommand(program: Command): void {
  program
    .command('my-command')
    .description('What this command does')
    .argument('[arg]', 'Optional argument description')
    .option('--flag <value>', 'Flag description', 'default')
    .option('-f, --format <format>', 'Output format', 'table')
    .action(async (arg, opts) => {
      const spinner = startSpinner('Loading...');
      try {
        const ctx = await loadContext(opts.config);
        // ... command logic using ctx.queryEngine, ctx.scenarioEngine, etc.
        spinner.succeed(chalk.green('Done'));
        await ctx.driver.disconnect();
      } catch (error) {
        spinner.fail(chalk.red('Failed'));
        handleError(error, opts.verbose);
        process.exit(1);
      }
    });
}
```

### Step 2: Register the Command

In `packages/cli/src/index.ts`, import and register:

```ts
import { registerMyCommandCommand } from './commands/my-command.js';
// ...
registerMyCommandCommand(program);
```

### Step 3: Update Context (if needed)

If the command needs core engines not already in `CLIContext`, update `helpers.ts`:
- Add the engine to `CLIContext` or `FullCLIContext` interface
- Wire it up in `loadContext()` or `loadFullContext()`
- For commands needing AI agents (tracing, discovery, corrections), use `loadFullContext()` instead of `loadContext()`

### Step 4: Test

```bash
cd packages/cli && npm run build
node dist/index.js my-command --help
node dist/index.js my-command [args]
```

### Step 5: Document

- Update CLI reference in README.md if it's a user-facing command
- Update `.context/domains/cli.md` with the new command
