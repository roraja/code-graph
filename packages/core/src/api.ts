/**
 * CodeGraph Public API — high-level facade for programmatic consumers.
 *
 * This module provides {@link createCodeGraphClient} which wires up all
 * internal engines (driver, query engine, scenario engine, AI agents)
 * behind a simple, promise-based API.
 *
 * Consumers (e.g. the VS Code extension) import only from `@codegraph/core`
 * and call methods on {@link CodeGraphClient}. They never need to construct
 * drivers, query engines, or agents themselves.
 *
 * @module api
 */

import { GraphDriver } from './graph/driver.js';
import { GraphSchema } from './graph/schema.js';
import { CodeIndexer } from './graph/indexer.js';
import { QueryEngine } from './graph/queries.js';
import { ScenarioEngine, type Scenario, type ScenarioStep, type CreateScenarioInput } from './scenario/engine.js';
import { ScenarioTracer, type TraceConfig, type TraceResult } from './scenario/tracer.js';
import { CorrectionEngine, type Correction, type StructuredCorrection } from './correction/engine.js';
import { ScenarioDiscoveryAgent, type DiscoveredScenario } from './ai/scenario-discovery.js';
import { PathTracerAgent } from './ai/path-tracer.js';
import { VariableImaginerAgent } from './ai/variable-imaginer.js';
import { JustifierAgent } from './ai/justifier.js';
import { CorrectionInterpreterAgent } from './ai/correction-interpreter.js';
import { TypeScriptParser } from './parser/typescript.js';
import { createAIProvider, type AIProvider } from './ai/agent.js';
import { loadConfig, findProjectRoot, type CodeGraphConfig } from './config/loader.js';
import type { FunctionNode } from './parser/interface.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Combined scenario + steps view. */
export interface ScenarioView {
  scenario: Scenario;
  steps: ScenarioStep[];
}

/** Options for creating a CodeGraphClient. */
export interface CodeGraphClientOptions {
  /**
   * Path to the project root (where `.codegraph.yaml` lives).
   * If omitted, searches upward from `cwd`.
   */
  projectRoot?: string;

  /**
   * If true, uses mock AI and built-in demo data instead of
   * connecting to Neo4j. Useful when the database is unavailable.
   */
  mock?: boolean;
}

/** Function info returned by the public API (same shape as FunctionNode). */
export type { FunctionNode as FunctionInfo };

// ---------------------------------------------------------------------------
// Mock data (built-in demo data for offline / demo mode)
// ---------------------------------------------------------------------------

function getMockScenarios(): Scenario[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'user-login-flow',
      name: 'User Login Flow',
      description:
        'End-to-end user authentication including validation, token generation, and session creation.',
      discoveredBy: 'ai',
      confidence: 0.92,
      status: 'traced',
      entryFunction: 'AuthService.authenticateUser',
      triggerCondition: 'User submits login form with email and password',
      version: 2,
      createdAt: '2024-01-15T10:30:00Z',
      updatedAt: now,
    },
    {
      id: 'fetch-user-profile',
      name: 'Fetch User Profile',
      description:
        'Retrieve and return a user profile with authorization checks.',
      discoveredBy: 'ai',
      confidence: 0.85,
      status: 'validated',
      entryFunction: 'UserController.getUserProfile',
      triggerCondition: 'GET /api/users/:id is called',
      version: 1,
      createdAt: '2024-01-16T14:00:00Z',
      updatedAt: now,
    },
    {
      id: 'rate-limit-check',
      name: 'Rate Limit Check',
      description:
        'Middleware that checks request rate limits and blocks excessive requests.',
      discoveredBy: 'human',
      confidence: 1.0,
      status: 'draft',
      entryFunction: 'rateLimiter',
      triggerCondition: 'Any incoming HTTP request',
      version: 1,
      createdAt: '2024-01-17T09:00:00Z',
      updatedAt: now,
    },
  ];
}

