/**
 * Graph Schema — manages Neo4j indexes, constraints, and schema migrations
 * for the CodeGraph database.
 *
 * @module graph/schema
 */

import type { GraphDriver } from './driver.js';

/** Node/relationship counts returned by {@link GraphSchema.getStats}. */
export interface GraphStats {
  nodes: Record<string, number>;
  relationships: Record<string, number>;
  totalNodes: number;
  totalRelationships: number;
}

/**
 * GraphSchema manages the Neo4j database schema — creating indexes,
 * enforcing uniqueness constraints, and providing utility methods
 * for clearing and inspecting the graph.
 *
 * @example
 * ```ts
 * const schema = new GraphSchema(driver);
 * await schema.initialize(); // Create indexes and constraints
 * const stats = await schema.getStats();
 * console.log(stats.totalNodes);
 * ```
 */
export class GraphSchema {
  private readonly driver: GraphDriver;

  constructor(driver: GraphDriver) {
    this.driver = driver;
  }

  /**
   * Creates all indexes and uniqueness constraints required by CodeGraph.
   *
   * This method is idempotent — running it multiple times is safe because
   * Neo4j's `CREATE ... IF NOT EXISTS` syntax is used throughout.
   */
  async initialize(): Promise<void> {
    // --- Uniqueness constraints (implicitly create indexes) ---
    const constraints = [
      'CREATE CONSTRAINT function_id IF NOT EXISTS FOR (f:Function) REQUIRE f.id IS UNIQUE',
      'CREATE CONSTRAINT class_id IF NOT EXISTS FOR (c:Class) REQUIRE c.id IS UNIQUE',
      'CREATE CONSTRAINT file_path IF NOT EXISTS FOR (f:File) REQUIRE f.path IS UNIQUE',
      'CREATE CONSTRAINT branch_id IF NOT EXISTS FOR (b:Branch) REQUIRE b.id IS UNIQUE',
      'CREATE CONSTRAINT variable_id IF NOT EXISTS FOR (v:Variable) REQUIRE v.id IS UNIQUE',
      'CREATE CONSTRAINT scenario_id IF NOT EXISTS FOR (s:Scenario) REQUIRE s.id IS UNIQUE',
    ];

    // --- Composite and lookup indexes ---
    const indexes = [
      'CREATE INDEX function_qualified_name IF NOT EXISTS FOR (f:Function) ON (f.qualifiedName)',
      'CREATE INDEX function_file_path IF NOT EXISTS FOR (f:Function) ON (f.filePath)',
      'CREATE INDEX function_name IF NOT EXISTS FOR (f:Function) ON (f.name)',
      'CREATE INDEX class_qualified_name IF NOT EXISTS FOR (c:Class) ON (c.qualifiedName)',
      'CREATE INDEX class_file_path IF NOT EXISTS FOR (c:Class) ON (c.filePath)',
      'CREATE INDEX branch_function_id IF NOT EXISTS FOR (b:Branch) ON (b.functionId)',
      'CREATE INDEX variable_function_id IF NOT EXISTS FOR (v:Variable) ON (v.functionId)',
      'CREATE INDEX variable_class_id IF NOT EXISTS FOR (v:Variable) ON (v.classId)',
      'CREATE INDEX scenario_step_scenario_id IF NOT EXISTS FOR (s:ScenarioStep) ON (s.scenarioId)',
      'CREATE INDEX scenario_step_order IF NOT EXISTS FOR (s:ScenarioStep) ON (s.scenarioId, s.order)',
    ];

    for (const stmt of [...constraints, ...indexes]) {
      await this.driver.run(stmt);
    }
  }

  /**
   * Deletes all nodes and relationships from the database.
   *
   * Uses batched deletion to avoid memory issues on large graphs.
   * Loops until no more nodes remain.
   */
  async clear(): Promise<void> {
    const BATCH_SIZE = 10_000;
    let deleted: number;

    do {
      const result = await this.driver.run(
        `MATCH (n)
         WITH n LIMIT $batchSize
         DETACH DELETE n
         RETURN count(*) AS deleted`,
        { batchSize: BATCH_SIZE }
      );
      deleted = result.records[0]?.get('deleted')?.toNumber?.() ??
        Number(result.records[0]?.get('deleted') ?? 0);
    } while (deleted > 0);
  }

  /**
   * Returns counts of nodes and relationships grouped by label/type.
   *
   * @returns A {@link GraphStats} object with breakdowns and totals
   */
  async getStats(): Promise<GraphStats> {
    // Node counts by label
    const nodeResult = await this.driver.run(
      `CALL db.labels() YIELD label
       CALL apoc.cypher.run('MATCH (n:\`' + label + '\`) RETURN count(n) AS cnt', {}) YIELD value
       RETURN label, value.cnt AS count`
    );

    const nodes: Record<string, number> = {};
    let totalNodes = 0;

    // Fallback: if APOC is not available, use a simpler approach
    if (nodeResult.records.length === 0) {
      const simpleResult = await this.driver.run(
        'MATCH (n) RETURN labels(n)[0] AS label, count(n) AS count'
      );
      for (const record of simpleResult.records) {
        const label = record.get('label') as string;
        const count = typeof record.get('count') === 'object'
          ? (record.get('count') as { toNumber(): number }).toNumber()
          : Number(record.get('count'));
        if (label) {
          nodes[label] = count;
          totalNodes += count;
        }
      }
    } else {
      for (const record of nodeResult.records) {
        const label = record.get('label') as string;
        const count = typeof record.get('count') === 'object'
          ? (record.get('count') as { toNumber(): number }).toNumber()
          : Number(record.get('count'));
        nodes[label] = count;
        totalNodes += count;
      }
    }

    // Relationship counts by type
    const relResult = await this.driver.run(
      'MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS count'
    );

    const relationships: Record<string, number> = {};
    let totalRelationships = 0;

    for (const record of relResult.records) {
      const relType = record.get('type') as string;
      const count = typeof record.get('count') === 'object'
        ? (record.get('count') as { toNumber(): number }).toNumber()
        : Number(record.get('count'));
      relationships[relType] = count;
      totalRelationships += count;
    }

    return { nodes, relationships, totalNodes, totalRelationships };
  }
}
