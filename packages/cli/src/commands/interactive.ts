/**
 * `codegraph interactive` — Alias for the explore command.
 *
 * Provides a quick way to launch the interactive menu.
 * Equivalent to `codegraph explore`.
 *
 * @module cli/commands/interactive
 */

import { Command } from 'commander';
import { registerExploreCommand } from './explore.js';

/**
 * Register the `interactive` command on the CLI program.
 *
 * This is an alias for `explore`. The actual explore command handles
 * all the interactive menu logic.
 */
export function registerInteractiveCommand(program: Command): void {
  // The explore command is already registered separately.
  // Register "interactive" as a lightweight alias.
  program
    .command('interactive')
    .description('Interactive exploration menu (alias for explore)')
    .option('--mock', 'Use mock data (demo mode, no Neo4j required)', false)
    .action(async (opts, cmd) => {
      // Delegate to the explore command by invoking it programmatically
      const configPath = cmd.parent?.opts().config;
      const args = ['node', 'codegraph', 'explore'];
      if (opts.mock) args.push('--mock');
      if (configPath) args.push('--config', configPath);

      // Find the explore command and invoke its action
      const exploreCmd = cmd.parent?.commands?.find(
        (c: Command) => c.name() === 'explore'
      );
      if (exploreCmd) {
        await exploreCmd.parseAsync(args);
      } else {
        // Fallback: register and run explore directly
        const sub = new Command();
        registerExploreCommand(sub);
        await sub.parseAsync(args);
      }
    });
}