function getMockSteps(scenarioId: string): ScenarioStep[] {
  if (scenarioId === 'user-login-flow') {
    return [
      {
        id: 'step-1',
        scenarioId,
        stepNumber: 1,
        functionId: 'src/auth/login.ts:15',
        functionName: 'AuthService.authenticateUser',
        line: 18,
        action: 'call',
        justification:
          'Entry point: the authenticateUser method is called when the user submits the login form.',
        variableState: { email: '"user@example.com"', password: '"***"' },
        sourceCode:
          'const user = await this.userRepo.findByEmail(email);',
        confidence: 0.95,
      },
      {
        id: 'step-2',
        scenarioId,
        stepNumber: 2,
        functionId: 'src/auth/login.ts:50',
        functionName: 'AuthService.validateCredentials',
        line: 55,
        action: 'call',
        justification:
          'The credentials are validated by comparing the provided password hash with the stored hash.',
        variableState: {
          email: '"user@example.com"',
          hash: '"$2b$10$..."',
        },
        sourceCode:
          'const isValid = await bcrypt.compare(password, user.passwordHash);',
        confidence: 0.9,
      },
      {
        id: 'step-3',
        scenarioId,
        stepNumber: 3,
        functionId: 'src/auth/login.ts:60',
        functionName: 'AuthService.validateCredentials',
        line: 60,
        action: 'branch_taken',
        justification:
          'The password matches, so the "valid credentials" branch is taken.',
        variableState: { isValid: 'true' },
        sourceCode: 'if (isValid) {',
        confidence: 0.88,
      },
      {
        id: 'step-4',
        scenarioId,
        stepNumber: 4,
        functionId: 'src/auth/login.ts:30',
        functionName: 'AuthService.authenticateUser',
        line: 30,
        action: 'call',
        justification:
          'A JWT token is generated for the authenticated user.',
        variableState: {
          userId: '"usr_123"',
          token: '"eyJhbG..."',
        },
        sourceCode:
          'const token = this.tokenService.generateToken(user.id);',
        confidence: 0.93,
      },
      {
        id: 'step-5',
        scenarioId,
        stepNumber: 5,
        functionId: 'src/auth/login.ts:35',
        functionName: 'AuthService.authenticateUser',
        line: 35,
        action: 'return',
        justification:
          'The authentication result is returned with the token and user info.',
        variableState: {
          result: '{ success: true, token: "eyJhbG..." }',
        },
        sourceCode:
          'return { success: true, token, user: sanitizeUser(user) };',
        confidence: 0.95,
      },
    ];
  }
  if (scenarioId === 'fetch-user-profile') {
    return [
      {
        id: 'fp-step-1',
        scenarioId,
        stepNumber: 1,
        functionId: 'src/api/users.ts:10',
        functionName: 'UserController.getUserProfile',
        line: 12,
        action: 'call',
        justification:
          'The controller receives the request and extracts the userId parameter.',
        variableState: { userId: '"usr_123"' },
        sourceCode: 'const userId = req.params.id;',
        confidence: 0.9,
      },
      {
        id: 'fp-step-2',
        scenarioId,
        stepNumber: 2,
        functionId: 'src/db/repository.ts:20',
        functionName: 'UserRepository.findById',
        line: 25,
        action: 'call',
        justification:
          'The repository queries the database for the user record.',
        variableState: { id: '"usr_123"' },
        sourceCode:
          'const user = await db.query("SELECT * FROM users WHERE id = $1", [id]);',
        confidence: 0.88,
      },
      {
        id: 'fp-step-3',
        scenarioId,
        stepNumber: 3,
        functionId: 'src/api/users.ts:10',
        functionName: 'UserController.getUserProfile',
        line: 25,
        action: 'return',
        justification:
          'The user profile is serialized and returned as JSON.',
        variableState: {
          user: '{ id: "usr_123", name: "John" }',
        },
        sourceCode: 'return res.json(serializeProfile(user));',
        confidence: 0.92,
      },
    ];
  }
  return [];
}

