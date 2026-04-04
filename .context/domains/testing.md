# Domain: Testing

## Scope

Testing strategy, frameworks, and patterns across the monorepo.

## Test Pyramid

| Level | Location | Command | Requires |
|-------|----------|---------|----------|
| Unit | `packages/core/src/**/*.test.ts` | `npm test` or `cd packages/core && npx vitest run` | Nothing |
| Integration | `packages/core/src/**/*.integration.test.ts` | `npm run test:integration` | Neo4j running |
| E2E | `test/e2e/` | `npm run test:e2e` | Neo4j + built packages |

## Framework: Vitest

- **Globals enabled**: `describe`, `it`, `expect`, `vi`, `beforeAll`, `afterAll` — no imports needed
- **Unit config**: `packages/core/vitest.config.ts` — 30s timeout, excludes `*.integration.test.ts`
- **Integration config**: `packages/core/vitest.integration.config.ts` — 60s timeout, includes only `*.integration.test.ts`
- **E2E config**: `test/vitest.config.ts`

## Running Tests

```bash
# All unit tests
npm test

# Single test file
cd packages/core && npx vitest run src/parser/typescript.test.ts

# Single test by name
cd packages/core && npx vitest run -t "should extract exported function declarations"

# Watch mode
cd packages/core && npx vitest watch

# Integration (needs Neo4j)
npm run test:integration

# E2E
npm run test:e2e

# With mock AI (no API key)
CODEGRAPH_AI_MOCK=true npm test
```

## Patterns

### Parser Tests (in-memory)
```ts
const { project, parser } = createTestSetup();
project.createSourceFile('/test/functions.ts', `export function add(a: number, b: number): number { return a + b; }`);
const result = await parser.parseFile('/test/functions.ts');
expect(result.functions.find(f => f.name === 'add')).toBeDefined();
```

### Mock Factories
```ts
const mockDriver = createMockDriver();       // vi.fn() for all GraphDriver methods
const mockQuery = createMockQueryEngine();   // vi.fn() for all QueryEngine methods
```

### AI Mock
- `MockAIProvider` supports canned responses and pattern-based rules
- Activated via `CODEGRAPH_AI_MOCK=true` env var
- Use for all tests that don't specifically test OpenAI integration

## Fixtures

- `test/fixtures/sample-project/` — Sample TypeScript project (6 files, 18 functions, 7 classes) for demos and testing
- `scenarios/async-clipboard-read-text.json` — Pre-built 15-step Chromium clipboard scenario
