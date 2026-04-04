# Domain: API Server (@codegraph/server)

## Scope

Express + Apollo GraphQL API server. Located in `packages/server/`.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | `startServer(config)` — creates Express app, mounts REST + GraphQL + optional web UI static files. Returns `{ app, server, close, ctx }`. Also supports direct execution (`node dist/index.js`) |
| `src/context.ts` | `createServerContext(config)` — wires up all core engines (GraphDriver, GraphSchema, CodeIndexer, QueryEngine, TypeScriptParser, ScenarioEngine, ScenarioTracer, CorrectionEngine, all AI agents), connects Neo4j, provides `dispose()`. `ServerContext` interface. Internal `buildAIProvider()` function |
| `src/graphql/schema.ts` | GraphQL type definitions via `gql` template — enums, object types, inputs, Query, Mutation |
| `src/graphql/resolvers/queries.ts` | Query resolver implementations |
| `src/graphql/resolvers/mutations.ts` | Mutation resolver implementations |
| `src/graphql/resolvers/index.ts` | Resolver barrel exports |
| `src/rest/routes.ts` | `createRestRouter(ctx)` — Express router with REST endpoints under `/api/*` |

## Architecture

```
Express app
├── REST routes (/api/*)         → src/rest/routes.ts
├── Apollo GraphQL (/graphql)    → src/graphql/
└── Static web UI (optional)     → packages/web/dist/ (if built)
```

## GraphQL Schema

### Enums
`ScenarioStatus`, `CorrectionType`, `CorrectionScope`, `StepAction`

### Object Types
`Scenario` (with nested `steps`), `ScenarioStep`, `Function`, `Class`, `Branch`, `Variable`, `CallEdge`, `Correction`, `IndexJob`, `TraceResult`, `CorrectionResult`, `Stats`

### Input Types
`ScenarioFilter` (1 field: status), `CreateScenarioInput` (6 fields: name, description, entryFunction, triggerCondition, discoveredBy, confidence), `CorrectionInput` (5 fields: message, scenarioId, stepNumber, functionId, userId), `IndexConfig` (2 fields: rootDirs, excludeDirs)

### Queries
`scenarios(filter)`, `scenario(id)`, `scenarioSteps(scenarioId, from, to)`, `function(id)`, `functionByName(qualifiedName)`, `callers(functionId)`, `callees(functionId)`, `callChain(fromId, toId, maxDepth)`, `classHierarchy(classId)`, `implementations(methodId)`, `searchFunctions(query, limit)`, `searchScenarios(query)`, `corrections(scenarioId, scope)`, `stats`

### Mutations
`indexCodebase(config)`, `discoverScenarios(hint)`, `createScenario(input)`, `traceScenario(scenarioId)`, `submitCorrection(input)`, `undoCorrection(correctionId)`, `deleteScenario(id)`

## REST Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/health` | Health check (returns Neo4j connection status) |
| GET | `/api/config` | Public config (projectName, editor settings incl. sshHost) |
| GET | `/api/stats` | Graph statistics |
| GET | `/api/scenarios` | List scenarios (optional `?status=` filter) |
| POST | `/api/scenarios/discover` | Discover scenarios via AI (body: `{ hint }`) |
| GET | `/api/scenarios/:id` | Get scenario by ID |
| GET | `/api/scenarios/:id/steps` | Get walkthrough steps (optional `?from=&to=`) |
| POST | `/api/scenarios/:id/trace` | Trace a scenario |
| POST | `/api/corrections` | Submit correction (body: `{ message, scenarioId?, stepNumber?, functionId?, userId? }`) |
| GET | `/api/corrections` | List corrections (optional `?scenarioId=&scope=`) |
| GET | `/api/functions/search` | Search functions (`?q=&limit=`) |
| GET | `/api/functions/:id/callers` | Get callers of a function |
| GET | `/api/functions/:id/callees` | Get callees of a function |
| GET | `/api/graph/:scenarioId` | Get Cytoscape visualization data (nodes + edges from scenario steps) |

## Patterns

- **Server context**: All resolvers and routes receive `ServerContext` which wraps core engines
- **Graceful shutdown**: `startServer()` returns `{ close }` for cleanup — stops Apollo, closes Express, disconnects Neo4j
- **Web UI serving**: If `packages/web/dist` exists, serves as static files from Express
- **Error handling**: REST routes catch errors and return `{ error: message }` with appropriate HTTP status codes
- **AI provider**: `buildAIProvider()` in context.ts supports OpenAI and Mock providers via dynamic require from core
