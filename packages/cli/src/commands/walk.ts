/**
 * `codegraph walk` — Interactive walkthrough of a traced scenario.
 *
 * Loads a scenario's traced steps and presents them one-by-one in a
 * REPL-style interface, showing source code, variable state, and
 * AI justifications at each step.
 *
 * Interactive commands:
 * - `n` / `next`  — Advance to next step
 * - `p` / `prev`  — Go back to previous step
 * - `j <n>`       — Jump to step number n
 * - `vars`        — Show variable state at current step
 * - `why`         — Show AI justification for current step
 * - `correct`     — Submit a correction for current step
 * - `q` / `quit`  — Exit the walkthrough
 *
 * @module cli/commands/walk
 */

import { createInterface } from 'node:readline';
import { Command } from 'commander';
import chalk from 'chalk';
import type { ScenarioStep } from '@codegraph/core';
import {
  loadFullContext,
  handleError,
  startSpinner,
  gracefulExit,
  printHeader,
} from '../helpers.js';

/**
 * Register the `walk` command on the CLI program.
 *
 * @param program - The root Commander program instance
 */
export function registerWalkCommand(program: Command): void {
  program
    .command('walk <scenario-id>')
    .description('Interactive walkthrough of a traced scenario')
    .action(async (scenarioId: string, _opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;

      try {
        const ctx = await loadFullContext(configPath);

        // Load scenario and steps
        const scenario = await ctx.scenarioEngine.getScenario(scenarioId);
        if (!scenario) {
          console.error(chalk.red(`✖ Scenario not found: ${scenarioId}`));
          await gracefulExit(ctx.driver, 1);
          return;
        }

        const spinner = startSpinner('Loading trace steps...');
        const steps = await ctx.scenarioEngine.getSteps(scenarioId);
        spinner.succeed(`Loaded ${steps.length} steps`);

        if (steps.length === 0) {
          console.log(
            chalk.yellow('  No steps found. Run ') +
              chalk.cyan(`codegraph trace ${scenarioId}`) +
              chalk.yellow(' first.')
          );
          await gracefulExit(ctx.driver, 0);
          return;
        }

        printHeader(`Walking: ${scenario.name}`);
        console.log(chalk.dim(scenario.description));
        console.log();
        printWalkHelp();

        let currentIndex = 0;
        displayStep(steps, currentIndex);

        // Start REPL
        const rl = createInterface({
          input: process.stdin,
          output: process.stdout,
          prompt: chalk.cyan('walk> '),
        });

        rl.prompt();

        rl.on('line', async (line) => {
          const input = line.trim().toLowerCase();
          const parts = input.split(/\s+/);
          const command = parts[0] ?? '';

          switch (command) {
            case 'n':
            case 'next':
              if (currentIndex < steps.length - 1) {
                currentIndex++;
                displayStep(steps, currentIndex);
              } else {
                console.log(chalk.yellow('  Already at the last step.'));
              }
              break;

            case 'p':
            case 'prev':
              if (currentIndex > 0) {
                currentIndex--;
                displayStep(steps, currentIndex);
              } else {
                console.log(chalk.yellow('  Already at the first step.'));
              }
              break;

            case 'j':
            case 'jump': {
              const target = parseInt(parts[1] ?? '', 10);
              if (isNaN(target) || target < 1 || target > steps.length) {
                console.log(chalk.red(`  Invalid step number. Range: 1-${steps.length}`));
              } else {
                currentIndex = target - 1;
                displayStep(steps, currentIndex);
              }
              break;
            }

            case 'vars':
              displayVariables(steps[currentIndex]!);
              break;

            case 'why':
              displayJustification(steps[currentIndex]!);
              break;

            case 'correct': {
              const correctionRl = createInterface({
                input: process.stdin,
                output: process.stdout,
              });
              const message = await new Promise<string>((resolve) => {
                correctionRl.question(
                  chalk.yellow('  Correction message: '),
                  (answer) => {
                    correctionRl.close();
                    resolve(answer);
                  }
                );
              });

              if (message.trim()) {
                try {
                  const result = await ctx.correctionEngine.submitCorrection(
                    message,
                    {
                      scenario,
                      currentStep: steps[currentIndex]!,
                    }
                  );
                  console.log(chalk.green('  ✔ Correction applied'));
                  if (result.retraceTriggered) {
                    console.log(chalk.dim('  Re-trace triggered for downstream steps.'));
                  }
                } catch (err) {
                  console.log(chalk.red('  ✖ Failed to apply correction'));
                  if (verbose) handleError(err, true);
                }
              }
              break;
            }

            case 'q':
            case 'quit':
            case 'exit':
              rl.close();
              await gracefulExit(ctx.driver, 0);
              return;

            case 'help':
            case '?':
              printWalkHelp();
              break;

            case '':
              break;

            default:
              console.log(chalk.red(`  Unknown command: ${command}. Type 'help' for options.`));
          }

          rl.prompt();
        });

        rl.on('close', async () => {
          await gracefulExit(ctx.driver, 0);
        });
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}

/**
 * Display a single scenario step with formatted output.
 *
 * @param steps - Array of all scenario steps
 * @param index - The index of the step to display
 */
function displayStep(steps: ScenarioStep[], index: number): void {
  const step = steps[index]!;
  const stepLabel = `Step ${step.stepNumber}/${steps.length}`;
  const actionColor = getActionColor(step.action);

  console.log();
  console.log(
    chalk.bold(`── ${stepLabel} ──`) +
      '  ' +
      actionColor(step.action) +
      '  ' +
      chalk.dim(`[${step.functionName}:${step.line}]`)
  );

  if (step.sourceCode) {
    console.log(chalk.gray('  │ ') + chalk.white(step.sourceCode.trim()));
  }

  // Show brief justification
  const justification =
    step.justification.length > 100
      ? step.justification.substring(0, 100) + '...'
      : step.justification;
  console.log(chalk.gray('  │ ') + chalk.dim(justification));

  // Show confidence indicator
  const confBar = renderConfidenceBar(step.confidence);
  console.log(chalk.gray('  │ ') + chalk.dim('Confidence: ') + confBar);

  // Show correction indicator
  if (step.correctedBy) {
    console.log(
      chalk.gray('  │ ') + chalk.magenta('✎ Corrected: ') + chalk.dim(step.correctionNote ?? '')
    );
  }
}

/**
 * Display the variable state for a step.
 *
 * @param step - The step whose variables to display
 */
function displayVariables(step: ScenarioStep): void {
  console.log();
  console.log(chalk.bold('  Variable State:'));
  const vars = step.variableState;
  if (Object.keys(vars).length === 0) {
    console.log(chalk.dim('    (no variables tracked)'));
    return;
  }
  for (const [key, value] of Object.entries(vars)) {
    console.log(
      chalk.cyan(`    ${key}`) + chalk.dim(' = ') + chalk.white(JSON.stringify(value))
    );
  }
}

/**
 * Display the full AI justification for a step.
 *
 * @param step - The step whose justification to display
 */
function displayJustification(step: ScenarioStep): void {
  console.log();
  console.log(chalk.bold('  Justification:'));
  console.log(chalk.white(`    ${step.justification}`));
}

/**
 * Get a chalk color function based on the action type.
 *
 * @param action - The step action type
 * @returns A chalk color function
 */
function getActionColor(action: string): (text: string) => string {
  switch (action) {
    case 'call':
      return chalk.blue;
    case 'branch_taken':
      return chalk.green;
    case 'branch_skipped':
      return chalk.red;
    case 'dispatch':
      return chalk.magenta;
    case 'return':
      return chalk.yellow;
    case 'assign':
      return chalk.cyan;
    default:
      return chalk.white;
  }
}

/**
 * Render a visual confidence bar.
 *
 * @param confidence - Confidence value from 0 to 1
 * @returns Formatted string with colored bar
 */
function renderConfidenceBar(confidence: number): string {
  const filled = Math.round(confidence * 10);
  const empty = 10 - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const pct = (confidence * 100).toFixed(0) + '%';

  if (confidence >= 0.8) return chalk.green(bar) + ' ' + chalk.green(pct);
  if (confidence >= 0.5) return chalk.yellow(bar) + ' ' + chalk.yellow(pct);
  return chalk.red(bar) + ' ' + chalk.red(pct);
}

/**
 * Print the interactive walk help text.
 */
function printWalkHelp(): void {
  console.log(chalk.dim('Commands:'));
  console.log(chalk.dim('  n/next     ') + 'Next step');
  console.log(chalk.dim('  p/prev     ') + 'Previous step');
  console.log(chalk.dim('  j <n>      ') + 'Jump to step n');
  console.log(chalk.dim('  vars       ') + 'Show variable state');
  console.log(chalk.dim('  why        ') + 'Show AI justification');
  console.log(chalk.dim('  correct    ') + 'Submit a correction');
  console.log(chalk.dim('  q/quit     ') + 'Exit walkthrough');
  console.log();
}
