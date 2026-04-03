/**
 * `codegraph correct` — Submit a correction to a scenario step.
 *
 * Takes a natural-language correction and applies it to a specific step
 * in a traced scenario. The CorrectionEngine uses AI to interpret the
 * correction and update the graph accordingly.
 *
 * @module cli/commands/correct
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  loadFullContext,
  handleError,
  startSpinner,
  gracefulExit,
} from '../helpers.js';

/**
 * Register the `correct` command on the CLI program.
 *
 * @param program - The root Commander program instance
 */
export function registerCorrectCommand(program: Command): void {
  program
    .command('correct <scenario-id>')
    .description('Submit a correction to a scenario step')
    .requiredOption('--step <n>', 'Step number to correct')
    .requiredOption('--message <text>', 'Correction message')
    .action(async (scenarioId: string, opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;

      try {
        const ctx = await loadFullContext(configPath);
        const stepNumber = parseInt(opts.step, 10);

        if (isNaN(stepNumber) || stepNumber < 1) {
          console.error(chalk.red('✖ Invalid step number.'));
          await gracefulExit(ctx.driver, 1);
          return;
        }

        // Load scenario and step
        const scenario = await ctx.scenarioEngine.getScenario(scenarioId);
        if (!scenario) {
          console.error(chalk.red(`✖ Scenario not found: ${scenarioId}`));
          await gracefulExit(ctx.driver, 1);
          return;
        }

        const step = await ctx.scenarioEngine.getStep(scenarioId, stepNumber);
        if (!step) {
          console.error(chalk.red(`✖ Step ${stepNumber} not found in scenario.`));
          await gracefulExit(ctx.driver, 1);
          return;
        }

        console.log(chalk.dim('Scenario: ') + chalk.white(scenario.name));
        console.log(
          chalk.dim('Step:     ') +
            chalk.white(`#${stepNumber} — ${step.functionName}:${step.line}`)
        );
        console.log(chalk.dim('Message:  ') + chalk.white(opts.message));
        console.log();

        const spinner = startSpinner('Interpreting correction...');

        const result = await ctx.correctionEngine.submitCorrection(
          opts.message,
          { scenario, currentStep: step },
          'cli-user'
        );

        if (result.clarificationNeeded) {
          spinner.warn('Clarification needed');
          console.log(chalk.yellow(`  ${result.clarificationNeeded}`));
          await gracefulExit(ctx.driver, 0);
          return;
        }

        spinner.succeed('Correction applied');

        console.log();
        console.log(chalk.dim('  Type:     ') + chalk.white(result.correction.type));
        console.log(chalk.dim('  Rule:     ') + chalk.white(result.correction.rule));
        console.log(chalk.dim('  Scope:    ') + chalk.white(result.correction.scope));
        console.log(
          chalk.dim('  Affected: ') +
            chalk.white(`${result.affectedSteps.length} step(s)`)
        );

        if (result.retraceTriggered) {
          console.log();
          console.log(
            chalk.cyan('  ⟳ Re-trace triggered.') +
              chalk.dim(' Downstream steps will be updated.')
          );
        }

        await gracefulExit(ctx.driver, 0);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}
