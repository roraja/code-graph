/**
 * Query Engine — provides reusable, typed Cypher queries for
 * reading data from the CodeGraph Neo4j database.
 *
 * @module graph/queries
 */

import type { GraphDriver } from './driver.js';
import type { FunctionNode, ClassNode, BranchNode } from '../parser/interface.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** A call relationship between two functions. */
export interface CallRelation {
  /** The calling or called function */
  function: FunctionNode;
  /** File where the call occurs */
  filePath: string;
  /** Line number of the call */
  line: number;
  /** The call expression text */
  callExpression: string;
}

/** A node in a call chain path. */
export interface CallChainNode {
  /** Ordered list of function IDs forming the path */
  path: string[];
  /** Length of the path (number of edges) */
  length: number;
}

/** Class hierarchy entry showing parent/child relationships. */
export interface ClassHierarchyEntry {
  /** The class node */
  classNode: ClassNode;
  /** Relationship type: "extends" or "implements" */
  relationship: 'extends' | 'implements';
  /** Direction relative to the queried class */
  direction: 'parent' | 'child';
}

/** A scenario stored in the graph. */
export interface ScenarioResult {
  id: string;
  name: string;
  description: string;
  entryFunctionId: string;
  createdAt?: string;
}

/** A single step in a scenario walkthrough. */
export interface ScenarioStepResult {
  scenarioId: string;
  order: number;
  functionId: string;
  functionName: string;
  description: string;
  branchTaken?: string;
  variableState?: string;
}

/** Database statistics summary. */
export interface DatabaseStats {
  nodes: Record<string, number>;
  relationships: Record<string, number>;
  totalNodes: number;
  totalRelationships: number;
}

// ---------------------------------------------------------------------------
// QueryEngine
// ---------------------------------------------------------------------------

/**
 * QueryEngine provides a high-level, typed API for querying the CodeGraph
 * Neo4j database. All methods return properly shaped TypeScript objects.
 *
 * @example
 * ```ts
 * const engine = new QueryEngine(driver);
 * const fn = await engine.getFunction('src/app.ts:42');
 * const callers = await engine.getCallers(fn.id);
 * ```
 */
export class QueryEngine {
  private readonly driver: GraphDriver;

  constructor(driver: GraphDriver) {
    this.driver = driver;
  }

  /**
   * Retrieves a function node by its unique ID.
   *
   * @param id - The function ID (e.g. "src/app.ts:42")
   * @returns The function node, or `null` if not found
   */
  async getFunction(id: string): Promise<FunctionNode | null> {
    const result = await this.driver.run(
      'MATCH (f:Function {id: $id}) RETURN f',
      { id }
    );
    if (result.records.length === 0) return null;
    return this.toFunctionNode(result.records[0].get('f').properties);
  }

  /**
   * Finds a function by its fully qualified name.
   *
   * @param qualifiedName - e.g. "MyClass.myMethod"
   * @returns The function node, or `null` if not found
   */
  async getFunctionByName(
    qualifiedName: string
  ): Promise<FunctionNode | null> {
    const result = await this.driver.run(
      'MATCH (f:Function {qualifiedName: $qualifiedName}) RETURN f',
      { qualifiedName }
    );
    if (result.records.length === 0) return null;
    return this.toFunctionNode(result.records[0].get('f').properties);
  }

  /**
   * Returns all functions that call the specified function.
   *
   * @param functionId - ID of the target function
   * @returns Array of caller relationships
   */
  async getCallers(functionId: string): Promise<CallRelation[]> {
    const result = await this.driver.run(
      `MATCH (caller:Function)-[r:CALLS]->(f:Function {id: $functionId})
       RETURN caller, r.filePath AS filePath, r.line AS line, r.callExpression AS callExpression`,
      { functionId }
    );

    return result.records.map((record) => ({
      function: this.toFunctionNode(record.get('caller').properties),
      filePath: record.get('filePath') as string,
      line: this.toNumber(record.get('line')),
      callExpression: record.get('callExpression') as string,
    }));
  }

  /**
   * Returns all functions called by the specified function.
   *
   * @param functionId - ID of the calling function
   * @returns Array of callee relationships
   */
  async getCallees(functionId: string): Promise<CallRelation[]> {
    const result = await this.driver.run(
      `MATCH (f:Function {id: $functionId})-[r:CALLS]->(callee:Function)
       RETURN callee, r.filePath AS filePath, r.line AS line, r.callExpression AS callExpression`,
      { functionId }
    );

    return result.records.map((record) => ({
      function: this.toFunctionNode(record.get('callee').properties),
      filePath: record.get('filePath') as string,
      line: this.toNumber(record.get('line')),
      callExpression: record.get('callExpression') as string,
    }));
  }

