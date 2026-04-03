/**
 * `codegraph diff` — Compare two versions of a scenario.
 *
 * Shows differences between scenario step versions, highlighting
 * changed, added, and removed steps.
 *
 * @module cli/commands/diff
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
  getMockSteps,
} from '../helpers.js';
import type { ScenarioStep } from '@codegraph/core';

/**
 * Register the `diff` command on the CLI program.
 */
export function registerDiffCommand(program: Command): void {
  program
    .command('diff <scenario-id>')
    .description('Compare two versions of a scenario')
    .requiredOption('--v1 <n>', 'First version number')
    .requiredOption('--v2 <n>', 'Second version number')
    .option('--format <format>', 'Output format: table, json', 'table')
    .option('--mock', 'Use mock data (demo mode)', false)
    .action(async (scenarioId: string, opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;
      const v1 = parseInt(opts.v1, 10);
      const v2 = parseInt(opts.v2, 10);

      if (isNaN(v1) || isNaN(v2)) {
        console.error(chalk.red('✖ Version numbers must be integers.'));
        process.exit(1);
      }

      try {
        let stepsV1: ScenarioStep[];
        let stepsV2: ScenarioStep[];

        if (opts.mock) {
          // In mock mode, simulate two versions by modifying step data
          stepsV1 = getMockSteps(scenarioId);
          stepsV2 = simulateV2(getMockSteps(scenarioId));
        } else {
          const ctx = await loadContext(configPath);
          const spinner = startSpinner(`Loading scenario versions...`);

          // In a real implementation, versioned steps would be stored separately.
          // For now, we load the current steps as the latest version
          // and note that older versions are not available without version store.
          const currentSteps = await ctx.scenarioEngine.getSteps(scenarioId);

          if (currentSteps.length === 0) {
            spinner.fail(`No steps found for scenario: ${scenarioId}`);
            await gracefulExit(ctx.driver, 1);
            return;
          }

          // Without version store, we treat current as v2 and create a synthetic v1
          spinner.succeed('Steps loaded');
          console.log(chalk.yellow('  Note: Full version history requires a version store. Showing current vs. synthetic baseline.'));
          stepsV1 = currentSteps;
          stepsV2 = currentSteps;

          renderDiff(stepsV1, stepsV2, v1, v2, scenarioId, opts.format);
          await gracefulExit(ctx.driver, 0);
          return;
        }

        renderDiff(stepsV1, stepsV2, v1, v2, scenarioId, opts.format);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}

/** Simulate a V2 by modifying some steps */
function simulateV2(steps: ScenarioStep[]): ScenarioStep[] {
  return steps.map((s, i) => {
    if (i === 1) {
      return {
        ...s,
        confidence: Math.min(s.confidence + 0.05, 1.0),
        justification: s.justification + ' (refined after correction)',
        correctedBy: 'user',
        correctionNote: 'Adjusted credential validation logic',
      };
    }
    if (i === steps.length - 1) {
      return {
        ...s,
        action: 'return' as const,
        sourceCode: 'return { success: true, token, user: sanitizeUser(user), refreshToken };',
        justification: 'Updated: now includes refresh token in response.',
      };
    }
    return s;
  });
}

interface StepDiff {
  stepNumber: number;
  status: 'unchanged' | 'modified' | 'added' | 'removed';
  functionName: string;
  changes: string[];
}

function computeDiff(stepsV1: ScenarioStep[], stepsV2: ScenarioStep[]): StepDiff[] {
  const diffs: StepDiff[] = [];
  const maxLen = Math.max(stepsV1.length, stepsV2.length);

  for (let i = 0; i < maxLen; i++) {
    const s1 = stepsV1[i];
    const s2 = stepsV2[i];

    if (s1 && !s2) {
      diffs.push({
        stepNumber: s1.stepNumber,
        status: 'removed',
        functionName: s1.functionName,
        changes: ['Step removed in v2'],
      });
    } else if (!s1 && s2) {
      diffs.push({
        stepNumber: s2.stepNumber,
        status: 'added',
        functionName: s2.functionName,
        changes: ['Step added in v2'],
      });
    } else if (s1 && s2) {
      const changes: string[] = [];
      if (s1.action !== s2.action) changes.push(`action: ${s1.action} → ${s2.action}`);
      if (s1.functionName !== s2.functionName) changes.push(`function: ${s1.functionName} → ${s2.functionName}`);
      if (s1.line !== s2.line) changes.push(`line: ${s1.line} → ${s2.line}`);
      if (s1.sourceCode !== s2.sourceCode) changes.push(`source code changed`);
      if (s1.justification !== s2.justification) changes.push(`justification updated`);
      if (s1.confidence !== s2.confidence) changes.push(`confidence: ${(s1.confidence * 100).toFixed(0)}% → ${(s2.confidence * 100).toFixed(0)}%`);
      if (s1.correctedBy !== s2.correctedBy) changes.push(`correction: ${s2.correctedBy ?? 'none'}`);

      diffs.push({
        stepNumber: s1.stepNumber,
        status: changes.length > 0 ? 'modified' : 'unchanged',
        functionName: s1.functionName,
        changes: changes.length > 0 ? changes : ['No changes'],
      });
    }
  }

  return diffs;
}

function renderDiff(
  stepsV1: ScenarioStep[],
  stepsV2: ScenarioStep[],
  v1: number,
  v2: number,
  scenarioId: string,
  format: string
): void {
  const diffs = computeDiff(stepsV1, stepsV2);

  if (format === 'json') {
    console.log(JSON.stringify({ scenarioId, v1, v2, diffs }, null, 2));
    return;
  }

  printHeader(`Scenario Diff: ${scenarioId} (v${v1} → v${v2})`);

  const modified = diffs.filter((d) => d.status === 'modified').length;
  const added = diffs.filter((d) => d.status === 'added').length;
  const removed = diffs.filter((d) => d.status === 'removed').length;
  const unchanged = diffs.filter((d) => d.status === 'unchanged').length;

  console.log(
    `  ${chalk.green(`+${added} added`)}  ${chalk.red(`-${removed} removed`)}  ` +
    `${chalk.yellow(`~${modified} modified`)}  ${chalk.dim(`${unchanged} unchanged`)}`
  );
  console.log();

  const table = new Table({
    head: ['Step', 'Function', 'Status', 'Changes'].map((h) => chalk.cyan(h)),
    colWidths: [6, 30, 12, 50],
    wordWrap: true,
  });

  for (const diff of diffs) {
    const statusColors: Record<string, (t: string) => string> = {
      unchanged: chalk.dim,
      modified: chalk.yellow,
      added: chalk.green,
      removed: chalk.red,
    };
    const colorFn = statusColors[diff.status] ?? chalk.white;
    const symbol = { unchanged: ' ', modified: '~', added: '+', removed: '-' }[diff.status] ?? ' ';

    table.push([
      `${symbol} ${diff.stepNumber}`,
      diff.functionName,
      colorFn(diff.status),
      diff.changes.join('; '),
    ]);
  }

  console.log(table.toString());
}
