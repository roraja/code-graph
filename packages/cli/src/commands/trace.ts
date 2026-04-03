/**
 * `codegraph trace` — Trace a scenario through the codebase.
 *
 * Uses the ScenarioTracer to follow execution paths through the graph,
 * making AI-powered branch and dispatch decisions along the way.
 *
 * @module cli/commands/trace
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  loadFullContext,
  handleError,
  startSpinner,
  formatDuration,
  gracefulExit,
  printHeader,
} from '../helpers.js';

/**
 * Register the `trace` command on the CLI program.
 *
 * @param program - The root Commander program instance
 */
export function registerTraceCommand(program: Command): void {
  program
    .command('trace <scenario-id>')
    .description('Trace a scenario through the codebase')
    .option('--max-depth <n>', 'Maximum call depth', '50')
    .action(async (scenarioId: string, opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;

      try {
        const ctx = await loadFullContext(configPath);

        // Load the scenario
        const scenario = await ctx.scenarioEngine.getScenario(scenarioId);
        if (!scenario) {
          console.error(chalk.red(`✖ Scenario not found: ${scenarioId}`));
          await gracefulExit(ctx.driver, 1);
          return;
        }

        printHeader(`Tracing: ${scenario.name}`);
        console.log(chalk.dim('  Description: ') + scenario.description);
        console.log(chalk.dim('  Entry:       ') + chalk.cyan(scenario.entryFunction));
        console.log();

        const spinner = startSpinner('Tracing execution path...');
        const startTime = Date.now();

        const result = await ctx.scenarioTracer.trace(scenario, {
          maxDepth: parseInt(opts.maxDepth, 10),
        });

        const duration = Date.now() - startTime;
        spinner.succeed(`Trace complete in ${formatDuration(duration)}`);

        // Save the traced steps
        const saveSpinner = startSpinner('Saving trace results...');
        await ctx.scenarioEngine.saveSteps(scenarioId, result.steps);
        saveSpinner.succeed('Trace saved to graph');

        // Display summary
        console.log();
        console.log(chalk.bold('Trace Summary'));
        console.log(chalk.dim('  Steps:       ') + chalk.white(String(result.steps.length)));
        console.log(
          chalk.dim('  Functions:   ') +
            chalk.white(String(result.functionsTraversed))
        );
        console.log(
          chalk.dim('  Branches:    ') +
            chalk.white(String(result.branchDecisions))
        );
        console.log(
          chalk.dim('  Dispatches:  ') +
            chalk.white(String(result.dispatchesResolved))
        );
        console.log(
          chalk.dim('  Duration:    ') +
            chalk.white(formatDuration(result.durationMs))
        );
        console.log();
        console.log(
          chalk.dim('Run ') +
            chalk.cyan(`codegraph walk ${scenarioId}`) +
            chalk.dim(' to step through the trace.')
        );

        await gracefulExit(ctx.driver, 0);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}
