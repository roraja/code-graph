/**
 * `codegraph init` — Initialize a new CodeGraph project.
 *
 * Creates a `.codegraph.yaml` configuration file with sensible defaults.
 * Prompts for project name, language, and Neo4j connection details.
 *
 * @module cli/commands/init
 */

import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import chalk from 'chalk';
import { stringify as yamlStringify } from 'yaml';

/**
 * Register the `init` command on the CLI program.
 *
 * @param program - The root Commander program instance
 */
export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize a new CodeGraph project')
    .option('--lang <language>', 'Primary language (ts or cpp)', 'ts')
    .option('--neo4j <uri>', 'Neo4j connection URI', 'bolt://localhost:7687')
    .option('--name <name>', 'Project name')
    .option('-f, --force', 'Overwrite existing .codegraph.yaml')
    .action(async (opts) => {
      const configPath = resolve(process.cwd(), '.codegraph.yaml');

      if (existsSync(configPath) && !opts.force) {
        console.error(
          chalk.red('✖ A .codegraph.yaml already exists.') +
            chalk.dim(' Use --force to overwrite.')
        );
        process.exit(1);
      }

      const projectName = opts.name ?? inferProjectName();
      const language = opts.lang as string;
      const neo4jUri = opts.neo4j as string;

      const config = buildDefaultConfig(projectName, language, neo4jUri);
      const yaml = yamlStringify(config, { indent: 2 });

      writeFileSync(configPath, yaml, 'utf-8');

      console.log(chalk.green('✔ Created .codegraph.yaml'));
      console.log();
      console.log(chalk.dim('  Project: ') + chalk.white(projectName));
      console.log(chalk.dim('  Language: ') + chalk.white(language));
      console.log(chalk.dim('  Neo4j: ') + chalk.white(neo4jUri));
      console.log();
      console.log(chalk.dim('Next steps:'));
      console.log(chalk.cyan('  codegraph doctor') + chalk.dim('   — check prerequisites'));
      console.log(chalk.cyan('  codegraph index .') + chalk.dim('  — index your codebase'));
    });
}

/**
 * Infer a project name from the current directory.
 *
 * @returns The base directory name as the project name
 */
function inferProjectName(): string {
  const cwd = process.cwd();
  return cwd.split('/').pop() ?? 'my-project';
}

/**
 * Build a default configuration object for a new project.
 *
 * @param name - The project name
 * @param language - The primary language ('ts' or 'cpp')
 * @param neo4jUri - The Neo4j connection URI
 * @returns A plain object representing the YAML config
 */
function buildDefaultConfig(
  name: string,
  language: string,
  neo4jUri: string
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    project: {
      name,
      languages: [language],
      rootDirs: ['src'],
      excludeDirs: ['node_modules', 'dist', '.git', 'build'],
    },
    neo4j: {
      uri: neo4jUri,
      username: 'neo4j',
      password: '${NEO4J_PASSWORD}',
      database: 'neo4j',
    },
    ai: {
      provider: 'openai',
      model: 'gpt-4-turbo',
      apiKey: '${OPENAI_API_KEY}',
      maxTokensPerRequest: 120000,
      temperature: 0.2,
    },
    tracing: {
      maxDepth: 50,
      maxStepsPerFunction: 200,
      boringFunctions: [],
      boringNamespaces: [],
      focusFunctions: [],
    },
    server: {
      port: 3000,
      host: '127.0.0.1',
    },
  };

  if (language === 'ts') {
    config.parser = { typescript: { tsconfig: 'tsconfig.json' } };
  } else if (language === 'cpp') {
    config.parser = { cpp: { compileCommands: 'build/compile_commands.json' } };
  }

  return config;
}
