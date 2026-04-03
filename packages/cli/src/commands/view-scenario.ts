/**
 * `codegraph view` — Rich scenario viewer.
 *
 * Shows a detailed view of a scenario including summary, step table,
 * and optional full detail for a specific step.
 *
 * Supports `--format table|detail|json` for different output modes.
 *
 * @module cli/commands/view-scenario
 */

import { Command } from 'commander';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
  loadContext,
  handleError,
  startSpinner,
  gracefulExit,
  printScenarioSummary,
  printStepDetail,
  getMockScenarios,
  getMockSteps,
} from '../helpers.js';
import type { Scenario, ScenarioStep } from '@codegraph/core';

/**
 * Register the `view` command on the CLI program.
 */
export function registerViewScenarioCommand(program: Command): void {
  program
    .command('view <scenario-id>')
    .description('View a scenario with rich formatting')
    .option('--step <n>', 'Show full detail for a specific step number')
    .option('--format <format>', 'Output format: table, detail, json', 'table')
    .option('--mock', 'Use mock data (demo mode)', false)
    .action(async (scenarioId: string, opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;

      try {
        let scenario: Scenario | null = null;
        let steps: ScenarioStep[] = [];

        if (opts.mock) {
          const scenarios = getMockScenarios();
          scenario = scenarios.find((s) => s.id === scenarioId) ?? null;
          steps = getMockSteps(scenarioId);
        } else {
          const ctx = await loadContext(configPath);
          const spinner = startSpinner('Loading scenario...');
          scenario = await ctx.scenarioEngine.getScenario(scenarioId);
          if (scenario) {
            steps = await ctx.scenarioEngine.getSteps(scenarioId);
          }
          spinner.succeed('Scenario loaded');

          // Defer disconnect to after output
          if (!scenario) {
            console.error(chalk.red(`✖ Scenario not found: ${scenarioId}`));
            await gracefulExit(ctx.driver, 1);
            return;
          }

          renderScenario(scenario, steps, opts);
          await gracefulExit(ctx.driver, 0);
          return;
        }

        if (!scenario) {
          console.error(chalk.red(`✖ Scenario not found: ${scenarioId}`));
          process.exit(1);
        }

        renderScenario(scenario, steps, opts);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}

function renderScenario(
  scenario: Scenario,
  steps: ScenarioStep[],
  opts: { step?: string; format: string }
): void {
  // JSON format — AI-friendly
  if (opts.format === 'json') {
    const output = {
      scenario: {
        id: scenario.id,
        name: scenario.name,
        description: scenario.description,
        status: scenario.status,
        confidence: scenario.confidence,
        entryFunction: scenario.entryFunction,
        triggerCondition: scenario.triggerCondition,
        version: scenario.version,
        discoveredBy: scenario.discoveredBy,
        createdAt: scenario.createdAt,
        updatedAt: scenario.updatedAt,
        stepCount: steps.length,
      },
      steps: steps.map((s) => ({
        stepNumber: s.stepNumber,
        functionName: s.functionName,
        functionId: s.functionId,
        line: s.line,
        action: s.action,
        sourceCode: s.sourceCode,
        justification: s.justification,
        confidence: s.confidence,
        variableState: s.variableState,
        correctedBy: s.correctedBy,
        correctionNote: s.correctionNote,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  // Show specific step detail
  if (opts.step) {
    const stepNum = parseInt(opts.step, 10);
    const step = steps.find((s) => s.stepNumber === stepNum);
    if (!step) {
      console.error(chalk.red(`✖ Step ${stepNum} not found. Available: 1-${steps.length}`));
      return;
    }
    printScenarioSummary(scenario);
    console.log();
    printStepDetail(step, steps.length);
    return;
  }

  // Detail format — full step details
  if (opts.format === 'detail') {
    printScenarioSummary(scenario);
    console.log();
    if (steps.length === 0) {
      console.log(chalk.dim('  No steps traced yet.'));
      return;
    }
    for (const step of steps) {
      printStepDetail(step, steps.length);
    }
    return;
  }

  // Default: table format
  printScenarioSummary(scenario);
  console.log();

  if (steps.length === 0) {
    console.log(chalk.dim('  No steps traced yet.'));
    return;
  }

  const table = new Table({
    head: ['#', 'Function', 'Action', 'Line', 'Confidence', 'Justification'].map((h) => chalk.cyan(h)),
    colWidths: [5, 30, 16, 7, 12, 40],
    wordWrap: true,
  });

  for (const step of steps) {
    const conf = (step.confidence * 100).toFixed(0) + '%';
    const justification =
      step.justification.length > 60
        ? step.justification.substring(0, 57) + '...'
        : step.justification;

    table.push([
      String(step.stepNumber),
      step.functionName,
      step.action,
      String(step.line),
      conf,
      justification,
    ]);
  }

  console.log(table.toString());
  console.log();
  console.log(chalk.dim(`  Use --step <n> to see full detail for a specific step.`));
  console.log(chalk.dim(`  Use --format json for machine-readable output.`));
}
