/**
 * `codegraph discover` — Discover scenarios in the indexed codebase.
 *
 * Uses the ScenarioDiscoveryAgent to identify likely user-facing scenarios,
 * then displays them in a formatted table.
 *
 * @module cli/commands/discover
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  loadFullContext,
  handleError,
  startSpinner,
  gracefulExit,
  printHeader,
} from '../helpers.js';

/**
 * Register the `discover` command on the CLI program.
 *
 * @param program - The root Commander program instance
 */
export function registerDiscoverCommand(program: Command): void {
  program
    .command('discover')
    .description('Discover scenarios in the indexed codebase')
    .option('--hint <text>', 'Provide a hint to guide discovery')
    .option('--count <n>', 'Maximum number of scenarios to discover', '5')
    .action(async (opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;

      try {
        const ctx = await loadFullContext(configPath);

        const spinner = startSpinner('Analyzing codebase for scenarios...');

        // Gather entry points from the graph
        const functions = await ctx.queryEngine.searchFunctions('', 100);

        const entryPoints = functions
          .filter((f) => f.isExported)
          .map((f) => ({
            id: f.id,
            name: f.qualifiedName,
            signature: f.signature,
            filePath: f.filePath,
            documentation: f.documentation,
          }));

        const scenarios = await ctx.discoveryAgent.discover({
          entryPoints,
          eventHandlers: [],
          publicAPIs: entryPoints,
          userHint: opts.hint,
        });

        spinner.succeed(
          `Discovered ${chalk.bold(String(scenarios.length))} scenarios`
        );

        if (scenarios.length === 0) {
          console.log(chalk.yellow('  No scenarios found. Try adding a --hint.'));
          await gracefulExit(ctx.driver, 0);
          return;
        }

        // Save discovered scenarios to the graph
        const saveSpinner = startSpinner('Saving scenarios...');
        for (const s of scenarios.slice(0, parseInt(opts.count, 10))) {
          await ctx.scenarioEngine.createScenario({
            name: s.name,
            description: s.description,
            entryFunction: s.entryFunction,
            triggerCondition: s.triggerCondition,
            discoveredBy: 'ai',
            confidence: s.confidence,
          });
        }
        saveSpinner.succeed('Scenarios saved to graph');

        // Display table
        printHeader('Discovered Scenarios');
        const table = new Table({
          head: [
            chalk.cyan('Name'),
            chalk.cyan('Entry Function'),
            chalk.cyan('Confidence'),
            chalk.cyan('Trigger'),
          ],
          colWidths: [30, 30, 12, 40],
          wordWrap: true,
        });

        for (const s of scenarios.slice(0, parseInt(opts.count, 10))) {
          const confidence = (s.confidence * 100).toFixed(0) + '%';
          const confColor =
            s.confidence >= 0.8
              ? chalk.green(confidence)
              : s.confidence >= 0.5
                ? chalk.yellow(confidence)
                : chalk.red(confidence);

          table.push([s.name, s.entryFunction, confColor, s.triggerCondition]);
        }

        console.log(table.toString());

        await gracefulExit(ctx.driver, 0);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}
