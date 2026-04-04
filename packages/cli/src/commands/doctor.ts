/**
 * `codegraph doctor` — Check system health and prerequisites.
 *
 * Runs diagnostic checks for:
 * - Node.js version (requires >= 18)
 * - Neo4j connectivity
 * - AI API key configuration
 * - clangd availability (for C++ projects)
 *
 * @module cli/commands/doctor
 */

import { execSync } from 'node:child_process';
import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, GraphDriver } from '@codegraph/core';

/**
 * Register the `doctor` command on the CLI program.
 *
 * @param program - The root Commander program instance
 */
export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Check system health and prerequisites')
    .action(async (_opts, cmd) => {
      const configPath = cmd.parent?.opts().config;

      console.log(chalk.bold('CodeGraph Doctor'));
      console.log(chalk.dim('Checking system prerequisites...\n'));

      let allPassed = true;

      // 1. Node.js version
      const nodeVersion = process.version;
      const major = parseInt(nodeVersion.slice(1).split('.')[0]!, 10);
      if (major >= 18) {
        printCheck('pass', `Node.js ${nodeVersion}`);
      } else {
        printCheck('fail', `Node.js ${nodeVersion} (requires >= 18)`);
        allPassed = false;
      }

      // 2. Configuration file
      let config;
      try {
        config = loadConfig(configPath);
        printCheck('pass', 'codegraph.yaml found');
      } catch {
        printCheck('fail', 'codegraph.yaml not found');
        console.log(
          chalk.dim('    Run ') +
            chalk.cyan('codegraph init') +
            chalk.dim(' to create one.')
        );
        allPassed = false;
      }

      // 3. Neo4j connectivity
      if (config) {
        try {
          const driver = GraphDriver.create({
            uri: config.neo4j.uri,
            username: config.neo4j.username,
            password: config.neo4j.password,
            database: config.neo4j.database,
          });
          await driver.connect();
          await driver.disconnect();
          printCheck('pass', `Neo4j reachable at ${config.neo4j.uri}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          printCheck('fail', `Neo4j unreachable at ${config.neo4j.uri}`);
          console.log(chalk.dim(`    ${msg}`));
          allPassed = false;
        }
      } else {
        printCheck('skip', 'Neo4j connectivity (no config)');
      }

      // 4. AI API key
      if (config) {
        if (config.ai.provider === 'mock') {
          printCheck('pass', 'AI provider: mock (no API key needed)');
        } else if (config.ai.provider === 'copilot') {
          try {
            execSync('copilot --version 2>/dev/null', { encoding: 'utf-8' });
            printCheck('pass', 'AI provider: copilot (CLI found)');
          } catch {
            printCheck('warn', 'AI provider: copilot (CLI not found in PATH)');
          }
        } else if (config.ai.apiKey && config.ai.apiKey.length > 0) {
          printCheck('pass', `AI provider: ${config.ai.provider} (API key configured)`);
        } else {
          printCheck('warn', `AI provider: ${config.ai.provider} (no API key set)`);
          console.log(
            chalk.dim('    Set ') +
              chalk.cyan('OPENAI_API_KEY') +
              chalk.dim(' environment variable.')
          );
        }
      } else {
        printCheck('skip', 'AI API key (no config)');
      }

      // 5. clangd (for C++ projects)
      if (config?.project.languages.includes('cpp')) {
        // Try config path, then PATH, then common Chromium-bundled locations
        const clangdPath = config.parser.cpp?.clangdPath ?? 'clangd';
        const candidates = [
          clangdPath,
          'clangd',
          'third_party/llvm-build/Release+Asserts/bin/clangd',
        ];
        let found = false;
        for (const candidate of candidates) {
          try {
            const clangdVersion = execSync(`${candidate} --version 2>/dev/null`, {
              encoding: 'utf-8',
              cwd: process.cwd(),
            }).trim().split('\n')[0];
            printCheck('pass', `clangd: ${clangdVersion}`);
            found = true;
            break;
          } catch {
            // try next candidate
          }
        }
        if (!found) {
          printCheck('warn', 'clangd not found (needed for C++ parsing)');
          console.log(chalk.dim('    Set parser.cpp.clangdPath in .vscode/code-graph/codegraph.yaml'));
        }
      } else {
        printCheck('skip', 'clangd (not a C++ project)');
      }

      // 6. TypeScript compiler
      if (!config || config.project.languages.includes('ts')) {
        try {
          const tscVersion = execSync('npx tsc --version 2>/dev/null', {
            encoding: 'utf-8',
          }).trim();
          printCheck('pass', `TypeScript: ${tscVersion}`);
        } catch {
          printCheck('warn', 'TypeScript compiler not found');
        }
      }

      // Summary
      console.log();
      if (allPassed) {
        console.log(chalk.green.bold('✔ All checks passed!'));
      } else {
        console.log(chalk.yellow.bold('⚠ Some checks failed. See above for details.'));
      }
    });
}

/**
 * Print a formatted check result line.
 *
 * @param status - The check result status
 * @param message - The check description
 */
function printCheck(status: 'pass' | 'fail' | 'warn' | 'skip', message: string): void {
  switch (status) {
    case 'pass':
      console.log(chalk.green('  ✔ ') + message);
      break;
    case 'fail':
      console.log(chalk.red('  ✖ ') + message);
      break;
    case 'warn':
      console.log(chalk.yellow('  ⚠ ') + message);
      break;
    case 'skip':
      console.log(chalk.dim('  ○ ') + chalk.dim(message));
      break;
  }
}
