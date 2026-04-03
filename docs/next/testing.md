# Testing Guide

This document covers the CodeGraph test strategy, how to run tests, and how to add new ones.

---

## Test Pyramid

```
              ┌───────────┐
              │   E2E     │   1 test suite — full workflow with
              │  Tests    │   real Neo4j + mock AI
              ├───────────┤
              │Integration│   (planned) — parser + Neo4j,
              │  Tests    │   AI + Neo4j, API endpoints
              ├───────────┤
              │  Unit     │   3 test suites — config loader,
              │  Tests    │   scenario engine, correction engine
              └───────────┘
```

---

## Running Tests

### Unit Tests

Unit tests have no external dependencies. They test pure logic — config loading, scenario engine, correction engine.

```bash
# Run all unit tests
npm test

# Run unit tests for the core package only
npm run test:unit

# Watch mode (re-run on file changes)
cd packages/core && npm run test:watch
```

### Integration Tests

Integration tests require a running Neo4j instance. They test parser → Neo4j → query round-trips and AI agent integration.

```bash
# Start Neo4j first
docker run -d --name codegraph-neo4j \
  -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/codegraph123 \
  neo4j:5

# Run integration tests
npm run test:integration
```

### End-to-End Tests

E2E tests exercise the full workflow: index → discover → trace → correct → re-trace.

```bash
# Requires Neo4j running
npm run test:e2e
```

### Lint

```bash
npm run lint
```

### All Tests

```bash
# Unit + integration + e2e
npm test && npm run test:integration && npm run test:e2e
```

---

## Test Framework

CodeGraph uses [**Vitest**](https://vitest.dev/) for all tests.

- Root config: `test/vitest.config.ts`
- Core unit config: `packages/core/vitest.config.ts`
- Core integration config: `packages/core/vitest.integration.config.ts`

---

## Test Files

### Unit Tests (`test/unit/`)

| File | What It Tests |
|---|---|
| `config-loader.test.ts` | Config loading from `.codegraph.yaml`, environment variable substitution, validation via Zod, default values, missing config error handling |
| `scenario-engine.test.ts` | Scenario creation, listing, filtering by status, step management, scenario lifecycle |
| `correction-engine.test.ts` | Correction interpretation from natural language, correction types, structured correction generation, cascade triggering |

### E2E Tests (`test/e2e/`)

| File | What It Tests |
|---|---|
| `full-workflow.test.ts` | Complete index → discover → trace → correct → re-trace workflow using the sample project fixture |

---

## Test Fixtures

### `test/fixtures/sample-project/`

A self-contained TypeScript project used for integration and E2E tests. It models a **file processing pipeline** with:

| File | Contents |
|---|---|
| `src/types.ts` | Interfaces: `FileData`, `ProcessResult`, `IFileValidator`, `IFileProcessor`, `IEventHandler` |
| `src/validators.ts` | `SizeValidator` (checks file size ≤ 10MB), `TypeValidator` (checks allowed MIME types) |
| `src/processors.ts` | `ImageProcessor`, `DocumentProcessor`, `DefaultProcessor` — each handles specific MIME types |
| `src/pipeline.ts` | `FileProcessingPipeline` — orchestrates validation and processing with branching logic |
| `src/events.ts` | `FileDropEventHandler` (delegates to pipeline), `LoggingEventHandler` (decorator pattern) |
| `src/index.ts` | Entry point: `handleUserFileDrop()` — wires up validators, processors, pipeline, and event handlers |

This fixture provides realistic branching, interface implementations, the decorator pattern, and async processing — enough complexity for meaningful scenario discovery and tracing.

---

## Mock Mode

### Running without an AI API key

Set the `CODEGRAPH_AI_MOCK` environment variable to use deterministic mock responses instead of calling the OpenAI API:

```bash
CODEGRAPH_AI_MOCK=true npm test
```

When `CODEGRAPH_AI_MOCK=true`:
- `ScenarioDiscoveryAgent` returns pre-defined scenarios
- `PathTracerAgent` returns pre-defined trace steps
- `VariableImaginerAgent` returns placeholder values
- `JustifierAgent` returns template justifications
- `CorrectionInterpreterAgent` returns basic structured corrections

In the config file, set `ai.provider: "mock"` for the same effect:

```yaml
ai:
  provider: "mock"
```

This is the default when no `ai.apiKey` is configured.

---

## How to Add New Tests

### Adding a unit test

1. Create or edit a file in `test/unit/`:

```typescript
// test/unit/my-feature.test.ts
import { describe, it, expect } from 'vitest';

describe('MyFeature', () => {
  it('should do the expected thing', () => {
    // arrange
    const input = createInput();

    // act
    const result = myFunction(input);

    // assert
    expect(result).toEqual(expectedOutput);
  });
});
```

2. The test will be auto-discovered by Vitest (any `.test.ts` file in `test/unit/`).

### Adding an integration test

1. Place the test in `test/integration/` or `packages/core/src/**/*.integration.test.ts`.
2. Integration tests should set up and tear down their own Neo4j test database:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

describe('My integration test', () => {
  let driver: GraphDriver;

  beforeAll(async () => {
    driver = new GraphDriver('bolt://localhost:7687', 'neo4j', 'codegraph123');
    await driver.clearDatabase('test-db');
  });

  afterAll(async () => {
    await driver.close();
  });

  it('should index and query', async () => {
    // ...
  });
});
```

3. Run with `npm run test:integration`.

### Adding an E2E test

1. Place the test in `test/e2e/`.
2. E2E tests exercise the full stack — consider using the sample project fixture.
3. Run with `npm run test:e2e`.

---

## Coverage Reporting

Vitest supports built-in coverage via `@vitest/coverage-v8`:

```bash
# Run tests with coverage
cd packages/core && npx vitest run --coverage
```

Coverage output goes to `packages/core/coverage/`.

---

## CI Considerations

- **Unit tests** run without any external services — safe for all CI environments.
- **Integration tests** require Neo4j — use the Docker image in CI:
  ```yaml
  services:
    neo4j:
      image: neo4j:5
      ports:
        - 7687:7687
      env:
        NEO4J_AUTH: neo4j/codegraph123
  ```
- **AI mock mode** is recommended for CI to avoid API key requirements and non-deterministic output:
  ```bash
  CODEGRAPH_AI_MOCK=true npm test
  ```