function getMockFunctions(): FunctionNode[] {
  return [
    {
      id: 'src/auth/login.ts:15',
      name: 'authenticateUser',
      qualifiedName: 'AuthService.authenticateUser',
      filePath: 'src/auth/login.ts',
      startLine: 15,
      endLine: 45,
      signature:
        'authenticateUser(email: string, password: string): Promise<AuthResult>',
      isAbstract: false,
      isOverride: false,
      visibility: 'public',
      language: 'ts',
      sourceCode:
        'async authenticateUser(email: string, password: string) { ... }',
      parameters: [
        { name: 'email', type: 'string', isOptional: false },
        { name: 'password', type: 'string', isOptional: false },
      ],
      returnType: 'Promise<AuthResult>',
      isExported: true,
      isAsync: true,
      documentation: 'Authenticate a user with email and password.',
    },
    {
      id: 'src/auth/login.ts:50',
      name: 'validateCredentials',
      qualifiedName: 'AuthService.validateCredentials',
      filePath: 'src/auth/login.ts',
      startLine: 50,
      endLine: 72,
      signature:
        'validateCredentials(email: string, hash: string): boolean',
      isAbstract: false,
      isOverride: false,
      visibility: 'private',
      language: 'ts',
      sourceCode:
        'private validateCredentials(email: string, hash: string) { ... }',
      parameters: [
        { name: 'email', type: 'string', isOptional: false },
        { name: 'hash', type: 'string', isOptional: false },
      ],
      returnType: 'boolean',
      isExported: false,
      isAsync: false,
    },
    {
      id: 'src/api/users.ts:10',
      name: 'getUserProfile',
      qualifiedName: 'UserController.getUserProfile',
      filePath: 'src/api/users.ts',
      startLine: 10,
      endLine: 35,
      signature:
        'getUserProfile(userId: string): Promise<UserProfile>',
      isAbstract: false,
      isOverride: false,
      visibility: 'public',
      language: 'ts',
      sourceCode: 'async getUserProfile(userId: string) { ... }',
      parameters: [
        { name: 'userId', type: 'string', isOptional: false },
      ],
      returnType: 'Promise<UserProfile>',
      isExported: true,
      isAsync: true,
      documentation: 'Fetch the profile of a user by ID.',
    },
    {
      id: 'src/db/repository.ts:20',
      name: 'findById',
      qualifiedName: 'UserRepository.findById',
      filePath: 'src/db/repository.ts',
      startLine: 20,
      endLine: 38,
      signature: 'findById(id: string): Promise<User | null>',
      isAbstract: false,
      isOverride: false,
      visibility: 'public',
      language: 'ts',
      sourceCode: 'async findById(id: string) { ... }',
      parameters: [
        { name: 'id', type: 'string', isOptional: false },
      ],
      returnType: 'Promise<User | null>',
      isExported: true,
      isAsync: true,
    },
    {
      id: 'src/middleware/rateLimit.ts:5',
      name: 'rateLimiter',
      qualifiedName: 'rateLimiter',
      filePath: 'src/middleware/rateLimit.ts',
      startLine: 5,
      endLine: 30,
      signature:
        'rateLimiter(req: Request, res: Response, next: NextFunction): void',
      isAbstract: false,
      isOverride: false,
      visibility: 'public',
      language: 'ts',
      sourceCode: 'function rateLimiter(req, res, next) { ... }',
      parameters: [
        { name: 'req', type: 'Request', isOptional: false },
        { name: 'res', type: 'Response', isOptional: false },
        { name: 'next', type: 'NextFunction', isOptional: false },
      ],
      returnType: 'void',
      isExported: true,
      isAsync: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// CodeGraphClient
// ---------------------------------------------------------------------------

/**
 * High-level client for interacting with a CodeGraph project.
 *
 * Created via {@link createCodeGraphClient}. Provides scenario listing,
 * function browsing, and AI-powered discovery — everything the VS Code
 * extension (or any other consumer) needs.
 *
 * Call {@link dispose} when done to close the database connection.
 */
export class CodeGraphClient {
  private driver: GraphDriver | null = null;
  private queryEngine: QueryEngine | null = null;
  private scenarioEngine: ScenarioEngine | null = null;
  private discoveryAgent: ScenarioDiscoveryAgent | null = null;
  private scenarioTracer: ScenarioTracer | null = null;
  private correctionEngine: CorrectionEngine | null = null;
  private config: CodeGraphConfig | null = null;
  private readonly isMock: boolean;
  private readonly projectRoot: string | undefined;
  private connected = false;

  /** @internal — use {@link createCodeGraphClient} instead. */
  constructor(options: CodeGraphClientOptions) {
    this.isMock = options.mock ?? false;
    this.projectRoot = options.projectRoot;
  }

  // -----------------------------------------------------------------------
  // Connection
  // -----------------------------------------------------------------------

  /**
   * Connect to the Neo4j database and initialize all engines.
   * No-op if already connected or in mock mode.
   */
  async connect(): Promise<void> {
    if (this.connected || this.isMock) return;

    const root = this.projectRoot ?? findProjectRoot() ?? undefined;
    this.config = loadConfig(root);

    this.driver = GraphDriver.create({
      uri: this.config.neo4j.uri,
      username: this.config.neo4j.username,
      password: this.config.neo4j.password,
      database: this.config.neo4j.database,
    });
    await this.driver.connect();

    this.queryEngine = new QueryEngine(this.driver);
    this.scenarioEngine = new ScenarioEngine(this.driver, this.queryEngine);

    const aiProvider = createAIProvider({
      provider: this.config.ai.provider,
      model: this.config.ai.model,
      apiKey: this.config.ai.apiKey,
      maxTokens: this.config.ai.maxTokensPerRequest,
      temperature: this.config.ai.temperature,
      projectRoot: root,
    });

    this.discoveryAgent = new ScenarioDiscoveryAgent(aiProvider);

    const parser = new TypeScriptParser();
    const pathTracer = new PathTracerAgent(aiProvider);
    const variableImaginer = new VariableImaginerAgent(aiProvider);
    const justifier = new JustifierAgent(aiProvider);
    const interpreter = new CorrectionInterpreterAgent(aiProvider);

    this.scenarioTracer = new ScenarioTracer(
      parser,
      this.queryEngine,
      pathTracer,
      variableImaginer,
      justifier,
    );

    this.correctionEngine = new CorrectionEngine(
      this.driver,
      this.scenarioEngine,
      this.scenarioTracer,
      interpreter,
    );

    this.connected = true;
  }

  /**
   * Probe whether the live database is reachable.
   * Returns `true` if connected (or if connect() succeeds), `false` otherwise.
   */
  async isAvailable(): Promise<boolean> {
    if (this.isMock) return false;
    if (this.connected) return true;

    try {
      await this.connect();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close the database connection and release resources.
   */
  async dispose(): Promise<void> {
    if (this.driver) {
      try {
        await this.driver.disconnect();
      } catch {
        // Ignore disconnect errors during cleanup
      }
      this.driver = null;
    }
    this.connected = false;
    this.queryEngine = null;
    this.scenarioEngine = null;
    this.discoveryAgent = null;
    this.scenarioTracer = null;
    this.correctionEngine = null;
  }

  // -----------------------------------------------------------------------
  // Scenarios
  // -----------------------------------------------------------------------

  /**
   * List all scenarios. Falls back to mock data when in mock mode.
   *
   * @param status - Optional status filter
   */
  async listScenarios(
    status?: 'draft' | 'traced' | 'validated' | 'corrected',
  ): Promise<Scenario[]> {
    if (this.isMock) {
      const all = getMockScenarios();
      return status ? all.filter((s) => s.status === status) : all;
    }

    await this.ensureConnected();
    return this.scenarioEngine!.listScenarios(status);
  }

  /**
   * Get a single scenario by ID, or `null` if not found.
   */
  async getScenario(id: string): Promise<Scenario | null> {
    if (this.isMock) {
      return getMockScenarios().find((s) => s.id === id) ?? null;
    }

    await this.ensureConnected();
    return this.scenarioEngine!.getScenario(id);
  }

  /**
   * Get a full scenario view (scenario + steps).
   */
  async getScenarioView(id: string): Promise<ScenarioView | null> {
    if (this.isMock) {
      const scenario = getMockScenarios().find((s) => s.id === id);
      if (!scenario) return null;
      const steps = getMockSteps(id);
      return { scenario, steps };
    }

    await this.ensureConnected();
    const scenario = await this.scenarioEngine!.getScenario(id);
    if (!scenario) return null;
    const steps = await this.scenarioEngine!.getSteps(id);
    return { scenario, steps };
  }

  /**
   * Get scenarios that include a specific function (by name or ID).
   * Loads all scenarios and filters by checking step function names.
   */
  async getScenariosForFunction(
    functionName: string,
  ): Promise<Scenario[]> {
    const allScenarios = await this.listScenarios();
    const matching: Scenario[] = [];

    for (const s of allScenarios) {
      try {
        const view = await this.getScenarioView(s.id);
        if (
          view?.steps.some(
            (step) =>
              step.functionName === functionName ||
              step.functionName.includes(functionName) ||
              functionName.includes(
                step.functionName.split('.').pop() ?? '',
              ),
          )
        ) {
          matching.push(s);
        }
      } catch {
        // Skip scenarios that can't be loaded
      }
    }

    return matching;
  }

  // -----------------------------------------------------------------------
  // Functions
  // -----------------------------------------------------------------------

  /**
   * Search / list functions in the code graph.
   *
   * @param search - Optional substring to search function names
   * @param limit - Maximum results (default 100)
   */
  async listFunctions(
    search?: string,
    limit = 100,
  ): Promise<FunctionNode[]> {
    if (this.isMock) {
      const all = getMockFunctions();
      if (!search) return all;
      const q = search.toLowerCase();
      return all.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.qualifiedName.toLowerCase().includes(q),
      );
    }

    await this.ensureConnected();
    return this.queryEngine!.searchFunctions(search ?? '', limit);
  }

  // -----------------------------------------------------------------------
  // Discovery
  // -----------------------------------------------------------------------

  /**
   * Use AI to discover new scenarios starting from a function.
   * After discovery, each scenario is automatically traced to generate steps.
   *
   * @param functionName - Function name / hint for the discovery agent
   * @param count - Maximum scenarios to discover (default 3)
   * @returns The discovered scenarios (also saved to the graph with traced steps)
   */
  async discoverFromFunction(
    functionName: string,
    count = 3,
  ): Promise<DiscoveredScenario[]> {
    if (this.isMock) {
      return []; // No AI in mock mode
    }

    await this.ensureConnected();

    const functions = await this.queryEngine!.searchFunctions('', 100);
    const entryPoints = functions
      .filter((f) => f.isExported)
      .map((f) => ({
        id: f.id,
        name: f.name,
        qualifiedName: f.qualifiedName,
        signature: f.signature,
        filePath: f.filePath,
        startLine: f.startLine,
        endLine: f.endLine,
        returnType: f.returnType,
        visibility: f.visibility,
        language: f.language,
        documentation: f.documentation,
        sourceCode: f.sourceCode,
      }));

    // Find the target function to build a rich hint with file/line context
    const targetFunc = functions.find(
      (f) =>
        f.name === functionName ||
        f.qualifiedName === functionName ||
        f.qualifiedName.endsWith(`::${functionName}`) ||
        f.qualifiedName.endsWith(`.${functionName}`),
    );

    let userHint: string;
    if (targetFunc) {
      userHint = [
        `Focus on scenarios starting from the function "${targetFunc.qualifiedName}".`,
        `File: ${targetFunc.filePath}`,
        `Lines: ${targetFunc.startLine}–${targetFunc.endLine}`,
        `Signature: ${targetFunc.signature}`,
        targetFunc.returnType ? `Returns: ${targetFunc.returnType}` : '',
        targetFunc.documentation ? `Documentation: ${targetFunc.documentation}` : '',
        targetFunc.sourceCode
          ? `Source code:\n${targetFunc.sourceCode.slice(0, 1000)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      // No exact match — try a partial/substring match for extra context
      const partialMatch = functions.find(
        (f) =>
          f.name.includes(functionName) ||
          f.qualifiedName.includes(functionName),
      );
      if (partialMatch) {
        userHint = [
          `Focus on scenarios starting from "${functionName}" (closest match: "${partialMatch.qualifiedName}").`,
          `File: ${partialMatch.filePath}`,
          `Lines: ${partialMatch.startLine}–${partialMatch.endLine}`,
          partialMatch.signature ? `Signature: ${partialMatch.signature}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      } else {
        userHint = `Focus on scenarios starting from "${functionName}" (not found in the graph — name may be approximate).`;
      }
    }

    const scenarios = await this.discoveryAgent!.discover({
      entryPoints,
      eventHandlers: [],
      publicAPIs: entryPoints,
      userHint,
    });

    // Save discovered scenarios and trace each one
    const saved = scenarios.slice(0, count);
    for (const s of saved) {
      const created = await this.scenarioEngine!.createScenario({
        name: s.name,
        description: s.description,
        entryFunction: s.entryFunction,
        triggerCondition: s.triggerCondition,
        discoveredBy: 'ai',
        confidence: s.confidence,
      });

      // Auto-trace the scenario to generate steps
      try {
        await this.traceScenario(created.id);
      } catch (traceErr) {
        // Tracing may fail if the entry function isn't in the graph —
        // the scenario is still saved, just without steps.
        const msg = traceErr instanceof Error ? traceErr.message : String(traceErr);
        console.warn(`[CodeGraph] Auto-trace failed for "${created.name}": ${msg}`);
      }
    }

    return saved;
  }

  // -----------------------------------------------------------------------
  // Tracing
  // -----------------------------------------------------------------------

  /**
   * Trace a scenario to generate step-by-step execution walkthrough.
   *
   * Reads the entry function, follows calls, asks AI to decide branches
   * and virtual dispatch, and saves the resulting steps to the graph.
   *
   * @param scenarioId - The scenario to trace
   * @returns The trace result with steps and metrics
   */
  async traceScenario(
    scenarioId: string,
  ): Promise<TraceResult> {
    if (this.isMock) {
      return {
        scenarioId,
        steps: [],
        functionsTraversed: 0,
        branchDecisions: 0,
        dispatchesResolved: 0,
        durationMs: 0,
      };
    }

    await this.ensureConnected();

    const scenario = await this.scenarioEngine!.getScenario(scenarioId);
    if (!scenario) {
      throw new Error(`Scenario not found: ${scenarioId}`);
    }

    const traceConfig: Partial<TraceConfig> = this.config?.tracing
      ? {
          maxDepth: this.config.tracing.maxDepth,
          maxStepsPerFunction: this.config.tracing.maxStepsPerFunction,
          boringFunctions: this.config.tracing.boringFunctions,
          boringNamespaces: this.config.tracing.boringNamespaces,
          focusFunctions: this.config.tracing.focusFunctions,
        }
      : {};

    const result = await this.scenarioTracer!.trace(scenario, traceConfig);

    // Save the traced steps
    await this.scenarioEngine!.saveSteps(scenarioId, result.steps);
    await this.scenarioEngine!.updateStatus(scenarioId, 'traced');

    return result;
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private async ensureConnected(): Promise<void> {
    if (!this.connected) {
      await this.connect();
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new CodeGraph client.
 *
 * @example
 * ```ts
 * import { createCodeGraphClient } from '@codegraph/core';
 *
 * // Live mode — connects to Neo4j using .codegraph.yaml
 * const client = createCodeGraphClient({ projectRoot: '/path/to/project' });
 *
 * // Mock mode — uses built-in demo data, no database needed
 * const demo = createCodeGraphClient({ mock: true });
 *
 * const scenarios = await client.listScenarios();
 * const view = await client.getScenarioView('user-login-flow');
 * await client.dispose();
 * ```
 */
export function createCodeGraphClient(
  options: CodeGraphClientOptions = {},
): CodeGraphClient {
  return new CodeGraphClient(options);
}
