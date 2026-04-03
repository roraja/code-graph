/**
 * `codegraph index` — Index a codebase into the graph database.
 *
 * Parses the given directory using the TypeScript parser, then writes
 * the resulting nodes and edges to Neo4j via CodeIndexer.
 * Shows progress with an ora spinner.
 *
 * @module cli/commands/index-cmd
 */

import { resolve } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { TypeScriptParser, type ParseResult } from '@codegraph/core';
import {
  loadContext,
  handleError,
  startSpinner,
  formatDuration,
  gracefulExit,
} from '../helpers.js';

/**
 * Register the `index` command on the CLI program.
 *
 * @param program - The root Commander program instance
 */
export function registerIndexCommand(program: Command): void {
  program
    .command('index <directory>')
    .description('Index a codebase directory into the graph database')
    .option('--incremental', 'Only re-index changed files', false)
    .action(async (directory: string, opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;

      try {
        const ctx = await loadContext(configPath);
        const targetDir = resolve(process.cwd(), directory);

        // Initialize schema (idempotent)
        const schemaSpinner = startSpinner('Initializing graph schema...');
        await ctx.schema.initialize();
        schemaSpinner.succeed('Graph schema ready');

        // Parse the directory
        const parseSpinner = startSpinner(`Parsing ${chalk.cyan(targetDir)}...`);
        const parser = new TypeScriptParser();
        const startTime = Date.now();
        const results = await parser.parseDirectory(targetDir, {
          exclude: ctx.config.project.excludeDirs,
        });
        const parseTime = Date.now() - startTime;
        parseSpinner.succeed(
          `Parsed ${chalk.bold(String(results.length))} files in ${formatDuration(parseTime)}`
        );

        // Index into Neo4j
        const indexSpinner = startSpinner('Writing to graph database...');
        const indexStart = Date.now();
        await ctx.indexer.indexDirectory(results);
        const indexTime = Date.now() - indexStart;
        indexSpinner.succeed(
          `Indexed ${chalk.bold(String(results.length))} files in ${formatDuration(indexTime)}`
        );

        // Summary
        const totalFunctions = results.reduce((sum: number, r: ParseResult) => sum + r.functions.length, 0);
        const totalClasses = results.reduce((sum: number, r: ParseResult) => sum + r.classes.length, 0);
        const totalCalls = results.reduce((sum: number, r: ParseResult) => sum + r.calls.length, 0);

        console.log();
        console.log(chalk.green('✔ Indexing complete'));
        console.log(chalk.dim('  Functions: ') + chalk.white(String(totalFunctions)));
        console.log(chalk.dim('  Classes:   ') + chalk.white(String(totalClasses)));
        console.log(chalk.dim('  Call edges: ') + chalk.white(String(totalCalls)));

        await gracefulExit(ctx.driver, 0);
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}
