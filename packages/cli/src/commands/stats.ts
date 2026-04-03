/**
 * `codegraph stats` — Show graph database statistics.
 *
 * Displays counts for indexed files, functions, classes, call edges,
 * and traced scenarios.
 *
 * @module cli/commands/stats
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
 * Register the `stats` command on the CLI program.
 *
 * @param program - The root Commander program instance
 */
export function registerStatsCommand(program: Command): void {
  program
    .command('stats')
    .description('Show graph database statistics')
    .action(async (_opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;

      try {
        const ctx = await loadContext(configPath);

        const spinner = startSpinner('Querying graph statistics...');
        const stats = await ctx.queryEngine.getStats();
        spinner.succeed('Statistics loaded');

        printHeader('Graph Statistics');

        const nodeTable = new Table({
          head: [chalk.cyan('Node Type'), chalk.cyan('Count')],
          colAligns: ['left', 'right'],
          colWidths: [30, 15],
        });

        for (const [label, count] of Object.entries(stats.nodes)) {
          nodeTable.push([label, String(count)]);
        }
        nodeTable.push([chalk.bold('Total Nodes'), chalk.bold(String(stats.totalNodes))]);
        console.log(nodeTable.toString());

        console.log();

        const relTable = new Table({
          head: [chalk.cyan('Relationship Type'), chalk.cyan('Count')],
          colAligns: ['left', 'right'],
          colWidths: [30, 15],
        });

        for (const [relType, count] of Object.entries(stats.relationships)) {
          relTable.push([relType, String(count)]);
        }
        relTable.push([chalk.bold('Total Relationships'), chalk.bold(String(stats.totalRelationships))]);
        console.log(relTable.toString());

        await gracefulExit(ctx.driver, 0);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}
