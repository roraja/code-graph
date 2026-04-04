# Process: Debugging a Failure

## When to Use

A test, build, or runtime error needs investigation and fixing.

## Steps

### Step 1: Reproduce

```bash
# Build errors
npm run build 2>&1 | head -50

# Test failures — run the specific test
cd packages/core && npx vitest run src/path/to/failing.test.ts

# Runtime errors
CODEGRAPH_LOG_LEVEL=debug codegraph <command> -v
```

### Step 2: Identify the Layer

| Error type | Likely location |
|------------|----------------|
| Parse/AST errors | `packages/core/src/parser/` |
| Neo4j connection/query errors | `packages/core/src/graph/` |
| AI response errors | `packages/core/src/ai/` |
| Scenario/tracing errors | `packages/core/src/scenario/` |
| CLI argument/option errors | `packages/cli/src/commands/` |
| GraphQL schema/resolver errors | `packages/server/src/graphql/` |
| REST endpoint errors | `packages/server/src/rest/` |
| React component errors | `packages/web/src/components/` |
| Config/validation errors | `packages/core/src/config/` |

### Step 3: Investigate

Load the relevant domain context from `.context/domains/`.

- Check error messages for file paths and line numbers
- Use `CODEGRAPH_LOG_LEVEL=debug` for verbose logging
- For Neo4j issues: check connection at `bolt://localhost:7687` and browser at `http://localhost:7474`
- For AI issues: try `CODEGRAPH_AI_MOCK=true` to rule out API problems

### Step 4: Fix and Verify

1. Make the fix
2. Run the specific failing test: `cd packages/core && npx vitest run src/path/to/test.ts`
3. Run full test suite: `npm test`
4. Run lint: `npm run lint`

### Step 5: Document

1. Create bug fix doc: `docs/bug-fixes/NN-bug-description.md`
2. Log execution: `docs/copilot-executions/NN-slug.md`
3. Update `.context/` files if a gotcha was discovered
