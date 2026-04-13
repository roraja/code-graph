/**
 * REST API Routes — Express router providing a traditional HTTP API
 * alongside the GraphQL endpoint.
 *
 * All routes are mounted under `/api` and return JSON responses.
 * Errors are caught and returned with appropriate HTTP status codes.
 *
 * @module server/rest/routes
 */

import { Router, type Request, type Response } from 'express';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, normalize, relative } from 'node:path';
import type { ServerContext } from '../context.js';

/**
 * Create the Express router for the REST API.
 *
 * @param ctx - The shared {@link ServerContext} providing access to engines.
 * @returns A configured Express {@link Router}.
 */
export function createRestRouter(ctx: ServerContext): Router {
  const router = Router();

  // ------------------------------------------------------------------
  // Health
  // ------------------------------------------------------------------

  /**
   * GET /api/health — lightweight health check.
   */
  router.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      neo4j: ctx.driver.isConnected(),
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/config — public configuration (editor settings, project name).
   * Only exposes non-sensitive fields needed by the web UI.
   */
  router.get('/api/config', (_req: Request, res: Response) => {
    res.json({
      projectName: ctx.config.project.name,
      editor: ctx.config.editor ?? {},
    });
  });

  // ------------------------------------------------------------------
  // Stats
  // ------------------------------------------------------------------

  /**
   * GET /api/stats — aggregate graph statistics.
   */
  router.get('/api/stats', async (_req: Request, res: Response) => {
    try {
      const stats = await ctx.queryEngine.getStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // ------------------------------------------------------------------
  // Scenarios
  // ------------------------------------------------------------------

  /**
   * GET /api/scenarios — list scenarios from JSON files on disk.
   * Supports optional status and tag filters.
   */
  router.get('/api/scenarios', async (req: Request, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const tagsParam = req.query.tags as string | string[] | undefined;
      const tags = tagsParam
        ? (Array.isArray(tagsParam) ? tagsParam : tagsParam.split(','))
        : undefined;
      const scenarios = ctx.scenarioFileReader.listScenarios(
        status as 'draft' | 'traced' | 'validated' | 'corrected' | undefined,
        tags,
      );
      res.json(scenarios);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * POST /api/scenarios/discover — use AI to discover new scenarios.
   */
  router.post('/api/scenarios/discover', async (req: Request, res: Response) => {
    try {
      const hint: string | undefined = req.body?.hint;

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
        userHint: hint,
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

      res.status(201).json(scenarios);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * GET /api/scenarios/:id — get a single scenario by ID from JSON files.
   */
  router.get('/api/scenarios/:id', async (req: Request, res: Response) => {
    try {
      const scenario = ctx.scenarioFileReader.getScenario(req.params.id);
      if (!scenario) {
        res.status(404).json({ error: 'Scenario not found' });
        return;
      }
      res.json(scenario);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * GET /api/scenarios/:id/steps — get walkthrough steps from JSON files.
   */
  router.get('/api/scenarios/:id/steps', async (req: Request, res: Response) => {
    try {
      const from = req.query.from ? Number(req.query.from) : undefined;
      const to = req.query.to ? Number(req.query.to) : undefined;
      const steps = ctx.scenarioFileReader.getSteps(req.params.id, from, to);
      res.json({ steps, totalSteps: steps.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * GET /api/scenarios/:id/steps/:stepNumber/callstack — get the call stack
   * and per-frame variable values for a specific step from JSON files.
   */
  router.get('/api/scenarios/:id/steps/:stepNumber/callstack', async (req: Request, res: Response) => {
    try {
      const step = ctx.scenarioFileReader.getStep(req.params.id, Number(req.params.stepNumber));
      if (!step) {
        res.status(404).json({ error: 'Step not found' });
        return;
      }
      res.json({
        stepNumber: step.stepNumber,
        functionName: step.functionName,
        callStack: step.callStack ?? [],
      });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * POST /api/scenarios/:id/trace — trace a scenario through the codebase.
   */
  router.post('/api/scenarios/:id/trace', async (req: Request, res: Response) => {
    try {
      const scenario = await ctx.scenarioEngine.getScenario(req.params.id);
      if (!scenario) {
        res.status(404).json({ error: 'Scenario not found' });
        return;
      }

      const result = await ctx.scenarioTracer.trace(scenario, {
        maxDepth: ctx.config.tracing.maxDepth,
        maxStepsPerFunction: ctx.config.tracing.maxStepsPerFunction,
        boringFunctions: ctx.config.tracing.boringFunctions,
        boringNamespaces: ctx.config.tracing.boringNamespaces,
        focusFunctions: ctx.config.tracing.focusFunctions,
      });

      await ctx.scenarioEngine.saveSteps(scenario.id, result.steps);

      res.json({
        scenarioId: result.scenarioId,
        stepsCreated: result.steps.length,
        functionsTraversed: result.functionsTraversed,
        branchDecisions: result.branchDecisions,
        dispatchesResolved: result.dispatchesResolved,
        durationMs: result.durationMs,
      });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // ------------------------------------------------------------------
  // Tags
  // ------------------------------------------------------------------

  /**
   * PUT /api/scenarios/:id/tags — set (replace) tags on a scenario.
   */
  router.put('/api/scenarios/:id/tags', async (req: Request, res: Response) => {
    try {
      const scenario = await ctx.scenarioEngine.getScenario(req.params.id);
      if (!scenario) {
        res.status(404).json({ error: 'Scenario not found' });
        return;
      }
      const tags: string[] = req.body?.tags ?? [];
      await ctx.scenarioEngine.setTags(req.params.id, tags);
      const updated = await ctx.scenarioEngine.getScenario(req.params.id);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * POST /api/scenarios/:id/tags — add tags to a scenario.
   */
  router.post('/api/scenarios/:id/tags', async (req: Request, res: Response) => {
    try {
      const scenario = await ctx.scenarioEngine.getScenario(req.params.id);
      if (!scenario) {
        res.status(404).json({ error: 'Scenario not found' });
        return;
      }
      const tags: string[] = req.body?.tags ?? [];
      await ctx.scenarioEngine.addTags(req.params.id, tags);
      const updated = await ctx.scenarioEngine.getScenario(req.params.id);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * DELETE /api/scenarios/:id/tags — remove tags from a scenario.
   */
  router.delete('/api/scenarios/:id/tags', async (req: Request, res: Response) => {
    try {
      const scenario = await ctx.scenarioEngine.getScenario(req.params.id);
      if (!scenario) {
        res.status(404).json({ error: 'Scenario not found' });
        return;
      }
      const tags: string[] = req.body?.tags ?? [];
      await ctx.scenarioEngine.removeTags(req.params.id, tags);
      const updated = await ctx.scenarioEngine.getScenario(req.params.id);
      res.json(updated);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // ------------------------------------------------------------------
  // Corrections
  // ------------------------------------------------------------------

  /**
   * POST /api/corrections — submit a natural-language correction.
   */
  router.post('/api/corrections', async (req: Request, res: Response) => {
    try {
      const { message, scenarioId, stepNumber, functionId, userId } = req.body ?? {};

      if (!message || typeof message !== 'string') {
        res.status(400).json({ error: '"message" is required' });
        return;
      }

      const scenario = scenarioId
        ? await ctx.scenarioEngine.getScenario(scenarioId)
        : undefined;

      const currentStep =
        scenario && stepNumber != null
          ? await ctx.scenarioEngine.getStep(scenario.id, Number(stepNumber))
          : undefined;

      const currentFunction = functionId
        ? await ctx.queryEngine.getFunction(functionId)
        : undefined;

      const result = await ctx.correctionEngine.submitCorrection(
        message,
        {
          scenario: scenario ?? undefined,
          currentStep: currentStep ?? undefined,
          currentFunction: currentFunction
            ? { id: currentFunction.id, name: currentFunction.qualifiedName, sourceCode: currentFunction.sourceCode }
            : undefined,
        },
        userId ?? 'anonymous',
      );

      res.status(201).json({
        correction: result.correction,
        affectedSteps: result.affectedSteps,
        retraceTriggered: result.retraceTriggered,
        clarificationNeeded: result.clarificationNeeded ?? null,
      });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * GET /api/corrections — list corrections with optional filters.
   */
  router.get('/api/corrections', async (req: Request, res: Response) => {
    try {
      const scenarioId = req.query.scenarioId as string | undefined;
      const scope = req.query.scope as string | undefined;
      const corrections = await ctx.correctionEngine.getCorrections(
        scenarioId,
        scope as 'global' | 'scenario' | 'function' | 'step' | undefined,
      );
      res.json(corrections);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // ------------------------------------------------------------------
  // Functions
  // ------------------------------------------------------------------

  /**
   * GET /api/functions/search — full-text search across function names.
   */
  router.get('/api/functions/search', async (req: Request, res: Response) => {
    try {
      const query = req.query.q as string | undefined;
      if (!query) {
        res.status(400).json({ error: 'Query parameter "q" is required' });
        return;
      }
      const limit = req.query.limit ? Number(req.query.limit) : 25;
      const functions = await ctx.queryEngine.searchFunctions(query, limit);
      res.json(functions);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * GET /api/functions/:id/callers — who calls this function.
   */
  router.get('/api/functions/:id/callers', async (req: Request, res: Response) => {
    try {
      const callers = await ctx.queryEngine.getCallers(req.params.id);
      res.json(callers);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * GET /api/functions/:id/callees — what does this function call.
   */
  router.get('/api/functions/:id/callees', async (req: Request, res: Response) => {
    try {
      const callees = await ctx.queryEngine.getCallees(req.params.id);
      res.json(callees);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // ------------------------------------------------------------------
  // Code Walks
  // ------------------------------------------------------------------

  /**
   * GET /api/codewalks — list all code walks from disk.
   * Reads both v1 single-file and v2 multi-file walk directories.
   * Returns walk metadata (id, name, description, cellCount, tags, dates).
   */
  router.get('/api/codewalks', (_req: Request, res: Response) => {
    try {
      const walks = ctx.codeWalkFileReader.listCodeWalks();
      // Return summary (no full cell data) for the list view
      const summaries = walks.map(w => ({
        id: w.id,
        name: w.name,
        description: w.description,
        scenarioId: w.scenarioId,
        cellCount: w.cells.length,
        tags: w.meta.tags,
        createdAt: w.meta.createdAt,
        updatedAt: w.meta.updatedAt,
        entryPoint: w.meta.entryPoint,
        contributors: w.meta.contributors.map(c => c.tool),
      }));
      res.json(summaries);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * GET /api/codewalks/:id — get a full code walk by ID, including all cells.
   */
  router.get('/api/codewalks/:id', (req: Request, res: Response) => {
    try {
      const walk = ctx.codeWalkFileReader.getCodeWalk(req.params.id);
      if (!walk) {
        res.status(404).json({ error: 'Code walk not found' });
        return;
      }
      // Return the full walk in v1 format (compatible with the HTML viewer)
      res.json({ _format: 'codegraph-codewalk-v1', walk });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * GET /api/codewalks/:id/cells/:index — get a single cell from a walk.
   */
  router.get('/api/codewalks/:id/cells/:index', (req: Request, res: Response) => {
    try {
      const cellIndex = parseInt(req.params.index, 10);
      if (isNaN(cellIndex) || cellIndex < 0) {
        res.status(400).json({ error: 'Invalid cell index' });
        return;
      }
      const cell = ctx.codeWalkFileReader.getCell(req.params.id, cellIndex);
      if (!cell) {
        res.status(404).json({ error: 'Cell not found' });
        return;
      }
      res.json(cell);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // ------------------------------------------------------------------
  // Graph (for visualization)
  // ------------------------------------------------------------------

  /**
   * GET /api/graph/:scenarioId — get graph nodes and edges for a scenario.
   * Returns functions as nodes and calls as edges for Cytoscape visualization.
   * Reads from JSON files on disk.
   */
  router.get('/api/graph/:scenarioId', async (req: Request, res: Response) => {
    try {
      const scenario = ctx.scenarioFileReader.getScenario(req.params.scenarioId);
      if (!scenario) {
        res.status(404).json({ error: 'Scenario not found' });
        return;
      }

      const steps = ctx.scenarioFileReader.getSteps(req.params.scenarioId);

      // Build nodes from scenario steps (unique functions)
      const nodeMap = new Map<string, {
        id: string; label: string; type: string;
        filePath: string; line: number;
        sourceCode?: string; qualifiedName?: string; signature?: string;
      }>();
      const edges: Array<{
        id: string; source: string; target: string;
        label: string; isVirtualDispatch: boolean;
      }> = [];

      for (const step of steps) {
        const nodeId = step.functionId || `step-${step.stepNumber}`;
        if (!nodeMap.has(nodeId)) {
          // Extract file path from functionId (format: "filepath:line")
          const parts = (step.functionId ?? '').split(':');
          const filePath = parts.length > 1 ? parts.slice(0, -1).join(':') : step.functionId ?? '';

          const actionType = step.action.includes('branch') ? 'branch' : 'function';

          nodeMap.set(nodeId, {
            id: nodeId,
            label: step.functionName,
            type: actionType,
            filePath,
            line: step.line ?? step.stepNumber,
            sourceCode: step.sourceCode ?? undefined,
            qualifiedName: step.functionName,
          });
        }
      }

      // Build edges from sequential steps
      for (let i = 0; i < steps.length - 1; i++) {
        const current = steps[i];
        const next = steps[i + 1];
        if (!current || !next) continue;
        const sourceId = current.functionId || `step-${current.stepNumber}`;
        const targetId = next.functionId || `step-${next.stepNumber}`;
        edges.push({
          id: `edge-${i}`,
          source: sourceId,
          target: targetId,
          label: next.action,
          isVirtualDispatch: next.action === 'dispatch',
        });
      }

      res.json({
        nodes: Array.from(nodeMap.values()),
        edges,
      });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  // ------------------------------------------------------------------
  // Source File Reading (for full-file codewalk viewer)
  // ------------------------------------------------------------------

  /**
   * GET /api/file?path=<relative-path> — read a source file from the project.
   * Returns the file content as JSON. Path must be within the project root.
   */
  router.get('/api/file', (req: Request, res: Response) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) { res.status(400).json({ error: 'Missing "path" query parameter' }); return; }

      const projectRoot = ctx.config.project.rootDirs?.[0]
        ? resolve(process.cwd(), '..')
        : process.cwd();

      const absPath = resolve(projectRoot, filePath);
      const rel = relative(projectRoot, absPath);
      if (rel.startsWith('..') || normalize(rel).startsWith('..')) {
        res.status(403).json({ error: 'Path is outside project root' });
        return;
      }

      if (!existsSync(absPath)) {
        res.status(404).json({ error: 'File not found', path: filePath });
        return;
      }

      const content = readFileSync(absPath, 'utf-8');
      res.json({ path: filePath, content, lines: content.split('\n').length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a human-readable message from an unknown error. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
