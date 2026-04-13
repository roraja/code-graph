/**
 * CodeGraph API Server — main entry point.
 *
 * Starts an Express application with:
 * - Apollo Server (GraphQL) at `/graphql`
 * - REST endpoints under `/api`
 * - Optional static file serving for the web UI
 *
 * Also provides a lightweight mode ({@link startLightServer}) that only
 * serves code walk viewer and REST API — no Neo4j, no GraphQL, no config
 * file required. This is used when `codegraph serve` runs in a project
 * that only has codewalks on disk.
 *
 * @module server
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, normalize, relative } from 'node:path';
import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { type CodeGraphConfig, CodeWalkFileReader, loadConfig, findProjectRoot, logger } from '@codegraph/core';
import { typeDefs } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers/index.js';
import { createRestRouter } from './rest/routes.js';
import { createCodeWalkViewerRouter } from './rest/codewalk-viewer.js';
import { createServerContext, type ServerContext } from './context.js';

/**
 * Start the CodeGraph API server.
 *
 * Creates the Express app, wires up Apollo Server and REST routes,
 * optionally serves the web-UI static bundle, and begins listening.
 *
 * @param config - Validated CodeGraph project configuration.
 * @param projectRoot - Optional project root for file-based scenario reading.
 * @returns An object with `close()` to shut down the server gracefully.
 */
export async function startServer(config: CodeGraphConfig, projectRoot?: string) {
  // --- Server context (engines, agents, driver) ---
  const ctx = await createServerContext(config, projectRoot);

  // --- Express application ---
  const app = express();
  app.use(cors());
  app.use(express.json());

  // --- REST routes ---
  const restRouter = createRestRouter(ctx);
  app.use(restRouter);

  // --- CodeWalk Viewer (server-rendered HTML at /codewalks) ---
  const codeWalkViewerRouter = createCodeWalkViewerRouter();
  app.use(codeWalkViewerRouter);

  // --- Apollo Server (GraphQL) ---
  const apollo = new ApolloServer({
    typeDefs,
    resolvers,
  });
  await apollo.start();

  app.use(
    '/graphql',
    expressMiddleware(apollo, {
      context: async () => ctx,
    }),
  );

  // --- Static web UI (serve if the dist directory exists) ---
  const webUiDist = resolve(__dirname, '../../web/dist');
  if (existsSync(webUiDist)) {
    app.use(express.static(webUiDist));
    // SPA fallback: serve index.html for any non-API, non-GraphQL route
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/graphql')) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      res.sendFile(resolve(webUiDist, 'index.html'));
    });
    logger.info('Serving web UI from %s', webUiDist);
  }

  // --- Start listening ---
  const { port, host } = config.server;

  const server = app.listen(port, host, () => {
    logger.info('CodeGraph server listening on http://%s:%d', host, port);
    logger.info('  GraphQL   → http://%s:%d/graphql', host, port);
    logger.info('  REST API  → http://%s:%d/api', host, port);
    logger.info('  CodeWalks → http://%s:%d/codewalks', host, port);
  });

  /** Gracefully shut down the server and release all resources. */
  const close = async (): Promise<void> => {
    await apollo.stop();
    server.close();
    await ctx.dispose();
    logger.info('Server shut down');
  };

  return { app, server, close, ctx };
}

/**
 * Start a lightweight CodeGraph server — no Neo4j, no GraphQL, no config.
 *
 * Only serves:
 * - CodeWalk viewer HTML at `/codewalks` and `/codewalks/:id`
 * - CodeWalk REST API at `/api/codewalks`
 * - Health endpoint at `/api/health`
 *
 * This is used when running `codegraph serve` in a project that has no
 * `.codegraph.yaml` — you just want to browse codewalks from disk.
 *
 * @param projectRoot - The project root directory (cwd if not specified)
 * @param port - Port to listen on (default: 3000)
 * @param host - Host to bind to (default: '127.0.0.1')
 */
export async function startLightServer(
  projectRoot: string,
  port = 3000,
  host = '127.0.0.1',
) {
  const codeWalkFileReader = new CodeWalkFileReader(projectRoot);

  const app = express();
  app.use(cors());
  app.use(express.json());

  // --- Health endpoint ---
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', mode: 'light', neo4j: false, timestamp: new Date().toISOString() });
  });

  // --- CodeWalk REST API (light mode — only codewalks, no scenarios/graph) ---
  app.get('/api/codewalks', (_req, res) => {
    try {
      const walks = codeWalkFileReader.listCodeWalks();
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
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/codewalks/:id', (req, res) => {
    try {
      const walk = codeWalkFileReader.getCodeWalk(req.params.id);
      if (!walk) { res.status(404).json({ error: 'Code walk not found' }); return; }
      res.json({ _format: 'codegraph-codewalk-v1', walk });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/codewalks/:id/cells/:index', (req, res) => {
    try {
      const cellIndex = parseInt(req.params.index, 10);
      if (isNaN(cellIndex) || cellIndex < 0) { res.status(400).json({ error: 'Invalid cell index' }); return; }
      const cell = codeWalkFileReader.getCell(req.params.id, cellIndex);
      if (!cell) { res.status(404).json({ error: 'Cell not found' }); return; }
      res.json(cell);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // --- Source file reading (for full-file viewer) ---
  app.get('/api/file', (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) { res.status(400).json({ error: 'Missing "path" query parameter' }); return; }

      // Security: resolve to absolute, ensure it's within project root
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
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // --- CodeWalk Viewer HTML ---
  const codeWalkViewerRouter = createCodeWalkViewerRouter();
  app.use(codeWalkViewerRouter);

  // --- Catch-all: redirect root to /codewalks ---
  app.get('/', (_req, res) => { res.redirect('/codewalks'); });

  // --- Start listening ---
  const server = app.listen(port, host, () => {
    logger.info('CodeGraph light server on http://%s:%d', host, port);
    logger.info('  CodeWalks → http://%s:%d/codewalks', host, port);
  });

  const close = async (): Promise<void> => {
    server.close();
    logger.info('Light server shut down');
  };

  return { app, server, close };
}

// ---------------------------------------------------------------------------
// Run directly: `node dist/index.js` or `tsx src/index.ts`
// ---------------------------------------------------------------------------

const isDirectRun =
  typeof require !== 'undefined' &&
  require.main === module;

if (isDirectRun) {
  (async () => {
    try {
      const root = findProjectRoot() ?? undefined;
      const config = loadConfig(root);
      await startServer(config, root);
    } catch (err) {
      logger.error('Failed to start server: %s', err);
      process.exit(1);
    }
  })();
}
