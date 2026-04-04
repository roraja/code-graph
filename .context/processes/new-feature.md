# Process: Adding a New Feature

## When to Use

You need to add a feature that touches multiple packages or layers (e.g., new core engine capability exposed via CLI + API + UI).

## Steps

### Step 1: Plan

- Identify which packages need changes (core is almost always involved)
- Check if new types/interfaces are needed in core
- Determine if the feature needs CLI, API, and/or UI exposure

### Step 2: Core Changes

Load: `.context/domains/core.md`

1. Add/modify types and interfaces in the appropriate layer (`parser/`, `graph/`, `ai/`, `scenario/`, `correction/`)
2. Implement the logic
3. Re-export from `packages/core/src/index.ts`
4. Add unit tests co-located with the source (`*.test.ts`)
5. Build: `cd packages/core && npm run build`

### Step 3: CLI Command (if needed)

Load: `.context/domains/cli.md`

1. Create `packages/cli/src/commands/my-command.ts` with `registerMyCommandCommand(program)`
2. Register in `packages/cli/src/index.ts`
3. Update `CLIContext` / `FullCLIContext` in `helpers.ts` if new engines are needed
4. See `processes/add-cli-command.md` for details

### Step 4: API Endpoint (if needed)

Load: `.context/domains/server.md`

1. Add GraphQL types to `packages/server/src/graphql/schema.ts`
2. Add resolvers to `queries.ts` or `mutations.ts`
3. Add REST route to `packages/server/src/rest/routes.ts` (if REST endpoint needed)
4. Update `ServerContext` if new engines are needed

### Step 5: Web UI (if needed)

Load: `.context/domains/web.md`

1. Add/modify React components in `packages/web/src/components/`
2. Add GraphQL queries/mutations via Apollo Client
3. Update Zustand stores if new state is needed
4. Add routes if new pages are needed

### Step 6: Test

Load: `.context/domains/testing.md`

1. Run unit tests: `npm test`
2. Run integration tests if graph-related: `npm run test:integration`
3. Run lint: `npm run lint`

### Step 7: Document

1. Create feature doc: `docs/features/NN-feature-name.md`
2. Log execution: `docs/copilot-executions/NN-slug.md`
3. Update relevant `.context/` files if patterns changed
