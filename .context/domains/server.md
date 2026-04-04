# Domain: API Server (@codegraph/server)

## Scope

Express + Apollo GraphQL API server. Located in `packages/server/`.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | `startServer()` — creates Express app, mounts REST + GraphQL + optional web UI static files |
| `src/context.ts` | `createServerContext()` — wires up all core engines, connects Neo4j, provides `dispose()` |
| `src/graphql/schema.ts` | GraphQL type definitions via `gql` template — enums, object types, Query, Mutation |
| `src/graphql/resolvers/queries.ts` | Query resolver implementations |
| `src/graphql/resolvers/mutations.ts` | Mutation resolver implementations |
| `src/graphql/resolvers/index.ts` | Resolver barrel exports |
| `src/rest/routes.ts` | Express router with REST endpoints under `/api/*` |

## Architecture

```
Express app
├── REST routes (/api/*)         → src/rest/routes.ts
├── Apollo GraphQL (/graphql)    → src/graphql/
└── Static web UI (optional)     → packages/web/dist/ (if built)
```

## GraphQL Schema

- **Enums**: `ScenarioStatus`, `CorrectionType`, `CorrectionScope`, `StepAction`
- **Object types**: `Scenario`, `ScenarioStep`, `Correction`, `Function`, `Class`, `DatabaseStats`
- **Queries**: `scenarios`, `scenario(id)`, `function(id)`, `functions`, `stats`, `search`, `callers`, `callChain`
- **Mutations**: `indexCodebase`, `discoverScenarios`, `traceScenario`, `submitCorrection`

## REST Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/health` | Health check |
| GET | `/api/stats` | Graph statistics |
| GET | `/api/scenarios` | List scenarios |
| POST | `/api/scenarios/discover` | Discover scenarios |
| GET | `/api/scenarios/:id` | Get scenario |
| GET | `/api/scenarios/:id/steps` | Get walkthrough steps |
| POST | `/api/scenarios/:id/trace` | Trace a scenario |
| POST | `/api/corrections` | Submit correction |
| GET | `/api/functions/search` | Search functions |

## Patterns

- **Server context**: All resolvers and routes receive `ServerContext` which wraps core engines
- **Graceful shutdown**: `startServer()` returns `{ close }` for cleanup
- **Web UI serving**: If `packages/web/dist` exists, serves as static files from Express
