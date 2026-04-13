/**
 * `codegraph serve` — Start the CodeGraph API server and web UI.
 *
 * Launches the @codegraph/server package which provides a GraphQL
 * and REST API for interacting with the code graph.
 *
 * If no `.codegraph.yaml` exists, starts in **light mode** — only
 * serves the CodeWalk viewer and REST API, no Neo4j or GraphQL required.
 *
 * @module cli/commands/serve
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { handleError } from '../helpers.js';
import { findProjectRoot, loadConfig, type CodeGraphConfig } from '@codegraph/core';

/**
 * Register the `serve` command on the CLI program.
 *
 * @param program - The root Commander program instance
 */
export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the API server and web UI (works without config for browsing codewalks)')
    .option('-p, --port <port>', 'Port to listen on', '3000')
    .option('--host <host>', 'Host to bind to', '127.0.0.1')
    .action(async (opts, cmd) => {
      const verbose = cmd.parent?.opts().verbose ?? false;
      const configPath = cmd.parent?.opts().config;
      const port = parseInt(opts.port, 10);
      const host = opts.host as string;

      try {
        // Try to load config — if it doesn't exist, run in light mode
        let config: CodeGraphConfig | null = null;
        try {
          config = loadConfig(configPath);
        } catch {
          // No config found — that's OK, we'll use light mode
        }

        // Dynamically import the server package
        let serverModule: Record<string, unknown>;
        try {
          serverModule = await import('@codegraph/server') as Record<string, unknown>;
        } catch {
          console.error(chalk.red('✖ @codegraph/server is not installed or not built.'));
          console.error(
            chalk.dim('  Run ') +
              chalk.cyan('npm run build') +
              chalk.dim(' in packages/server/ first.')
          );
          process.exit(1);
        }

        const projectRoot = configPath ?? findProjectRoot() ?? process.cwd();

        if (config) {
          // ---- Full mode: config + Neo4j + GraphQL ----
          const startServer = serverModule.startServer as
            (config: CodeGraphConfig, projectRoot?: string) => Promise<unknown>;

          const serverConfig = {
            ...config,
            server: { ...config.server, port, host },
          };

          console.log(chalk.cyan('🚀 Starting CodeGraph server...'));
          console.log(chalk.dim(`  Host:  ${host}`));
          console.log(chalk.dim(`  Port:  ${port}`));
          console.log();

          await startServer(serverConfig, projectRoot);

          console.log();
          console.log(
            chalk.green('✔ Server running at ') +
              chalk.bold.underline(`http://${host}:${port}`)
          );
          console.log(
            chalk.dim('  GraphQL:   ') +
              chalk.underline(`http://${host}:${port}/graphql`)
          );
          console.log(
            chalk.dim('  REST API:  ') +
              chalk.underline(`http://${host}:${port}/api`)
          );
          console.log(
            chalk.dim('  CodeWalks: ') +
              chalk.underline(`http://${host}:${port}/codewalks`)
          );
        } else {
          // ---- Light mode: no config, no Neo4j — just serve codewalks ----
          const startLightServer = serverModule.startLightServer as
            (projectRoot: string, port: number, host: string) => Promise<unknown>;

          console.log(chalk.cyan('🚀 Starting CodeGraph server (light mode)...'));
          console.log(chalk.dim('  No codegraph.yaml found — serving codewalks only.'));
          console.log(chalk.dim(`  Project: ${projectRoot}`));
          console.log(chalk.dim(`  Host:    ${host}`));
          console.log(chalk.dim(`  Port:    ${port}`));
          console.log();

          await startLightServer(projectRoot, port, host);

          console.log();
          console.log(
            chalk.green('✔ Server running at ') +
              chalk.bold.underline(`http://${host}:${port}`)
          );
          console.log(
            chalk.dim('  CodeWalks: ') +
              chalk.underline(`http://${host}:${port}/codewalks`)
          );
          console.log();
          console.log(
            chalk.dim('  Tip: run ') +
              chalk.cyan('codegraph init') +
              chalk.dim(' to enable full mode with Neo4j + GraphQL.')
          );
        }

        console.log();
        console.log(chalk.dim('Press Ctrl+C to stop.'));
      } catch (err) {
        handleError(err, verbose);
        process.exit(1);
      }
    });
}
