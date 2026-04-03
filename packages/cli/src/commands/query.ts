/**
 * `codegraph query` — Query the code graph.
 *
 * Provides subcommands for querying function relationships:
 * - `callers <function>` — Find functions that call the target
 * - `callees <function>` — Find functions called by the target
 * - `path <from> <to>` — Find call paths between two functions
 *
 * Results are displayed in formatted tables.
 *
 * @module cli/commands/query
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  loadContext,
  handleError,
  startSpinner,
  gracefulExit,
  printHeader,
} from '../helpers.js';

/**
 * Register the `query` command (with subcommands) on the CLI program.
 *
 * @param program - The root Commander program instance
 */
export function registerQueryCommand(program: Command): void {
  const query = program
    .command('query')
    .description('Query the code graph');

  // --- query callers ---
  query
    .command('callers <function-name>')
    .description('Find all functions that call the given function')
    .action(async (functionName: string, _opts, cmd) => {
      const verbose = cmd.parent?.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.parent?.opts().config;

      try {
        const ctx = await loadContext(configPath);
        const spinner = startSpinner(`Finding callers of ${chalk.cyan(functionName)}...`);

        const fn = await ctx.queryEngine.getFunctionByName(functionName);
        if (!fn) {
          spinner.fail(`Function not found: ${functionName}`);
          await gracefulExit(ctx.driver, 1);
          return;
        }

        const callers = await ctx.queryEngine.getCallers(fn.id);
        spinner.succeed(`Found ${callers.length} caller(s)`);

        if (callers.length === 0) {
          console.log(chalk.dim('  No callers found.'));
          await gracefulExit(ctx.driver, 0);
          return;
        }

        printHeader(`Callers of ${functionName}`);
        const table = new Table({
          head: [
            chalk.cyan('Function'),
            chalk.cyan('File'),
            chalk.cyan('Line'),
          ],
          colWidths: [35, 45, 8],
          wordWrap: true,
        });

        for (const c of callers) {
          table.push([c.function.qualifiedName, c.filePath, String(c.line)]);
        }

        console.log(table.toString());
        await gracefulExit(ctx.driver, 0);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });

  // --- query callees ---
  query
    .command('callees <function-name>')
    .description('Find all functions called by the given function')
    .action(async (functionName: string, _opts, cmd) => {
      const verbose = cmd.parent?.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.parent?.opts().config;

      try {
        const ctx = await loadContext(configPath);
        const spinner = startSpinner(`Finding callees of ${chalk.cyan(functionName)}...`);

        const fn = await ctx.queryEngine.getFunctionByName(functionName);
        if (!fn) {
          spinner.fail(`Function not found: ${functionName}`);
          await gracefulExit(ctx.driver, 1);
          return;
        }

        const callees = await ctx.queryEngine.getCallees(fn.id);
        spinner.succeed(`Found ${callees.length} callee(s)`);

        if (callees.length === 0) {
          console.log(chalk.dim('  No callees found.'));
          await gracefulExit(ctx.driver, 0);
          return;
        }

        printHeader(`Callees of ${functionName}`);
        const table = new Table({
          head: [
            chalk.cyan('Function'),
            chalk.cyan('File'),
            chalk.cyan('Line'),
          ],
          colWidths: [35, 45, 8],
          wordWrap: true,
        });

        for (const c of callees) {
          table.push([c.function.qualifiedName, c.filePath, String(c.line)]);
        }

        console.log(table.toString());
        await gracefulExit(ctx.driver, 0);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });

  // --- query path ---
  query
    .command('path <from> <to>')
    .description('Find call paths between two functions')
    .option('--max-depth <n>', 'Maximum path depth', '10')
    .action(async (from: string, to: string, opts, cmd) => {
      const verbose = cmd.parent?.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.parent?.opts().config;

      try {
        const ctx = await loadContext(configPath);
        const spinner = startSpinner(
          `Finding path from ${chalk.cyan(from)} to ${chalk.cyan(to)}...`
        );

        const fromFn = await ctx.queryEngine.getFunctionByName(from);
        const toFn = await ctx.queryEngine.getFunctionByName(to);

        if (!fromFn) {
          spinner.fail(`Source function not found: ${from}`);
          await gracefulExit(ctx.driver, 1);
          return;
        }
        if (!toFn) {
          spinner.fail(`Target function not found: ${to}`);
          await gracefulExit(ctx.driver, 1);
          return;
        }

        const chains = await ctx.queryEngine.getCallChain(
          fromFn.id,
          toFn.id,
          parseInt(opts.maxDepth, 10)
        );
        spinner.succeed(`Found ${chains.length} path(s)`);

        if (chains.length === 0) {
          console.log(chalk.dim('  No path found between these functions.'));
          await gracefulExit(ctx.driver, 0);
          return;
        }

        printHeader(`Call Path: ${from} → ${to}`);
        for (let ci = 0; ci < chains.length; ci++) {
          const chain = chains[ci]!;
          if (chains.length > 1) {
            console.log(chalk.bold(`  Path ${ci + 1} (${chain.length} hops):`));
          }
          for (let i = 0; i < chain.path.length; i++) {
            const nodeId = chain.path[i]!;
            const indent = '  '.repeat(i + 1);
            const arrow = i === 0 ? '●' : '→';
            console.log(
              chalk.dim(indent) + chalk.cyan(arrow) + ' ' + chalk.white(nodeId)
            );
          }
          console.log();
        }
        await gracefulExit(ctx.driver, 0);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}
