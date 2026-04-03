/**
 * `codegraph scenarios` — List all scenarios with their status.
 *
 * Displays a table of all known scenarios, optionally filtered by status.
 *
 * @module cli/commands/scenarios
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

/** Valid scenario status values */
type ScenarioStatus = 'draft' | 'traced' | 'validated' | 'corrected';

/**
 * Register the `scenarios` command on the CLI program.
 *
 * @param program - The root Commander program instance
 */
export function registerScenariosCommand(program: Command): void {
  program
    .command('scenarios')
    .description('List all scenarios')
    .option('--status <status>', 'Filter by status (draft, traced, validated, corrected)')
    .action(async (opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;

      try {
        const ctx = await loadContext(configPath);

        const status = opts.status as ScenarioStatus | undefined;
        const spinner = startSpinner('Loading scenarios...');
        const scenarios = await ctx.scenarioEngine.listScenarios(status);
        spinner.succeed(`Found ${scenarios.length} scenario(s)`);

        if (scenarios.length === 0) {
          console.log(chalk.dim('  No scenarios found.'));
          if (status) {
            console.log(chalk.dim(`  (Filtered by status: ${status})`));
          }
          console.log(
            chalk.dim('  Run ') +
              chalk.cyan('codegraph discover') +
              chalk.dim(' to find scenarios.')
          );
          await gracefulExit(ctx.driver, 0);
          return;
        }

        printHeader('Scenarios');

        const table = new Table({
          head: [
            chalk.cyan('ID'),
            chalk.cyan('Name'),
            chalk.cyan('Status'),
            chalk.cyan('Confidence'),
            chalk.cyan('Updated'),
          ],
          colWidths: [25, 30, 12, 12, 22],
          wordWrap: true,
        });

        for (const s of scenarios) {
          const statusColor = getStatusColor(s.status);
          const confidence = (s.confidence * 100).toFixed(0) + '%';
          const updated = formatDate(s.updatedAt);

          table.push([
            s.id,
            s.name,
            statusColor(s.status),
            confidence,
            updated,
          ]);
        }

        console.log(table.toString());

        await gracefulExit(ctx.driver, 0);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}

/**
 * Get a chalk color function for a scenario status.
 *
 * @param status - The scenario status
 * @returns A chalk color function
 */
function getStatusColor(status: string): (text: string) => string {
  switch (status) {
    case 'draft':
      return chalk.dim;
    case 'traced':
      return chalk.blue;
    case 'validated':
      return chalk.green;
    case 'corrected':
      return chalk.yellow;
    default:
      return chalk.white;
  }
}

/**
 * Format an ISO date string to a short human-readable form.
 *
 * @param iso - ISO 8601 date string
 * @returns Formatted date string
 */
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
