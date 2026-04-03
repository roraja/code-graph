/**
 * Unit tests for the Neo4j graph layer.
 *
 * Uses vi.mock / vi.fn stubs so no real Neo4j connection is required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { QueryResult, ManagedTransaction } from 'neo4j-driver';
import { GraphDriver } from './driver.js';
import { GraphSchema } from './schema.js';
import { CodeIndexer } from './indexer.js';
import { QueryEngine } from './queries.js';
import type { ParseResult, FunctionNode, ClassNode } from '../parser/interface.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a mock QueryResult with the given records */
function mockQueryResult(
  records: Array<Record<string, unknown>> = []
): QueryResult {
  return {
    records: records.map((data) => ({
      get: (key: string) => data[key],
      keys: Object.keys(data),
      has: (key: string) => key in data,
      forEach: () => {},
      toObject: () => data,
      length: Object.keys(data).length,
      entries: () => Object.entries(data)[Symbol.iterator](),
      values: () => Object.values(data)[Symbol.iterator](),
      [Symbol.iterator]: () => Object.entries(data)[Symbol.iterator](),
    })),
    summary: {} as QueryResult['summary'],
  } as unknown as QueryResult;
}

/** Creates a stub GraphDriver that records and replays canned query results */
function createMockDriver(
  queryResults: Map<string, QueryResult> = new Map()
): GraphDriver & {
  _runCalls: Array<{ cypher: string; params: Record<string, unknown> }>;
  _txCalls: Array<{ cypher: string; params: Record<string, unknown> }>;
} {
  const _runCalls: Array<{
    cypher: string;
    params: Record<string, unknown>;
  }> = [];
  const _txCalls: Array<{
    cypher: string;
    params: Record<string, unknown>;
  }> = [];

  const defaultResult = mockQueryResult([]);

  const mockRun = vi.fn(
    async (cypher: string, params: Record<string, unknown> = {}) => {
      _runCalls.push({ cypher, params });
      // Return matching canned result or default
      for (const [pattern, result] of queryResults) {
        if (cypher.includes(pattern)) return result;
      }
      return defaultResult;
    }
  );

  const mockTx: ManagedTransaction = {
    run: vi.fn(
      async (cypher: string, params?: Record<string, unknown>) => {
        _txCalls.push({ cypher: cypher as string, params: params ?? {} });
        return defaultResult;
      }
    ),
  } as unknown as ManagedTransaction;

  const mockRunInTransaction = vi.fn(
    async <T>(fn: (tx: ManagedTransaction) => Promise<T>): Promise<T> => {
      return fn(mockTx);
    }
  );

  const driver = {
    run: mockRun,
    runInTransaction: mockRunInTransaction,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    isConnected: vi.fn(() => true),
    _runCalls,
    _txCalls,
  } as unknown as GraphDriver & {
    _runCalls: typeof _runCalls;
    _txCalls: typeof _txCalls;
  };

  return driver;
}

/** Minimal FunctionNode fixture */
function makeFunctionNode(overrides: Partial<FunctionNode> = {}): FunctionNode {
  return {
    id: 'src/app.ts:10',
    name: 'handleRequest',
    qualifiedName: 'AppController.handleRequest',
    filePath: 'src/app.ts',
    startLine: 10,
    endLine: 25,
    signature: 'handleRequest(req: Request): Response',
    isAbstract: false,
    isOverride: false,
    visibility: 'public',
    language: 'typescript',
    sourceCode: '/* body */',
    parameters: [{ name: 'req', type: 'Request', isOptional: false }],
    returnType: 'Response',
    isExported: true,
    isAsync: true,
    documentation: 'Handles incoming requests',
    ...overrides,
  };
}

/** Minimal ClassNode fixture */
function makeClassNode(overrides: Partial<ClassNode> = {}): ClassNode {
  return {
    id: 'src/app.ts:1',
    name: 'AppController',
    qualifiedName: 'AppController',
    filePath: 'src/app.ts',
    startLine: 1,
    endLine: 50,
    isAbstract: false,
    isInterface: false,
    language: 'typescript',
    methods: ['handleRequest'],
    properties: [
      { name: 'port', type: 'number', visibility: 'private', isStatic: false, isReadonly: true },
    ],
    ...overrides,
  };
}

