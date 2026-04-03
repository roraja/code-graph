/**
 * GraphQL Mutation Resolvers — implements every field listed under
 * `type Mutation` in the schema.
 *
 * Each resolver receives the {@link ServerContext} via the third
 * `context` argument and delegates to the appropriate core engine.
 *
 * @module server/graphql/resolvers/mutations
 */

import { GraphQLError } from 'graphql';
import type { ServerContext } from '../../context.js';

/**
 * Map of all mutation resolvers.
 *
 * Keys correspond exactly to the field names in `type Mutation`
 * defined in the GraphQL schema.
 */
export const mutationResolvers = {
  // ------------------------------------------------------------------
  // Indexing
  // ------------------------------------------------------------------

  /**
   * Parse the codebase and index results into Neo4j.
   *
   * Uses the configured parser to walk source directories, then
   * feeds each {@link ParseResult} into the {@link CodeIndexer}.
   */
  async indexCodebase(
    _parent: unknown,
    args: { config?: { rootDirs?: string[]; excludeDirs?: string[] } },
    ctx: ServerContext,
  ) {
    const startTime = Date.now();

    const rootDirs = args.config?.rootDirs ?? ctx.config.project.rootDirs;
    const excludeDirs =
      args.config?.excludeDirs ?? ctx.config.project.excludeDirs;

    let filesProcessed = 0;
    let functionsIndexed = 0;
    let classesIndexed = 0;
    let callEdgesIndexed = 0;

    for (const rootDir of rootDirs) {
      const results = await ctx.parser.parseDirectory(rootDir, {
        exclude: excludeDirs,
      });

      for (const result of results) {
        await ctx.indexer.indexParseResult(result);
        filesProcessed++;
        functionsIndexed += result.functions.length;
        classesIndexed += result.classes.length;
        callEdgesIndexed += result.calls.length;
      }
    }

    return {
      filesProcessed,
      functionsIndexed,
      classesIndexed,
      callEdgesIndexed,
      durationMs: Date.now() - startTime,
    };
  },

  // ------------------------------------------------------------------
  // Scenario discovery
  // ------------------------------------------------------------------

  /**
   * Use the AI discovery agent to propose scenarios from the indexed graph.
   *
   * Searches for entry-point and event-handler functions, passes them to
   * the {@link ScenarioDiscoveryAgent}, and persists each discovered
   * scenario via the {@link ScenarioEngine}.
   */
  async discoverScenarios(
    _parent: unknown,
    args: { hint?: string },
    ctx: ServerContext,
  ) {
    const entryPoints = await ctx.queryEngine.searchFunctions('handle', 50);
    const eventHandlers = await ctx.queryEngine.searchFunctions('on', 50);
    const publicAPIs = await ctx.queryEngine.searchFunctions('get', 50);

    const toSummary = (f: { id: string; name: string; signature: string; documentation?: string; filePath: string }) => ({
      id: f.id,
      name: f.name,
      signature: f.signature,
      documentation: f.documentation,
      filePath: f.filePath,
    });

    const discovered = await ctx.discoveryAgent.discover({
      entryPoints: entryPoints.map(toSummary),
      eventHandlers: eventHandlers.map(toSummary),
      publicAPIs: publicAPIs.map(toSummary),
      userHint: args.hint,
    });

    const scenarios = [];
    for (const d of discovered) {
      const scenario = await ctx.scenarioEngine.createScenario({
        name: d.name,
        description: d.description,
        entryFunction: d.entryFunction,
        triggerCondition: d.triggerCondition,
        discoveredBy: 'ai',
        confidence: d.confidence,
      });
      scenarios.push(scenario);
    }

    return scenarios;
  },

  // ------------------------------------------------------------------
  // Scenario CRUD
  // ------------------------------------------------------------------

  /**
   * Create a new scenario manually.
   */
  async createScenario(
    _parent: unknown,
    args: {
      input: {
        name: string;
        description: string;
        entryFunction: string;
        triggerCondition: string;
        discoveredBy?: string;
        confidence?: number;
      };
    },
    ctx: ServerContext,
  ) {
    return ctx.scenarioEngine.createScenario({
      name: args.input.name,
      description: args.input.description,
      entryFunction: args.input.entryFunction,
      triggerCondition: args.input.triggerCondition,
      discoveredBy: (args.input.discoveredBy as 'ai' | 'human') ?? 'human',
      confidence: args.input.confidence ?? 1.0,
    });
  },

  // ------------------------------------------------------------------
  // Tracing
  // ------------------------------------------------------------------

  /**
   * Trace a scenario through the codebase, producing walkthrough steps.
   */
  async traceScenario(
    _parent: unknown,
    args: { scenarioId: string },
    ctx: ServerContext,
  ) {
    const scenario = await ctx.scenarioEngine.getScenario(args.scenarioId);
    if (!scenario) {
      throw new GraphQLError(`Scenario not found: ${args.scenarioId}`, {
        extensions: { code: 'NOT_FOUND' },
      });
    }

    const result = await ctx.scenarioTracer.trace(scenario, {
      maxDepth: ctx.config.tracing.maxDepth,
      maxStepsPerFunction: ctx.config.tracing.maxStepsPerFunction,
      boringFunctions: ctx.config.tracing.boringFunctions,
      boringNamespaces: ctx.config.tracing.boringNamespaces,
      focusFunctions: ctx.config.tracing.focusFunctions,
    });

    await ctx.scenarioEngine.saveSteps(scenario.id, result.steps);

    return {
      scenarioId: result.scenarioId,
      stepsCreated: result.steps.length,
      functionsTraversed: result.functionsTraversed,
      branchDecisions: result.branchDecisions,
      dispatchesResolved: result.dispatchesResolved,
      durationMs: result.durationMs,
    };
  },

  // ------------------------------------------------------------------
  // Corrections
  // ------------------------------------------------------------------

  /**
   * Submit a natural-language correction and apply it.
   */
  async submitCorrection(
    _parent: unknown,
    args: {
      input: {
        message: string;
        scenarioId?: string;
        stepNumber?: number;
        functionId?: string;
        userId?: string;
      };
    },
    ctx: ServerContext,
  ) {
    const { message, scenarioId, stepNumber, functionId, userId } = args.input;

    const scenario = scenarioId
      ? await ctx.scenarioEngine.getScenario(scenarioId)
      : undefined;

    const currentStep =
      scenario && stepNumber != null
        ? await ctx.scenarioEngine.getStep(scenario.id, stepNumber)
        : undefined;

    const currentFunction = functionId
      ? await ctx.queryEngine.getFunction(functionId)
      : undefined;

    const correctionCtx = {
      scenario: scenario ?? undefined,
      currentStep: currentStep ?? undefined,
      currentFunction: currentFunction
        ? { id: currentFunction.id, name: currentFunction.qualifiedName, sourceCode: currentFunction.sourceCode }
        : undefined,
    };

    const result = await ctx.correctionEngine.submitCorrection(
      message,
      correctionCtx,
      userId ?? 'anonymous',
    );

    return {
      correction: result.correction,
      affectedSteps: result.affectedSteps,
      retraceTriggered: result.retraceTriggered,
      clarificationNeeded: result.clarificationNeeded ?? null,
    };
  },

  /**
   * Undo (delete) a previously-applied correction.
   */
  async undoCorrection(
    _parent: unknown,
    args: { correctionId: string },
    ctx: ServerContext,
  ) {
    await ctx.correctionEngine.undoCorrection(args.correctionId);
    return true;
  },

  // ------------------------------------------------------------------
  // Deletion
  // ------------------------------------------------------------------

  /**
   * Delete a scenario and all its steps.
   */
  async deleteScenario(
    _parent: unknown,
    args: { id: string },
    ctx: ServerContext,
  ) {
    const exists = await ctx.scenarioEngine.getScenario(args.id);
    if (!exists) {
      throw new GraphQLError(`Scenario not found: ${args.id}`, {
        extensions: { code: 'NOT_FOUND' },
      });
    }
    await ctx.scenarioEngine.deleteScenario(args.id);
    return true;
  },
};
