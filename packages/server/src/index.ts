/**
 * CodeGraph API Server — main entry point.
 *
 * Starts an Express application with:
 * - Apollo Server (GraphQL) at `/graphql`
 * - REST endpoints under `/api`
 * - Optional static file serving for the web UI
 *
 * @module server
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { type CodeGraphConfig, loadConfig, findProjectRoot, logger } from '@codegraph/core';
import { typeDefs } from './graphql/schema.js';
import { resolvers } from './graphql/resolvers/index.js';
import { createRestRouter } from './rest/routes.js';
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
    logger.info('  GraphQL  → http://%s:%d/graphql', host, port);
    logger.info('  REST API → http://%s:%d/api', host, port);
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
