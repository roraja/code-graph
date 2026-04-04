/**
 * `codegraph serve` — Start the CodeGraph API server and web UI.
 *
 * Launches the @codegraph/server package which provides a GraphQL
 * and REST API for interacting with the code graph.
 *
 * @module cli/commands/serve
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { loadCLIConfig, handleError } from '../helpers.js';
import { findProjectRoot, type CodeGraphConfig } from '@codegraph/core';

/**
 * Register the `serve` command on the CLI program.
 *
 * @param program - The root Commander program instance
 */
export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the API server and web UI')
    .option('-p, --port <port>', 'Port to listen on')
    .option('--host <host>', 'Host to bind to')
    .action(async (opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;

      try {
        const config = loadCLIConfig(configPath);
        const port = opts.port ? parseInt(opts.port, 10) : config.server.port;
        const host = (opts.host as string) ?? config.server.host;

        console.log(chalk.cyan('🚀 Starting CodeGraph server...'));
        console.log(chalk.dim(`  Host:  ${host}`));
        console.log(chalk.dim(`  Port:  ${port}`));
        console.log();

        // Dynamically import the server package
        let startServer: (config: CodeGraphConfig, projectRoot?: string) => Promise<unknown>;
        try {
          const serverModule = await import('@codegraph/server');
          startServer = serverModule.startServer ?? serverModule.default;
        } catch {
          console.error(chalk.red('✖ @codegraph/server is not installed or not built.'));
          console.error(
            chalk.dim('  Run ') +
              chalk.cyan('npm run build') +
              chalk.dim(' in packages/server/ first.')
          );
          process.exit(1);
        }

        // Override server config with CLI options
        const serverConfig = {
          ...config,
          server: { ...config.server, port, host },
        };

        await startServer(serverConfig, configPath ?? findProjectRoot() ?? undefined);

        console.log();
        console.log(
          chalk.green('✔ Server running at ') +
            chalk.bold.underline(`http://${host}:${port}`)
        );
        console.log(
          chalk.dim('  GraphQL:  ') +
            chalk.underline(`http://${host}:${port}/graphql`)
        );
        console.log(
          chalk.dim('  REST API: ') +
            chalk.underline(`http://${host}:${port}/api`)
        );
        console.log();
        console.log(chalk.dim('Press Ctrl+C to stop.'));
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}
