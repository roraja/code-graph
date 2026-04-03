/**
 * Shared helpers for the CodeGraph CLI.
 *
 * Provides utility functions for loading configuration, creating engine
 * instances, formatting errors, and connecting to the graph database.
 *
 * @module cli/helpers
 */

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import {
  loadConfig,
  GraphDriver,
  GraphSchema,
  CodeIndexer,
  QueryEngine,
  ScenarioEngine,
  ScenarioTracer,
  CorrectionEngine,
  ScenarioDiscoveryAgent,
  PathTracerAgent,
  VariableImaginerAgent,
  JustifierAgent,
  CorrectionInterpreterAgent,
  TypeScriptParser,
  type CodeGraphConfig,
  type AIProvider,
} from '@codegraph/core';

/**
 * Loaded context containing all initialized engines and drivers.
 * Returned by {@link loadContext} for use by CLI commands.
 */
export interface CLIContext {
  config: CodeGraphConfig;
  driver: GraphDriver;
  schema: GraphSchema;
  indexer: CodeIndexer;
  queryEngine: QueryEngine;
  scenarioEngine: ScenarioEngine;
  aiProvider: AIProvider;
}

/**
 * Extended context that also includes the scenario tracer and correction engine.
 * Requires AI provider to be configured.
 */
export interface FullCLIContext extends CLIContext {
  scenarioTracer: ScenarioTracer;
  correctionEngine: CorrectionEngine;
  discoveryAgent: ScenarioDiscoveryAgent;
}

/**
 * Load the CodeGraph configuration from disk.
 *
 * @param configPath - Optional path to the project root or config file
 * @returns The validated configuration
 */
export function loadCLIConfig(configPath?: string): CodeGraphConfig {
  try {
    return loadConfig(configPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red('✖ Configuration error:'), message);
    console.error(
      chalk.dim('  Run ') +
        chalk.cyan('codegraph init') +
        chalk.dim(' to create a .codegraph.yaml file.')
    );
    process.exit(1);
  }
}

/**
 * Create a GraphDriver from config and connect to Neo4j.
 *
 * @param config - The CodeGraph configuration
 * @returns Connected GraphDriver instance
 */
export async function connectDriver(config: CodeGraphConfig): Promise<GraphDriver> {
  const driver = GraphDriver.create({
    uri: config.neo4j.uri,
    username: config.neo4j.username,
    password: config.neo4j.password,
    database: config.neo4j.database,
  });
  await driver.connect();
  return driver;
}

/**
 * Create an AIProvider by dynamically importing the factory from core.
 *
 * @param config - The CodeGraph configuration
 * @returns An AIProvider instance
 */
async function createProvider(config: CodeGraphConfig): Promise<AIProvider> {
  // The createAIProvider factory lives in the ai/agent module of core.
  // We dynamically import it to avoid depending on non-public API at the type level.
  const agentModule = await import('@codegraph/core') as Record<string, unknown>;
  const factory = (agentModule as { createAIProvider?: (cfg: unknown) => AIProvider }).createAIProvider;

  if (typeof factory === 'function') {
    return factory({
      provider: config.ai.provider,
      model: config.ai.model,
      apiKey: config.ai.apiKey,
      maxTokens: config.ai.maxTokensPerRequest,
      temperature: config.ai.temperature,
    });
  }

  // Fallback: if createAIProvider is not available, throw an informative error.
  throw new Error(
    'createAIProvider is not exported from @codegraph/core. ' +
    'Add `export { createAIProvider } from \'./ai/agent.js\';` to core/src/index.ts.'
  );
}

/**
 * Create the base CLI context: load config, connect to Neo4j, and
 * instantiate core engines.
 *
 * @param configPath - Optional path override for configuration
 * @returns Initialized CLI context
 */
export async function loadContext(configPath?: string): Promise<CLIContext> {
  const config = loadCLIConfig(configPath);
  const driver = await connectDriver(config);
  const schema = new GraphSchema(driver);
  const indexer = new CodeIndexer(driver);
  const queryEngine = new QueryEngine(driver);
  const scenarioEngine = new ScenarioEngine(driver, queryEngine);

  const aiProvider = await createProvider(config);

  return { config, driver, schema, indexer, queryEngine, scenarioEngine, aiProvider };
}

/**
 * Create a full CLI context including AI-powered engines.
 *
 * @param configPath - Optional path override for configuration
 * @returns Fully initialized CLI context with AI agents
 */
export async function loadFullContext(configPath?: string): Promise<FullCLIContext> {
  const ctx = await loadContext(configPath);

  const parser = new TypeScriptParser();
  const pathTracer = new PathTracerAgent(ctx.aiProvider);
  const variableImaginer = new VariableImaginerAgent(ctx.aiProvider);
  const justifier = new JustifierAgent(ctx.aiProvider);
  const discoveryAgent = new ScenarioDiscoveryAgent(ctx.aiProvider);
  const interpreter = new CorrectionInterpreterAgent(ctx.aiProvider);

  const scenarioTracer = new ScenarioTracer(
    parser,
    ctx.queryEngine,
    pathTracer,
    variableImaginer,
    justifier
  );

  const correctionEngine = new CorrectionEngine(
    ctx.driver,
    ctx.scenarioEngine,
    scenarioTracer,
    interpreter
  );

  return { ...ctx, scenarioTracer, correctionEngine, discoveryAgent };
}

/**
 * Format and display an error message with chalk styling.
 *
 * @param err - The error to display
 * @param verbose - Whether to show the full stack trace
 */
export function handleError(err: unknown, verbose = false): void {
  if (err instanceof Error) {
    console.error(chalk.red('✖ Error:'), err.message);
    if (verbose && err.stack) {
      console.error(chalk.dim(err.stack));
    }
  } else {
    console.error(chalk.red('✖ Error:'), String(err));
  }
}

/**
 * Gracefully disconnect the graph driver and exit.
 *
 * @param driver - The graph driver to disconnect
 * @param code - Exit code (default: 0)
 */
export async function gracefulExit(driver: GraphDriver, code = 0): Promise<void> {
  try {
    await driver.disconnect();
  } catch {
    // Ignore disconnect errors during shutdown
  }
  process.exit(code);
}

/**
 * Create and start an ora spinner with consistent styling.
 *
 * @param text - The spinner message text
 * @returns The started spinner instance
 */
export function startSpinner(text: string): Ora {
  return ora({ text, color: 'cyan' }).start();
}

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string like "1.2s" or "350ms"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Print a section header with chalk styling.
 *
 * @param title - The section title
 */
export function printHeader(title: string): void {
  console.log();
  console.log(chalk.bold.underline(title));
  console.log();
}