/** Minimal ParseResult fixture */
function makeParseResult(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    filePath: 'src/app.ts',
    language: 'typescript',
    functions: [makeFunctionNode()],
    classes: [makeClassNode()],
    calls: [
      {
        callerId: 'src/app.ts:10',
        calleeId: 'src/util.ts:5',
        calleeName: 'validate',
        filePath: 'src/app.ts',
        line: 15,
        column: 8,
        isVirtualDispatch: false,
        callExpression: 'validate(req)',
      },
    ],
    branches: [
      {
        id: 'src/app.ts:12',
        type: 'if',
        condition: 'req.isValid',
        functionId: 'src/app.ts:10',
        filePath: 'src/app.ts',
        line: 12,
        thenStartLine: 13,
        thenEndLine: 15,
        elseStartLine: 16,
        elseEndLine: 18,
      },
    ],
    variables: [
      {
        id: 'src/app.ts:11',
        name: 'result',
        type: 'Response',
        scope: 'local',
        filePath: 'src/app.ts',
        line: 11,
        functionId: 'src/app.ts:10',
      },
    ],
    inheritances: [
      {
        childId: 'src/app.ts:1',
        parentId: 'src/base.ts:1',
        type: 'extends',
      },
    ],
    contentHash: 'abc123',
    parseTimeMs: 42,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// GraphDriver
// ---------------------------------------------------------------------------

describe('GraphDriver', () => {
  it('creates an instance via the static factory method', () => {
    const driver = GraphDriver.create({
      uri: 'bolt://localhost:7687',
      username: 'neo4j',
      password: 'test',
      database: 'testdb',
    });
    expect(driver).toBeInstanceOf(GraphDriver);
  });

  it('reports not connected before connect() is called', () => {
    const driver = GraphDriver.create({
      uri: 'bolt://localhost:7687',
      username: 'neo4j',
      password: 'test',
    });
    expect(driver.isConnected()).toBe(false);
  });

  it('wraps connection errors with a descriptive message', async () => {
    const driver = GraphDriver.create({
      uri: 'bolt://invalid-host:9999',
      username: 'neo4j',
      password: 'wrong',
    });
    await expect(driver.connect()).rejects.toThrow(
      /Failed to connect to Neo4j/
    );
    expect(driver.isConnected()).toBe(false);
  });

  it('throws when running a query without connecting first', async () => {
    const driver = GraphDriver.create({
      uri: 'bolt://localhost:7687',
      username: 'neo4j',
      password: 'test',
    });
    await expect(driver.run('RETURN 1')).rejects.toThrow(
      /not connected/i
    );
  });

  it('constructor defaults database to "neo4j"', () => {
    const driver = new GraphDriver(
      'bolt://localhost:7687',
      'neo4j',
      'test'
    );
    // If no error is thrown, defaults are applied
    expect(driver).toBeInstanceOf(GraphDriver);
    expect(driver.isConnected()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GraphSchema
// ---------------------------------------------------------------------------

describe('GraphSchema', () => {
  let driver: ReturnType<typeof createMockDriver>;
  let schema: GraphSchema;

  beforeEach(() => {
    driver = createMockDriver();
    schema = new GraphSchema(driver);
  });

  it('creates uniqueness constraints during initialize()', async () => {
    await schema.initialize();

    const constraintCalls = driver._runCalls.filter((c) =>
      c.cypher.includes('CONSTRAINT')
    );
    expect(constraintCalls.length).toBeGreaterThanOrEqual(6);

    // Check key constraints exist
    const cypherTexts = constraintCalls.map((c) => c.cypher);
    expect(cypherTexts.some((c) => c.includes('Function'))).toBe(true);
    expect(cypherTexts.some((c) => c.includes('Class'))).toBe(true);
    expect(cypherTexts.some((c) => c.includes('File'))).toBe(true);
    expect(cypherTexts.some((c) => c.includes('Scenario'))).toBe(true);
    expect(cypherTexts.some((c) => c.includes('Variable'))).toBe(true);
    expect(cypherTexts.some((c) => c.includes('Branch'))).toBe(true);
  });

  it('creates indexes during initialize()', async () => {
    await schema.initialize();

    const indexCalls = driver._runCalls.filter((c) =>
      c.cypher.includes('INDEX')
    );
    expect(indexCalls.length).toBeGreaterThanOrEqual(8);

    const cypherTexts = indexCalls.map((c) => c.cypher);
    expect(cypherTexts.some((c) => c.includes('qualifiedName'))).toBe(true);
    expect(cypherTexts.some((c) => c.includes('filePath'))).toBe(true);
  });

  it('clear() runs DETACH DELETE in a loop', async () => {
    // First call returns deleted > 0, second returns 0 to stop the loop
    let callCount = 0;
    (driver.run as ReturnType<typeof vi.fn>).mockImplementation(
      async (cypher: string, params: Record<string, unknown> = {}) => {
        callCount++;
        const deleted = callCount === 1 ? 500 : 0;
        return mockQueryResult([
          { deleted: { toNumber: () => deleted } },
        ]);
      }
    );

    await schema.clear();

    expect(callCount).toBe(2);
    const mockCalls = (driver.run as ReturnType<typeof vi.fn>).mock.calls;
    const deleteCalls = mockCalls.filter((args: unknown[]) =>
      (args[0] as string).includes('DETACH DELETE')
    );
    expect(deleteCalls.length).toBe(2);
  });

  it('getStats() returns node and relationship counts', async () => {
    const nodeResultData = [
      { label: 'Function', count: { toNumber: () => 42 } },
      { label: 'Class', count: { toNumber: () => 5 } },
    ];
    const relResultData = [
      { type: 'CALLS', count: { toNumber: () => 100 } },
      { type: 'CONTAINS', count: { toNumber: () => 47 } },
    ];

    let callIdx = 0;
    (driver.run as ReturnType<typeof vi.fn>).mockImplementation(
      async (cypher: string) => {
        callIdx++;
        // First call = APOC (empty = trigger fallback), second = fallback nodes, third = rels
        if (callIdx === 1) return mockQueryResult([]);
        if (callIdx === 2) return mockQueryResult(nodeResultData);
        return mockQueryResult(relResultData);
      }
    );

    const stats = await schema.getStats();

    expect(stats.nodes.Function).toBe(42);
    expect(stats.nodes.Class).toBe(5);
    expect(stats.totalNodes).toBe(47);
    expect(stats.relationships.CALLS).toBe(100);
    expect(stats.relationships.CONTAINS).toBe(47);
    expect(stats.totalRelationships).toBe(147);
  });
});

// ---------------------------------------------------------------------------
// CodeIndexer
// ---------------------------------------------------------------------------

describe('CodeIndexer', () => {
  let driver: ReturnType<typeof createMockDriver>;
  let indexer: CodeIndexer;

  beforeEach(() => {
    driver = createMockDriver();
    indexer = new CodeIndexer(driver);
  });

  it('indexParseResult() runs inside a transaction', async () => {
    const result = makeParseResult();
    await indexer.indexParseResult(result);

    expect(driver.runInTransaction).toHaveBeenCalledTimes(1);
  });

  it('creates a File node with MERGE', async () => {
    await indexer.indexParseResult(makeParseResult());

    const fileMerge = driver._txCalls.find(
      (c) => c.cypher.includes('MERGE (file:File')
    );
    expect(fileMerge).toBeDefined();
    expect(fileMerge!.params.path).toBe('src/app.ts');
    expect(fileMerge!.params.language).toBe('typescript');
  });

  it('merges Function nodes via UNWIND', async () => {
    await indexer.indexParseResult(makeParseResult());

    const fnMerge = driver._txCalls.find(
      (c) =>
        c.cypher.includes('MERGE (f:Function') &&
        c.cypher.includes('UNWIND')
    );
    expect(fnMerge).toBeDefined();
    const functions = fnMerge!.params.functions as Array<Record<string, unknown>>;
    expect(functions).toHaveLength(1);
    expect(functions[0].name).toBe('handleRequest');
  });

  it('creates CALLS edges via UNWIND', async () => {
    await indexer.indexParseResult(makeParseResult());

    const callsMerge = driver._txCalls.find(
      (c) =>
        c.cypher.includes('MERGE (caller)-[r:CALLS]->(callee)') ||
        c.cypher.includes(':CALLS')
    );
    expect(callsMerge).toBeDefined();
    const calls = callsMerge!.params.calls as Array<Record<string, unknown>>;
    expect(calls).toHaveLength(1);
    expect(calls[0].callerId).toBe('src/app.ts:10');
    expect(calls[0].calleeId).toBe('src/util.ts:5');
  });

  it('creates Branch nodes with HAS_BRANCH edges', async () => {
    await indexer.indexParseResult(makeParseResult());

    const branchMerge = driver._txCalls.find((c) =>
      c.cypher.includes('MERGE (b:Branch')
    );
    expect(branchMerge).toBeDefined();
    expect(branchMerge!.cypher).toContain(':HAS_BRANCH');
  });

  it('creates Variable nodes', async () => {
    await indexer.indexParseResult(makeParseResult());

    const varMerge = driver._txCalls.find((c) =>
      c.cypher.includes('MERGE (var:Variable')
    );
    expect(varMerge).toBeDefined();
  });

  it('creates EXTENDS edges for inheritance', async () => {
    await indexer.indexParseResult(makeParseResult());

    const extendsMerge = driver._txCalls.find((c) =>
      c.cypher.includes(':EXTENDS')
    );
    expect(extendsMerge).toBeDefined();
    const edges = extendsMerge!.params.edges as Array<Record<string, unknown>>;
    expect(edges[0].childId).toBe('src/app.ts:1');
    expect(edges[0].parentId).toBe('src/base.ts:1');
  });

  it('creates MEMBER_OF edges for class methods', async () => {
    await indexer.indexParseResult(makeParseResult());

    const memberMerge = driver._txCalls.find((c) =>
      c.cypher.includes(':MEMBER_OF')
    );
    expect(memberMerge).toBeDefined();
    const methods = memberMerge!.params.methods as Array<Record<string, unknown>>;
    expect(methods[0].className).toBe('AppController');
  });

  it('removeFile() deletes all nodes for a file path', async () => {
    await indexer.removeFile('src/app.ts');

    expect(driver.runInTransaction).toHaveBeenCalledTimes(1);
    const deleteCalls = driver._txCalls.filter((c) =>
      c.cypher.includes('DETACH DELETE')
    );
    // Should delete Functions, Classes, Branches, Variables, and File
    expect(deleteCalls.length).toBe(5);
    // All should reference the file path
    for (const call of deleteCalls) {
      expect(call.params.filePath).toBe('src/app.ts');
    }
  });

  it('indexDirectory() indexes each result', async () => {
    const results = [
      makeParseResult({ filePath: 'a.ts' }),
      makeParseResult({ filePath: 'b.ts' }),
    ];
    await indexer.indexDirectory(results);

    expect(driver.runInTransaction).toHaveBeenCalledTimes(2);
  });

  it('handles empty parse results gracefully', async () => {
    const empty = makeParseResult({
      functions: [],
      classes: [],
      calls: [],
      branches: [],
      variables: [],
      inheritances: [],
    });
    await indexer.indexParseResult(empty);

    // Only the File node merge should have been executed
    const fileMerge = driver._txCalls.filter((c) =>
      c.cypher.includes('MERGE (file:File')
    );
    expect(fileMerge.length).toBe(1);

    // No function/class/call/branch/variable merges
    const otherMerges = driver._txCalls.filter(
      (c) =>
        c.cypher.includes('MERGE (f:Function') ||
        c.cypher.includes('MERGE (c:Class') ||
        c.cypher.includes(':CALLS') ||
        c.cypher.includes('MERGE (b:Branch') ||
        c.cypher.includes('MERGE (var:Variable')
    );
    expect(otherMerges.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// QueryEngine
// ---------------------------------------------------------------------------

describe('QueryEngine', () => {
  let driver: ReturnType<typeof createMockDriver>;
  let engine: QueryEngine;

  /** Creates a mock Neo4j node with .properties */
  const mockNode = (props: Record<string, unknown>) => ({ properties: props });

  const fnProps = {
    id: 'src/app.ts:10',
    name: 'handleRequest',
    qualifiedName: 'AppController.handleRequest',
    filePath: 'src/app.ts',
    startLine: 10,
    endLine: 25,
    signature: 'handleRequest(req: Request): Response',
    isAbstract: false,
    isOverride: false,
    visibility: 'public',
    language: 'typescript',
    sourceCode: '/* body */',
    parameters: '[]',
    returnType: 'Response',
    isExported: true,
    isAsync: true,
    documentation: 'Handles requests',
  };

  beforeEach(() => {
    driver = createMockDriver();
    engine = new QueryEngine(driver);
  });

  it('getFunction() returns a typed FunctionNode', async () => {
    (driver.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockQueryResult([{ f: mockNode(fnProps) }])
    );

    const fn = await engine.getFunction('src/app.ts:10');

    expect(fn).not.toBeNull();
    expect(fn!.id).toBe('src/app.ts:10');
    expect(fn!.name).toBe('handleRequest');
    expect(fn!.isAsync).toBe(true);
    expect(Array.isArray(fn!.parameters)).toBe(true);
  });

  it('getFunction() returns null when not found', async () => {
    (driver.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockQueryResult([])
    );

    const fn = await engine.getFunction('nonexistent');
    expect(fn).toBeNull();
  });

  it('getFunctionByName() queries by qualifiedName', async () => {
    (driver.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockQueryResult([{ f: mockNode(fnProps) }])
    );

    const fn = await engine.getFunctionByName('AppController.handleRequest');

    expect(fn).not.toBeNull();
    expect(fn!.qualifiedName).toBe('AppController.handleRequest');

    // Verify the query used qualifiedName parameter
    const mockCalls = (driver.run as ReturnType<typeof vi.fn>).mock.calls;
    expect(mockCalls[0][1].qualifiedName).toBe('AppController.handleRequest');
  });

  it('getCallers() returns caller relationships', async () => {
    (driver.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockQueryResult([
        {
          caller: mockNode({ ...fnProps, id: 'src/main.ts:1', name: 'main' }),
          filePath: 'src/main.ts',
          line: 5,
          callExpression: 'controller.handleRequest(req)',
        },
      ])
    );

    const callers = await engine.getCallers('src/app.ts:10');

    expect(callers).toHaveLength(1);
    expect(callers[0].function.name).toBe('main');
    expect(callers[0].line).toBe(5);
    expect(callers[0].callExpression).toBe(
      'controller.handleRequest(req)'
    );
  });

  it('getCallees() returns callee relationships', async () => {
    (driver.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockQueryResult([
        {
          callee: mockNode({ ...fnProps, id: 'src/util.ts:5', name: 'validate' }),
          filePath: 'src/app.ts',
          line: 15,
          callExpression: 'validate(req)',
        },
      ])
    );

    const callees = await engine.getCallees('src/app.ts:10');

    expect(callees).toHaveLength(1);
    expect(callees[0].function.name).toBe('validate');
  });

  it('getCallChain() finds paths between functions', async () => {
    (driver.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockQueryResult([
        {
          pathIds: ['a', 'b', 'c'],
          len: { toNumber: () => 2 },
        },
      ])
    );

    const chains = await engine.getCallChain('a', 'c', 5);

    expect(chains).toHaveLength(1);
    expect(chains[0].path).toEqual(['a', 'b', 'c']);
    expect(chains[0].length).toBe(2);

    // Verify maxDepth is embedded in the query
    const mockCalls = (driver.run as ReturnType<typeof vi.fn>).mock.calls;
    expect(mockCalls[0][0]).toContain('*1..5');
  });

  it('getClassHierarchy() returns parents and children', async () => {
    const parentProps = {
      id: 'src/base.ts:1',
      name: 'BaseController',
      qualifiedName: 'BaseController',
      filePath: 'src/base.ts',
      startLine: 1,
      endLine: 30,
      isAbstract: true,
      isInterface: false,
      language: 'typescript',
      methods: '[]',
      properties: '[]',
    };

    (driver.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockQueryResult([
        {
          cls: mockNode(parentProps),
          relType: 'EXTENDS',
          direction: 'parent',
        },
      ])
    );

    const hierarchy = await engine.getClassHierarchy('src/app.ts:1');

    expect(hierarchy).toHaveLength(1);
    expect(hierarchy[0].classNode.name).toBe('BaseController');
    expect(hierarchy[0].relationship).toBe('extends');
    expect(hierarchy[0].direction).toBe('parent');
  });

  it('getImplementations() returns implementing functions', async () => {
    (driver.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockQueryResult([{ impl: mockNode(fnProps) }])
    );

    const impls = await engine.getImplementations('abstract:1');

    expect(impls).toHaveLength(1);
    expect(impls[0].id).toBe('src/app.ts:10');
  });

  it('searchFunctions() queries by CONTAINS filter', async () => {
    (driver.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockQueryResult([{ f: mockNode(fnProps) }])
    );

    const results = await engine.searchFunctions('handle', 10);

    expect(results).toHaveLength(1);
    const mockCalls = (driver.run as ReturnType<typeof vi.fn>).mock.calls;
    expect(mockCalls[0][1].query).toBe('handle');
    expect(mockCalls[0][1].limit).toBe(10);
  });

  it('getScenario() returns null when not found', async () => {
    (driver.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockQueryResult([])
    );

    const scenario = await engine.getScenario('nonexistent');
    expect(scenario).toBeNull();
  });

  it('getScenario() returns scenario data', async () => {
    (driver.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockQueryResult([
        {
          s: mockNode({
            id: 'sc-1',
            name: 'Login Flow',
            description: 'User login scenario',
            entryFunctionId: 'src/auth.ts:10',
          }),
        },
      ])
    );

    const scenario = await engine.getScenario('sc-1');

    expect(scenario).not.toBeNull();
    expect(scenario!.id).toBe('sc-1');
    expect(scenario!.name).toBe('Login Flow');
    expect(scenario!.entryFunctionId).toBe('src/auth.ts:10');
  });

  it('getScenarioSteps() supports from/to pagination', async () => {
    (driver.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockQueryResult([
        {
          step: mockNode({
            scenarioId: 'sc-1',
            order: 2,
            functionId: 'src/auth.ts:20',
            functionName: 'validateToken',
            description: 'Validate JWT token',
          }),
        },
      ])
    );

    const steps = await engine.getScenarioSteps('sc-1', 2, 5);

    expect(steps).toHaveLength(1);
    expect(steps[0].order).toBe(2);
    expect(steps[0].functionName).toBe('validateToken');

    // Verify the query includes range parameters
    const mockCalls = (driver.run as ReturnType<typeof vi.fn>).mock.calls;
    expect(mockCalls[0][1].from).toBe(2);
    expect(mockCalls[0][1].to).toBe(5);
    expect(mockCalls[0][0]).toContain('step.order >= $from');
    expect(mockCalls[0][0]).toContain('step.order <= $to');
  });

  it('getScenariosForFunction() returns matching scenarios', async () => {
    (driver.run as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      mockQueryResult([
        {
          s: mockNode({
            id: 'sc-1',
            name: 'Login Flow',
            description: 'User login',
            entryFunctionId: 'src/auth.ts:10',
          }),
        },
      ])
    );

    const scenarios = await engine.getScenariosForFunction('src/auth.ts:10');

    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].id).toBe('sc-1');
  });

  it('getStats() returns node and relationship counts', async () => {
    (driver.run as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(
        mockQueryResult([
          { label: 'Function', count: { toNumber: () => 10 } },
          { label: 'Class', count: { toNumber: () => 3 } },
        ])
      )
      .mockResolvedValueOnce(
        mockQueryResult([
          { type: 'CALLS', count: { toNumber: () => 20 } },
        ])
      );

    const stats = await engine.getStats();

    expect(stats.nodes.Function).toBe(10);
    expect(stats.nodes.Class).toBe(3);
    expect(stats.totalNodes).toBe(13);
    expect(stats.relationships.CALLS).toBe(20);
    expect(stats.totalRelationships).toBe(20);
  });
});
