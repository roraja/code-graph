/**
 * Neo4j Driver Wrapper — manages connection lifecycle, query execution,
 * and transaction handling for the CodeGraph Neo4j database.
 *
 * @module graph/driver
 */

import neo4j, {
  type Driver,
  type Session,
  type Result,
  type ManagedTransaction,
  type QueryResult,
} from 'neo4j-driver';

/** Configuration for creating a GraphDriver instance. */
export interface GraphDriverConfig {
  /** Neo4j connection URI, e.g. "bolt://localhost:7687" */
  uri: string;
  /** Authentication username */
  username: string;
  /** Authentication password */
  password: string;
  /** Target database name (defaults to "neo4j") */
  database?: string;
  /** Maximum connection pool size (defaults to 100) */
  maxConnectionPoolSize?: number;
  /** Connection acquisition timeout in ms (defaults to 60000) */
  connectionAcquisitionTimeout?: number;
}

/**
 * GraphDriver wraps the `neo4j-driver` package, providing a simplified API
 * for running Cypher queries with connection pooling and error handling.
 *
 * @example
 * ```ts
 * const driver = GraphDriver.create({
 *   uri: 'bolt://localhost:7687',
 *   username: 'neo4j',
 *   password: 'secret',
 *   database: 'codegraph',
 * });
 * await driver.connect();
 * const result = await driver.run('MATCH (n) RETURN count(n) AS cnt');
 * await driver.disconnect();
 * ```
 */
export class GraphDriver {
  private driver: Driver | null = null;
  private readonly uri: string;
  private readonly username: string;
  private readonly password: string;
  private readonly database: string;
  private readonly maxConnectionPoolSize: number;
  private readonly connectionAcquisitionTimeout: number;
  private connected = false;

  /**
   * Creates a new GraphDriver instance.
   *
   * @param uri - Neo4j bolt URI
   * @param username - Authentication username
   * @param password - Authentication password
   * @param database - Target database name
   * @param maxConnectionPoolSize - Maximum pool size
   * @param connectionAcquisitionTimeout - Pool acquisition timeout in ms
   */
  constructor(
    uri: string,
    username: string,
    password: string,
    database: string = 'neo4j',
    maxConnectionPoolSize: number = 100,
    connectionAcquisitionTimeout: number = 60_000
  ) {
    this.uri = uri;
    this.username = username;
    this.password = password;
    this.database = database;
    this.maxConnectionPoolSize = maxConnectionPoolSize;
    this.connectionAcquisitionTimeout = connectionAcquisitionTimeout;
  }

  /**
   * Factory method to create a GraphDriver from a config object.
   *
   * @param config - Driver configuration
   * @returns A new GraphDriver instance (not yet connected)
   */
  static create(config: GraphDriverConfig): GraphDriver {
    return new GraphDriver(
      config.uri,
      config.username,
      config.password,
      config.database ?? 'neo4j',
      config.maxConnectionPoolSize ?? 100,
      config.connectionAcquisitionTimeout ?? 60_000
    );
  }

  /**
   * Opens the Neo4j driver connection and verifies connectivity.
   *
   * @throws Error if the connection cannot be established
   */
  async connect(): Promise<void> {
    if (this.driver) {
      return;
    }

    try {
      this.driver = neo4j.driver(
        this.uri,
        neo4j.auth.basic(this.username, this.password),
        {
          maxConnectionPoolSize: this.maxConnectionPoolSize,
          connectionAcquisitionTimeout: this.connectionAcquisitionTimeout,
        }
      );

      // Verify connectivity by running a lightweight server info request
      await this.driver.verifyConnectivity();
      this.connected = true;
    } catch (error) {
      this.driver = null;
      this.connected = false;
      const message =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect to Neo4j at ${this.uri}: ${message}`);
    }
  }

  /**
   * Gracefully closes the driver and releases all pooled connections.
   */
  async disconnect(): Promise<void> {
    if (this.driver) {
      await this.driver.close();
      this.driver = null;
      this.connected = false;
    }
  }

  /**
   * Returns whether the driver is currently connected.
   *
   * @returns `true` if connected, `false` otherwise
   */
  isConnected(): boolean {
    return this.connected && this.driver !== null;
  }

  /**
   * Opens a new session scoped to the configured database.
   *
   * @returns A Neo4j Session
   * @throws Error if not connected
   */
  private getSession(): Session {
    if (!this.driver) {
      throw new Error(
        'GraphDriver is not connected. Call connect() first.'
      );
    }
    return this.driver.session({ database: this.database });
  }

  /**
   * Executes a single Cypher query and returns the result records.
   *
   * @param cypher - The Cypher query string
   * @param params - Optional parameter map for the query
   * @returns The Neo4j QueryResult
   *
   * @example
   * ```ts
   * const result = await driver.run(
   *   'MATCH (f:Function {qualifiedName: $name}) RETURN f',
   *   { name: 'MyClass.myMethod' }
   * );
   * ```
   */
  async run(
    cypher: string,
    params: Record<string, unknown> = {}
  ): Promise<QueryResult> {
    const session = this.getSession();
    try {
      return await session.run(cypher, params);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Cypher query failed: ${message}`);
    } finally {
      await session.close();
    }
  }

  /**
   * Executes a function within a managed write transaction.
   * The transaction is automatically committed on success and rolled back on failure.
   *
   * @param fn - An async function receiving the transaction object.
   *             Use `tx.run(cypher, params)` inside to execute queries.
   * @returns The value returned by `fn`
   *
   * @example
   * ```ts
   * const count = await driver.runInTransaction(async (tx) => {
   *   await tx.run('CREATE (f:Function {name: $name})', { name: 'foo' });
   *   const res = await tx.run('MATCH (f:Function) RETURN count(f) AS c');
   *   return res.records[0].get('c').toNumber();
   * });
   * ```
   */
  async runInTransaction<T>(
    fn: (tx: ManagedTransaction) => Promise<T>
  ): Promise<T> {
    const session = this.getSession();
    try {
      return await session.executeWrite(fn);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Transaction failed: ${message}`);
    } finally {
      await session.close();
    }
  }
}