  /**
   * Finds all paths between two functions up to a maximum depth.
   *
   * @param fromId - Starting function ID
   * @param toId - Target function ID
   * @param maxDepth - Maximum path length (defaults to 10)
   * @returns Array of call chain paths
   */
  async getCallChain(
    fromId: string,
    toId: string,
    maxDepth: number = 10
  ): Promise<CallChainNode[]> {
    const result = await this.driver.run(
      `MATCH path = (from:Function {id: $fromId})-[:CALLS*1..${maxDepth}]->(to:Function {id: $toId})
       RETURN [n IN nodes(path) | n.id] AS pathIds, length(path) AS len
       ORDER BY len
       LIMIT 20`,
      { fromId, toId }
    );

    return result.records.map((record) => ({
      path: record.get('pathIds') as string[],
      length: this.toNumber(record.get('len')),
    }));
  }

  /**
   * Returns the class hierarchy (parents and children) for a given class.
   *
   * @param classId - ID of the class to query
   * @returns Array of hierarchy entries
   */
  async getClassHierarchy(
    classId: string
  ): Promise<ClassHierarchyEntry[]> {
    const result = await this.driver.run(
      `MATCH (c:Class {id: $classId})-[r:EXTENDS|IMPLEMENTS]->(parent:Class)
       RETURN parent AS cls, type(r) AS relType, 'parent' AS direction
       UNION
       MATCH (child:Class)-[r:EXTENDS|IMPLEMENTS]->(c:Class {id: $classId})
       RETURN child AS cls, type(r) AS relType, 'child' AS direction`,
      { classId }
    );

    return result.records.map((record) => ({
      classNode: this.toClassNode(record.get('cls').properties),
      relationship: (record.get('relType') as string).toLowerCase() as
        | 'extends'
        | 'implements',
      direction: record.get('direction') as 'parent' | 'child',
    }));
  }

  /**
   * Returns all branch nodes (decision points) within a given function.
   *
   * @param functionId - ID of the function to query
   * @returns Array of branch nodes
   */
  async getBranches(functionId: string): Promise<BranchNode[]> {
    const result = await this.driver.run(
      `MATCH (b:Branch {functionId: $functionId})
       RETURN b
       ORDER BY b.line`,
      { functionId }
    );

    return result.records.map((record) => {
      const props = record.get('b').properties;
      return {
        id: props.id as string,
        type: props.type as string,
        condition: props.condition as string,
        functionId: props.functionId as string,
        filePath: props.filePath as string,
        line: this.toNumber(props.line),
        thenStartLine: this.toNumber(props.thenStartLine),
        thenEndLine: this.toNumber(props.thenEndLine),
        elseStartLine: props.elseStartLine != null
          ? this.toNumber(props.elseStartLine)
          : undefined,
        elseEndLine: props.elseEndLine != null
          ? this.toNumber(props.elseEndLine)
          : undefined,
      };
    });
  }

  /**
   * Finds all concrete implementations of an abstract/interface method.
   *
   * @param interfaceMethodId - ID of the abstract method
   * @returns Array of implementing function nodes
   */
  async getImplementations(
    interfaceMethodId: string
  ): Promise<FunctionNode[]> {
    const result = await this.driver.run(
      `MATCH (impl:Function)-[:OVERRIDES]->(abstract:Function {id: $interfaceMethodId})
       RETURN impl`,
      { interfaceMethodId }
    );

    return result.records.map((record) =>
      this.toFunctionNode(record.get('impl').properties)
    );
  }

  /**
   * Full-text search across function names and qualified names.
   *
   * Uses a CONTAINS filter for substring matching. For production use,
   * consider creating a Neo4j full-text index.
   *
   * @param query - Search string
   * @param limit - Maximum results to return (defaults to 25)
   * @returns Matching function nodes
   */
  async searchFunctions(
    query: string,
    limit: number = 25
  ): Promise<FunctionNode[]> {
    const result = await this.driver.run(
      `MATCH (f:Function)
       WHERE f.name CONTAINS $query OR f.qualifiedName CONTAINS $query
       RETURN f
       LIMIT $limit`,
      { query, limit }
    );

    return result.records.map((record) =>
      this.toFunctionNode(record.get('f').properties)
    );
  }

  /**
   * Retrieves a scenario by its unique ID, including metadata.
   *
   * @param id - Scenario ID
   * @returns The scenario, or `null` if not found
   */
  async getScenario(id: string): Promise<ScenarioResult | null> {
    const result = await this.driver.run(
      'MATCH (s:Scenario {id: $id}) RETURN s',
      { id }
    );
    if (result.records.length === 0) return null;

    const props = result.records[0].get('s').properties;
    return {
      id: props.id as string,
      name: props.name as string,
      description: props.description as string,
      entryFunctionId: props.entryFunctionId as string,
      createdAt: props.createdAt as string | undefined,
    };
  }

