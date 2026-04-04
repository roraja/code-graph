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
import { createContext } from '../helpers.js';

export function registerMyCommandCommand(program: Command): void {
  program
    .command('my-command')
    .description('What this command does')
    .argument('[arg]', 'Optional argument description')
    .option('--flag <value>', 'Flag description', 'default')
    .option('-f, --format <format>', 'Output format', 'table')
    .action(async (arg, opts) => {
      const spinner = ora('Loading...').start();
      try {
        const ctx = await createContext(opts);
        // ... command logic using ctx.queryEngine, ctx.scenarioEngine, etc.
        spinner.succeed(chalk.green('Done'));
      } catch (error) {
        spinner.fail(chalk.red('Failed'));
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(message));
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
- Wire it up in `createContext()` or `createFullContext()`

### Step 4: Test

```bash
cd packages/cli && npm run build
node dist/index.js my-command --help
node dist/index.js my-command [args]
```

### Step 5: Document

- Update CLI reference in README.md if it's a user-facing command
- Update `.context/domains/cli.md` with the new command
