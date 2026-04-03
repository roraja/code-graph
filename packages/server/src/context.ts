/**
 * Server Context Factory — creates and manages the runtime context
 * for the CodeGraph API server.
 *
 * Responsible for initialising the Neo4j driver, parser, AI agents,
 * and domain engines, then bundling them into a single context object
 * that resolvers and route handlers consume.
 *
 * @module server/context
 */

import {
  type CodeGraphConfig,
  GraphDriver,
  GraphSchema,
  CodeIndexer,
  QueryEngine,
  TypeScriptParser,
  ScenarioEngine,
  ScenarioTracer,
  CorrectionEngine,
  ScenarioDiscoveryAgent,
  PathTracerAgent,
  VariableImaginerAgent,
  JustifierAgent,
  CorrectionInterpreterAgent,
  AIAgent,
  type ICodeParser,
  type AIProvider,
  type AIConfig,
  logger,
} from '@codegraph/core';

/**
 * Build an {@link AIProvider} from the project's AI configuration.
 *
 * The `createAIProvider` factory is defined in `@codegraph/core` but is
 * not re-exported from its public barrel, so we replicate the trivial
 * construction logic here.
 */
function buildAIProvider(config: CodeGraphConfig): AIProvider {
  const aiCfg = config.ai;
  if (aiCfg.provider === 'openai') {
    // Lazy-require so we don't fail when openai is not installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { OpenAIProvider } = require('@codegraph/core/dist/ai/agent.js') as {
      OpenAIProvider: new (cfg: AIConfig) => AIProvider;
    };
    return new OpenAIProvider({
      provider: 'openai',
      model: aiCfg.model,
      apiKey: aiCfg.apiKey,
      maxTokens: aiCfg.maxTokensPerRequest,
      temperature: aiCfg.temperature,
    });
  }
  // Default to mock provider
  const { MockAIProvider } = require('@codegraph/core/dist/ai/agent.js') as {
    MockAIProvider: new () => AIProvider;
  };
  return new MockAIProvider();
}

/**
 * Consolidated runtime context shared by GraphQL resolvers and REST handlers.
 *
 * All engines and agents needed to service API requests are available here.
 */
export interface ServerContext {
  /** Neo4j graph driver (already connected). */
  driver: GraphDriver;
  /** Graph schema manager for index/constraint operations. */
  schema: GraphSchema;
  /** Code indexer for writing parse results into Neo4j. */
  indexer: CodeIndexer;
  /** Typed query API for reading from the graph. */
  queryEngine: QueryEngine;
  /** Language parser (currently TypeScript). */
  parser: ICodeParser;
  /** Scenario lifecycle manager. */
  scenarioEngine: ScenarioEngine;
  /** Step-by-step scenario tracer. */
  scenarioTracer: ScenarioTracer;
  /** Human-correction processor. */
  correctionEngine: CorrectionEngine;
  /** AI agent for discovering scenarios. */
  discoveryAgent: ScenarioDiscoveryAgent;
  /** The loaded project configuration. */
  config: CodeGraphConfig;
  /** Cleanly shut down all resources (driver, etc.). */
  dispose: () => Promise<void>;
}

/**
 * Create a fully-initialised {@link ServerContext} from a project configuration.
 *
 * This connects to Neo4j, ensures the schema exists, and wires up every
 * engine and AI agent so that the server can start handling requests
 * immediately.
 *
 * @param config - Validated CodeGraph project configuration.
 * @returns A ready-to-use server context.
 */
export async function createServerContext(
  config: CodeGraphConfig,
): Promise<ServerContext> {
  // --- Graph layer ---
  const driver = new GraphDriver(
    config.neo4j.uri,
    config.neo4j.username,
    config.neo4j.password,
    config.neo4j.database,
  );
  await driver.connect();
  logger.info('Connected to Neo4j at %s', config.neo4j.uri);

  const schema = new GraphSchema(driver);
  await schema.initialize();

  const indexer = new CodeIndexer(driver);
  const queryEngine = new QueryEngine(driver);

  // --- Parser ---
  const parser: ICodeParser = new TypeScriptParser(
    config.parser.typescript?.tsconfig ?? 'tsconfig.json',
  );

  // --- AI layer ---
  const aiProvider: AIProvider = buildAIProvider(config);

  const discoveryAgent = new ScenarioDiscoveryAgent(aiProvider);
  const pathTracer = new PathTracerAgent(aiProvider);
  const variableImaginer = new VariableImaginerAgent(aiProvider);
  const justifier = new JustifierAgent(aiProvider);
  const correctionInterpreter = new CorrectionInterpreterAgent(aiProvider);

  // --- Domain engines ---
  const scenarioEngine = new ScenarioEngine(driver, queryEngine);
  const scenarioTracer = new ScenarioTracer(
    parser,
    queryEngine,
    pathTracer,
    variableImaginer,
    justifier,
  );
  const correctionEngine = new CorrectionEngine(
    driver,
    scenarioEngine,
    scenarioTracer,
    correctionInterpreter,
  );

  /** Release all resources held by the context. */
  const dispose = async (): Promise<void> => {
    await driver.disconnect();
    logger.info('Disconnected from Neo4j');
  };

  return {
    driver,
    schema,
    indexer,
    queryEngine,
    parser,
    scenarioEngine,
    scenarioTracer,
    correctionEngine,
    discoveryAgent,
    config,
    dispose,
  };
}
