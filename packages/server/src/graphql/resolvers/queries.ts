/**
 * GraphQL Query Resolvers — implements every field listed under `type Query`
 * in the schema.
 *
 * Each resolver receives the {@link ServerContext} via the third `context`
 * argument and delegates to the appropriate core engine.
 *
 * @module server/graphql/resolvers/queries
 */

import type { ServerContext } from '../../context.js';

/**
 * Map of all query resolvers.
 *
 * Keys correspond exactly to the field names in `type Query` defined in
 * the GraphQL schema.
 */
export const queryResolvers = {
  // ------------------------------------------------------------------ 
  // Scenarios
  // ------------------------------------------------------------------

  /**
   * List all scenarios, optionally filtered by status and/or tags.
   */
  async scenarios(
    _parent: unknown,
    args: { filter?: { status?: string; tags?: string[] } },
    ctx: ServerContext,
  ) {
    const status = args.filter?.status as
      | 'draft' | 'traced' | 'validated' | 'corrected'
      | undefined;
    const tags = args.filter?.tags;
    return ctx.scenarioEngine.listScenarios(status, tags);
  },

  /**
   * Get a single scenario by its ID.
   */
  async scenario(
    _parent: unknown,
    args: { id: string },
    ctx: ServerContext,
  ) {
    return ctx.scenarioEngine.getScenario(args.id);
  },

  /**
   * Get walkthrough steps for a scenario.
   */
  async scenarioSteps(
    _parent: unknown,
    args: { scenarioId: string; from?: number; to?: number },
    ctx: ServerContext,
  ) {
    return ctx.scenarioEngine.getSteps(args.scenarioId, args.from, args.to);
  },

  // ------------------------------------------------------------------
  // Functions
  // ------------------------------------------------------------------

  /**
   * Get a function node by its unique ID.
   */
  async function(
    _parent: unknown,
    args: { id: string },
    ctx: ServerContext,
  ) {
    return ctx.queryEngine.getFunction(args.id);
  },

  /**
   * Find a function by its fully-qualified name.
   */
  async functionByName(
    _parent: unknown,
    args: { qualifiedName: string },
    ctx: ServerContext,
  ) {
    return ctx.queryEngine.getFunctionByName(args.qualifiedName);
  },

  /**
   * Get all functions that call the specified function.
   */
  async callers(
    _parent: unknown,
    args: { functionId: string },
    ctx: ServerContext,
  ) {
    return ctx.queryEngine.getCallers(args.functionId);
  },

  /**
   * Get all functions called by the specified function.
   */
  async callees(
    _parent: unknown,
    args: { functionId: string },
    ctx: ServerContext,
  ) {
    return ctx.queryEngine.getCallees(args.functionId);
  },

  /**
   * Find call-chain paths between two functions.
   *
   * Returns an array of stringified paths for simplicity in the
   * GraphQL layer.
   */
  async callChain(
    _parent: unknown,
    args: { fromId: string; toId: string; maxDepth?: number },
    ctx: ServerContext,
  ) {
    const chains = await ctx.queryEngine.getCallChain(
      args.fromId,
      args.toId,
      args.maxDepth ?? 10,
    );
    return chains.map((c: { path: string[]; length: number }) => c.path.join(' → '));
  },

  /**
   * Get the class hierarchy (parents + children) for a class.
   */
  async classHierarchy(
    _parent: unknown,
    args: { classId: string },
    ctx: ServerContext,
  ) {
    const entries = await ctx.queryEngine.getClassHierarchy(args.classId);
    return entries.map((e: { classNode: unknown }) => e.classNode);
  },

  /**
   * Find concrete implementations of an abstract / interface method.
   */
  async implementations(
    _parent: unknown,
    args: { methodId: string },
    ctx: ServerContext,
  ) {
    return ctx.queryEngine.getImplementations(args.methodId);
  },

  // ------------------------------------------------------------------
  // Search
  // ------------------------------------------------------------------

  /**
   * Full-text search across function names and qualified names.
   */
  async searchFunctions(
    _parent: unknown,
    args: { query: string; limit?: number },
    ctx: ServerContext,
  ) {
    return ctx.queryEngine.searchFunctions(args.query, args.limit ?? 25);
  },

  /**
   * Search scenarios by name, description, or tag substring.
   */
  async searchScenarios(
    _parent: unknown,
    args: { query: string },
    ctx: ServerContext,
  ) {
    const all = await ctx.scenarioEngine.listScenarios();
    const q = args.query.toLowerCase();

    // If the query looks like tag filters (starts with #), filter by tags
    const tagMatches = q.match(/#\S+/g);
    if (tagMatches && tagMatches.length > 0) {
      return all.filter(
        (s: { tags: string[] }) =>
          tagMatches.every(tag =>
            s.tags.some(scenarioTag => scenarioTag === tag)
          ),
      );
    }

    return all.filter(
      (s: { name: string; description: string; tags: string[] }) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tags.some(tag => tag.includes(q)),
    );
  },

  // ------------------------------------------------------------------
  // Corrections
  // ------------------------------------------------------------------

  /**
   * List persisted corrections, optionally scoped.
   */
  async corrections(
    _parent: unknown,
    args: { scenarioId?: string; scope?: string },
    ctx: ServerContext,
  ) {
    return ctx.correctionEngine.getCorrections(
      args.scenarioId ?? undefined,
      (args.scope as 'global' | 'scenario' | 'function' | 'step') ?? undefined,
    );
  },

  // ------------------------------------------------------------------
  // Stats
  // ------------------------------------------------------------------

  /**
   * Get aggregate statistics about the graph database.
   */
  async stats(_parent: unknown, _args: unknown, ctx: ServerContext) {
    const raw = await ctx.queryEngine.getStats();
    return {
      totalNodes: raw.totalNodes,
      totalRelationships: raw.totalRelationships,
      nodes: JSON.stringify(raw.nodes),
      relationships: JSON.stringify(raw.relationships),
    };
  },
};
