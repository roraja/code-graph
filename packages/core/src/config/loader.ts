/**
 * Configuration loader for CodeGraph.
 *
 * Loads project configuration from `.codegraph.yaml` in the project root.
 * Supports environment variable substitution for sensitive values.
 *
 * @module config/loader
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/** Parser-specific configuration for C++ projects */
const CppParserConfigSchema = z.object({
  compileCommands: z.string().optional(),
  clangdPath: z.string().default('/usr/bin/clangd'),
});

/** Parser-specific configuration for TypeScript projects */
const TsParserConfigSchema = z.object({
  tsconfig: z.string().default('tsconfig.json'),
});

/** Neo4j connection configuration */
const Neo4jConfigSchema = z.object({
  uri: z.string().default('bolt://localhost:7687'),
  username: z.string().default('neo4j'),
  password: z.string().default('codegraph'),
  database: z.string().default('neo4j'),
});

/** AI provider configuration */
const AIConfigSchema = z.object({
  provider: z.enum(['openai', 'mock']).default('mock'),
  model: z.string().default('gpt-4-turbo'),
  apiKey: z.string().optional(),
  maxTokensPerRequest: z.number().default(120000),
  temperature: z.number().default(0.2),
});

/** Tracing configuration */
const TracingConfigSchema = z.object({
  maxDepth: z.number().default(50),
  maxStepsPerFunction: z.number().default(200),
  boringFunctions: z.array(z.string()).default([]),
  boringNamespaces: z.array(z.string()).default([]),
  focusFunctions: z.array(z.string()).default([]),
});

/** Server configuration */
const ServerConfigSchema = z.object({
  port: z.number().default(3000),
  host: z.string().default('127.0.0.1'),
});

/** Full CodeGraph configuration schema */
const CodeGraphConfigSchema = z.object({
  project: z.object({
    name: z.string(),
    languages: z.array(z.string()).default(['ts']),
    rootDirs: z.array(z.string()).default(['src']),
    excludeDirs: z.array(z.string()).default(['node_modules', 'dist', '.git']),
  }),
  neo4j: Neo4jConfigSchema.default({}),
  parser: z.object({
    cpp: CppParserConfigSchema.optional(),
    typescript: TsParserConfigSchema.optional(),
  }).default({}),
  ai: AIConfigSchema.default({}),
  tracing: TracingConfigSchema.default({}),
  server: ServerConfigSchema.default({}),
});

/** Validated CodeGraph configuration type */
export type CodeGraphConfig = z.infer<typeof CodeGraphConfigSchema>;

/**
 * Substitute environment variable references in a string.
 * Replaces `${ENV_VAR_NAME}` with the value of the environment variable.
 */
function substituteEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
    return process.env[varName] ?? '';
  });
}

/** Recursively substitute env vars in all string values of an object */
function substituteEnvVarsDeep(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return substituteEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVarsDeep);
  }
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVarsDeep(value);
    }
    return result;
  }
  return obj;
}

/**
 * Load CodeGraph configuration from a `.codegraph.yaml` file.
 *
 * @param projectRoot - The directory to search for `.codegraph.yaml`.
 *                      Defaults to current working directory.
 * @returns Validated configuration object
 * @throws If the config file is missing or invalid
 */
export function loadConfig(projectRoot?: string): CodeGraphConfig {
  const root = projectRoot ?? process.cwd();
  const configPath = resolve(root, '.codegraph.yaml');

  if (!existsSync(configPath)) {
    throw new Error(
      `No .codegraph.yaml found in ${root}. Run 'codegraph init' to create one.`
    );
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = parseYaml(raw);
  const substituted = substituteEnvVarsDeep(parsed);
  return CodeGraphConfigSchema.parse(substituted);
}

/**
 * Create a default configuration object (useful for `codegraph init`).
 */
export function createDefaultConfig(options: {
  projectName: string;
  languages: string[];
  neo4jUri?: string;
}): CodeGraphConfig {
  return CodeGraphConfigSchema.parse({
    project: {
      name: options.projectName,
      languages: options.languages,
    },
    neo4j: {
      uri: options.neo4jUri ?? 'bolt://localhost:7687',
    },
  });
}

/**
 * Serialize a configuration to YAML string for writing to file.
 */
export function serializeConfig(config: CodeGraphConfig): string {
  const { stringify } = require('yaml') as typeof import('yaml');
  return stringify(config, { indent: 2 });
}

/**
 * Find the project root by searching up for `.codegraph.yaml`.
 * Returns null if not found.
 */
export function findProjectRoot(startDir?: string): string | null {
  let dir = startDir ?? process.cwd();
  const root = '/';

  while (dir !== root) {
    if (existsSync(resolve(dir, '.codegraph.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}
