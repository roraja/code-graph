#!/usr/bin/env node

/**
 * CodeGraph CLI — Main entry point.
 *
 * Registers all subcommands and parses arguments using Commander.
 * Each command is defined in its own module under `./commands/`.
 *
 * Usage:
 *   codegraph init          Initialize a new project
 *   codegraph index <dir>   Index a codebase
 *   codegraph discover      Discover scenarios
 *   codegraph trace <id>    Trace a scenario
 *   codegraph walk <id>     Interactive walkthrough
 *   codegraph correct <id>  Submit a correction
 *   codegraph query ...     Query the graph
 *   codegraph serve         Start the API server
 *   codegraph doctor        Check system health
 *   codegraph stats         Show graph statistics
 *   codegraph scenarios     List scenarios
 *
 * @module cli
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { registerInitCommand } from './commands/init.js';
import { registerIndexCommand } from './commands/index-cmd.js';
import { registerDiscoverCommand } from './commands/discover.js';
import { registerTraceCommand } from './commands/trace.js';
import { registerWalkCommand } from './commands/walk.js';
import { registerCorrectCommand } from './commands/correct.js';
import { registerQueryCommand } from './commands/query.js';
import { registerServeCommand } from './commands/serve.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerStatsCommand } from './commands/stats.js';
import { registerScenariosCommand } from './commands/scenarios.js';

/** Create and configure the CLI program. */
function createProgram(): Command {
  const program = new Command();

  program
    .name('codegraph')
    .description('CodeGraph — AI-powered code exploration and scenario tracing')
    .version('0.1.0')
    .option('-c, --config <path>', 'Path to .codegraph.yaml or project root')
    .option('-v, --verbose', 'Enable verbose output', false);

  // Register all commands
  registerInitCommand(program);
  registerIndexCommand(program);
  registerDiscoverCommand(program);
  registerTraceCommand(program);
  registerWalkCommand(program);
  registerCorrectCommand(program);
  registerQueryCommand(program);
  registerServeCommand(program);
  registerDoctorCommand(program);
  registerStatsCommand(program);
  registerScenariosCommand(program);

  // Show help by default when no command is given
  program.action(() => {
    program.outputHelp();
  });

  return program;
}

/**
 * Main entry point — parse arguments and run the appropriate command.
 */
async function main(): Promise<void> {
  const program = createProgram();

  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof Error) {
      console.error(chalk.red('✖ Fatal error:'), err.message);
    } else {
      console.error(chalk.red('✖ Fatal error:'), String(err));
    }
    process.exit(1);
  }
}

main();
