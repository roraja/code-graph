/**
 * `codegraph import` — Import a scenario from a JSON file.
 *
 * Accepts a JSON file previously exported with `codegraph export --format json`.
 * Creates the scenario and its steps in the graph database.
 *
 * @module cli/commands/import-scenario
 */

import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import chalk from 'chalk';
import {
  loadContext,
  handleError,
  startSpinner,
  gracefulExit,
} from '../helpers.js';
import type { ScenarioStep } from '@codegraph/core';

/** Expected shape of the imported JSON file */
interface ImportedScenario {
  _format?: string;
  scenario: {
    id?: string;
    name: string;
    description: string;
    status?: string;
    confidence?: number;
    entryFunction: string;
    triggerCondition: string;
    discoveredBy?: 'ai' | 'human';
    version?: number;
  };
  steps?: Array<{
    id: string;
    stepNumber: number;
    functionId: string;
    functionName: string;
    line: number;
    action: string;
    sourceCode?: string | null;
    justification: string;
    confidence: number;
    variableState: Record<string, unknown>;
    correctedBy?: string | null;
    correctionNote?: string | null;
  }>;
}

/**
 * Register the `import` command on the CLI program.
 */
export function registerImportScenarioCommand(program: Command): void {
  program
    .command('import <file>')
    .description('Import a scenario from a JSON file')
    .action(async (filePath: string, _opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;

      try {
        // Read and parse the JSON file
        const spinner = startSpinner(`Reading ${filePath}...`);
        let rawContent: string;
        try {
          rawContent = await readFile(filePath, 'utf-8');
        } catch (err) {
          spinner.fail(`Cannot read file: ${filePath}`);
          const msg = err instanceof Error ? err.message : String(err);
          console.error(chalk.red(`  ${msg}`));
          process.exit(1);
        }

        let data: ImportedScenario;
        try {
          data = JSON.parse(rawContent) as ImportedScenario;
        } catch {
          spinner.fail('Invalid JSON file');
          process.exit(1);
        }

        // Validate structure
        if (!data.scenario || !data.scenario.name || !data.scenario.entryFunction) {
          spinner.fail('Invalid scenario format: missing required fields (scenario.name, scenario.entryFunction)');
          process.exit(1);
        }
        spinner.succeed('File parsed successfully');

        // Connect and import
        const ctx = await loadContext(configPath);
        const importSpinner = startSpinner('Importing scenario...');

        const created = await ctx.scenarioEngine.createScenario({
          name: data.scenario.name,
          description: data.scenario.description,
          entryFunction: data.scenario.entryFunction,
          triggerCondition: data.scenario.triggerCondition,
          discoveredBy: data.scenario.discoveredBy ?? 'human',
          confidence: data.scenario.confidence ?? 1.0,
        });

        importSpinner.succeed(`Created scenario: ${chalk.cyan(created.name)} (${chalk.dim(created.id)})`);

        // Import steps if present
        if (data.steps && data.steps.length > 0) {
          const stepSpinner = startSpinner(`Importing ${data.steps.length} steps...`);
          const stepsToSave: Omit<ScenarioStep, 'scenarioId'>[] = data.steps.map((s) => ({
            id: s.id,
            stepNumber: s.stepNumber,
            functionId: s.functionId,
            functionName: s.functionName,
            line: s.line,
            action: s.action as ScenarioStep['action'],
            justification: s.justification,
            confidence: s.confidence,
            variableState: s.variableState,
            sourceCode: s.sourceCode ?? undefined,
            correctedBy: s.correctedBy ?? undefined,
            correctionNote: s.correctionNote ?? undefined,
          }));

          await ctx.scenarioEngine.saveSteps(created.id, stepsToSave);
          stepSpinner.succeed(`Imported ${stepsToSave.length} steps`);
        }

        console.log();
        console.log(chalk.green('✔ Import complete'));
        console.log(chalk.dim(`  View with: codegraph view ${created.id}`));

        await gracefulExit(ctx.driver, 0);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}
