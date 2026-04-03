/**
 * `codegraph functions` — Browse and search functions in the graph.
 *
 * Lists functions with filtering by search query, file path, or class name.
 * Displays results in a formatted table.
 *
 * Supports --format json for machine consumption.
 *
 * @module cli/commands/functions
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
  getMockFunctions,
} from '../helpers.js';
import type { FunctionNode } from '@codegraph/core';

/**
 * Register the `functions` command on the CLI program.
 */
export function registerFunctionsCommand(program: Command): void {
  program
    .command('functions')
    .description('Browse and search functions in the code graph')
    .option('--search <query>', 'Search functions by name')
    .option('--file <path>', 'Filter by file path')
    .option('--class <name>', 'Filter by class name')
    .option('--format <format>', 'Output format: table, json', 'table')
    .option('--mock', 'Use mock data (demo mode)', false)
    .action(async (opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;

      try {
        let functions: FunctionNode[];

        if (opts.mock) {
          functions = getMockFunctions();
        } else {
          const ctx = await loadContext(configPath);
          const spinner = startSpinner('Searching functions...');
          functions = await ctx.queryEngine.searchFunctions(opts.search ?? '', 100);
          spinner.succeed(`Found ${functions.length} function(s)`);

          // Apply filters and render, then exit
          functions = applyFilters(functions, opts);
          renderFunctions(functions, opts.format);
          await gracefulExit(ctx.driver, 0);
          return;
        }

        functions = applyFilters(functions, opts);
        renderFunctions(functions, opts.format);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}

function applyFilters(
  functions: FunctionNode[],
  opts: { search?: string; file?: string; class?: string }
): FunctionNode[] {
  let filtered = functions;

  if (opts.search) {
    const q = opts.search.toLowerCase();
    filtered = filtered.filter(
      (f) => f.name.toLowerCase().includes(q) || f.qualifiedName.toLowerCase().includes(q)
    );
  }

  if (opts.file) {
    const fp = opts.file.toLowerCase();
    filtered = filtered.filter((f) => f.filePath.toLowerCase().includes(fp));
  }

  if (opts.class) {
    const cls = opts.class.toLowerCase();
    filtered = filtered.filter((f) => {
      const parts = f.qualifiedName.split('.');
      return parts.length > 1 && parts[0]!.toLowerCase().includes(cls);
    });
  }

  return filtered;
}

function renderFunctions(functions: FunctionNode[], format: string): void {
  if (format === 'json') {
    const output = functions.map((f) => ({
      id: f.id,
      name: f.name,
      qualifiedName: f.qualifiedName,
      filePath: f.filePath,
      startLine: f.startLine,
      endLine: f.endLine,
      signature: f.signature,
      returnType: f.returnType,
      parameters: f.parameters,
      isAsync: f.isAsync,
      isExported: f.isExported,
      visibility: f.visibility,
      documentation: f.documentation,
    }));
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (functions.length === 0) {
    console.log(chalk.yellow('  No functions found matching the criteria.'));
    return;
  }

  printHeader('Functions');
  const table = new Table({
    head: ['Name', 'File', 'Line', 'Params', 'Return', 'Async', 'Exported'].map((h) => chalk.cyan(h)),
    colWidths: [30, 28, 7, 20, 18, 7, 10],
    wordWrap: true,
  });

  for (const f of functions) {
    const params = f.parameters.map((p) => `${p.name}: ${p.type}`).join(', ');
    const paramsDisplay = params.length > 25 ? params.substring(0, 22) + '...' : params;
    table.push([
      f.qualifiedName,
      f.filePath,
      String(f.startLine),
      paramsDisplay,
      f.returnType,
      f.isAsync ? '✔' : '',
      f.isExported ? '✔' : '',
    ]);
  }

  console.log(table.toString());
  console.log(chalk.dim(`  ${functions.length} function(s) listed.`));
  console.log(chalk.dim('  Use --format json for machine-readable output.'));
}