  /**
   * Retrieves ordered walkthrough steps for a scenario.
   *
   * @param scenarioId - The scenario ID
   * @param from - Optional start step index (0-based, inclusive)
   * @param to - Optional end step index (0-based, inclusive)
   * @returns Ordered array of scenario steps
   */
  async getScenarioSteps(
    scenarioId: string,
    from?: number,
    to?: number
  ): Promise<ScenarioStepResult[]> {
    let cypher =
      'MATCH (step:ScenarioStep {scenarioId: $scenarioId}) ';
    const params: Record<string, unknown> = { scenarioId };

    if (from !== undefined && to !== undefined) {
      cypher += 'WHERE step.order >= $from AND step.order <= $to ';
      params.from = from;
      params.to = to;
    } else if (from !== undefined) {
      cypher += 'WHERE step.order >= $from ';
      params.from = from;
    } else if (to !== undefined) {
      cypher += 'WHERE step.order <= $to ';
      params.to = to;
    }

    cypher += 'RETURN step ORDER BY step.order';

    const result = await this.driver.run(cypher, params);

    return result.records.map((record) => {
      const props = record.get('step').properties;
      return {
        scenarioId: props.scenarioId as string,
        order: this.toNumber(props.order),
        functionId: props.functionId as string,
        functionName: props.functionName as string,
        description: props.description as string,
        branchTaken: props.branchTaken as string | undefined,
        variableState: props.variableState as string | undefined,
      };
    });
  }

  /**
   * Finds all scenarios that include a given function in their steps.
   *
   * @param functionId - The function ID to search for
   * @returns Array of scenarios containing this function
   */
  async getScenariosForFunction(
    functionId: string
  ): Promise<ScenarioResult[]> {
    const result = await this.driver.run(
      `MATCH (step:ScenarioStep {functionId: $functionId})
       MATCH (s:Scenario {id: step.scenarioId})
       RETURN DISTINCT s`,
      { functionId }
    );

    return result.records.map((record) => {
      const props = record.get('s').properties;
      return {
        id: props.id as string,
        name: props.name as string,
        description: props.description as string,
        entryFunctionId: props.entryFunctionId as string,
        createdAt: props.createdAt as string | undefined,
      };
    });
  }

  /**
   * Returns database statistics (node and relationship counts by type).
   *
   * @returns A {@link DatabaseStats} summary
   */
  async getStats(): Promise<DatabaseStats> {
    const nodeResult = await this.driver.run(
      'MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count'
    );
    const relResult = await this.driver.run(
      'MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS count'
    );

    const nodes: Record<string, number> = {};
    let totalNodes = 0;
    for (const record of nodeResult.records) {
      const label = record.get('label') as string;
      const count = this.toNumber(record.get('count'));
      if (label) {
        nodes[label] = count;
        totalNodes += count;
      }
    }

    const relationships: Record<string, number> = {};
    let totalRelationships = 0;
    for (const record of relResult.records) {
      const relType = record.get('type') as string;
      const count = this.toNumber(record.get('count'));
      relationships[relType] = count;
      totalRelationships += count;
    }

    return { nodes, relationships, totalNodes, totalRelationships };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Converts a Neo4j Integer or JS number to a plain number.
   */
  private toNumber(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && value !== null && 'toNumber' in value) {
      return (value as { toNumber(): number }).toNumber();
    }
    return Number(value);
  }

  /**
   * Maps raw Neo4j node properties to a typed {@link FunctionNode}.
   */
  private toFunctionNode(props: Record<string, unknown>): FunctionNode {
    return {
      id: props.id as string,
      name: props.name as string,
      qualifiedName: props.qualifiedName as string,
      filePath: props.filePath as string,
      startLine: this.toNumber(props.startLine),
      endLine: this.toNumber(props.endLine),
      signature: props.signature as string,
      isAbstract: props.isAbstract as boolean,
      isOverride: props.isOverride as boolean,
      visibility: props.visibility as string,
      language: props.language as string,
      sourceCode: props.sourceCode as string,
      parameters: typeof props.parameters === 'string'
        ? JSON.parse(props.parameters)
        : (props.parameters as FunctionNode['parameters']),
      returnType: props.returnType as string,
      isExported: props.isExported as boolean,
      isAsync: props.isAsync as boolean,
      documentation: props.documentation as string | undefined,
    };
  }

  /**
   * Maps raw Neo4j node properties to a typed {@link ClassNode}.
   */
  private toClassNode(props: Record<string, unknown>): ClassNode {
    return {
      id: props.id as string,
      name: props.name as string,
      qualifiedName: props.qualifiedName as string,
      filePath: props.filePath as string,
      startLine: this.toNumber(props.startLine),
      endLine: this.toNumber(props.endLine),
      isAbstract: props.isAbstract as boolean,
      isInterface: props.isInterface as boolean,
      language: props.language as string,
      methods: typeof props.methods === 'string'
        ? JSON.parse(props.methods)
        : (props.methods as string[]),
      properties: typeof props.properties === 'string'
        ? JSON.parse(props.properties)
        : (props.properties as ClassNode['properties']),
      documentation: props.documentation as string | undefined,
    };
  }
}
