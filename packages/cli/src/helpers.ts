/**
 * Shared helpers for the CodeGraph CLI.
 *
 * Provides utility functions for loading configuration, creating engine
 * instances, formatting errors, and connecting to the graph database.
 *
 * @module cli/helpers
 */

import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import {
  loadConfig,
  GraphDriver,
  GraphSchema,
  CodeIndexer,
  QueryEngine,
  ScenarioEngine,
  ScenarioTracer,
  CorrectionEngine,
  ScenarioDiscoveryAgent,
  PathTracerAgent,
  VariableImaginerAgent,
  JustifierAgent,
  CorrectionInterpreterAgent,
  TypeScriptParser,
  type CodeGraphConfig,
  type AIProvider,
} from '@codegraph/core';

/**
 * Loaded context containing all initialized engines and drivers.
 * Returned by {@link loadContext} for use by CLI commands.
 */
export interface CLIContext {
  config: CodeGraphConfig;
  driver: GraphDriver;
  schema: GraphSchema;
  indexer: CodeIndexer;
  queryEngine: QueryEngine;
  scenarioEngine: ScenarioEngine;
  aiProvider: AIProvider;
}

/**
 * Extended context that also includes the scenario tracer and correction engine.
 * Requires AI provider to be configured.
 */
export interface FullCLIContext extends CLIContext {
  scenarioTracer: ScenarioTracer;
  correctionEngine: CorrectionEngine;
  discoveryAgent: ScenarioDiscoveryAgent;
}

/**
 * Load the CodeGraph configuration from disk.
 *
 * @param configPath - Optional path to the project root or config file
 * @returns The validated configuration
 */
export function loadCLIConfig(configPath?: string): CodeGraphConfig {
  try {
    return loadConfig(configPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red('✖ Configuration error:'), message);
    console.error(
      chalk.dim('  Run ') +
        chalk.cyan('codegraph init') +
        chalk.dim(' to create a .codegraph.yaml file.')
    );
    process.exit(1);
  }
}

/**
 * Create a GraphDriver from config and connect to Neo4j.
 *
 * @param config - The CodeGraph configuration
 * @returns Connected GraphDriver instance
 */
export async function connectDriver(config: CodeGraphConfig): Promise<GraphDriver> {
  const driver = GraphDriver.create({
    uri: config.neo4j.uri,
    username: config.neo4j.username,
    password: config.neo4j.password,
    database: config.neo4j.database,
  });
  await driver.connect();
  return driver;
}

/**
 * Create an AIProvider by dynamically importing the factory from core.
 *
 * @param config - The CodeGraph configuration
 * @returns An AIProvider instance
 */
async function createProvider(config: CodeGraphConfig): Promise<AIProvider> {
  // The createAIProvider factory lives in the ai/agent module of core.
  // We dynamically import it to avoid depending on non-public API at the type level.
  const agentModule = await import('@codegraph/core') as Record<string, unknown>;
  const factory = (agentModule as { createAIProvider?: (cfg: unknown) => AIProvider }).createAIProvider;

  if (typeof factory === 'function') {
    return factory({
      provider: config.ai.provider,
      model: config.ai.model,
      apiKey: config.ai.apiKey,
      maxTokens: config.ai.maxTokensPerRequest,
      temperature: config.ai.temperature,
    });
  }

  // Fallback: if createAIProvider is not available, throw an informative error.
  throw new Error(
    'createAIProvider is not exported from @codegraph/core. ' +
    'Add `export { createAIProvider } from \'./ai/agent.js\';` to core/src/index.ts.'
  );
}

/**
 * Create the base CLI context: load config, connect to Neo4j, and
 * instantiate core engines.
 *
 * @param configPath - Optional path override for configuration
 * @returns Initialized CLI context
 */
export async function loadContext(configPath?: string): Promise<CLIContext> {
  const config = loadCLIConfig(configPath);
  const driver = await connectDriver(config);
  const schema = new GraphSchema(driver);
  const indexer = new CodeIndexer(driver);
  const queryEngine = new QueryEngine(driver);
  const scenarioEngine = new ScenarioEngine(driver, queryEngine);

  const aiProvider = await createProvider(config);

  return { config, driver, schema, indexer, queryEngine, scenarioEngine, aiProvider };
}

/**
 * Create a full CLI context including AI-powered engines.
 *
 * @param configPath - Optional path override for configuration
 * @returns Fully initialized CLI context with AI agents
 */
export async function loadFullContext(configPath?: string): Promise<FullCLIContext> {
  const ctx = await loadContext(configPath);

  const parser = new TypeScriptParser();
  const pathTracer = new PathTracerAgent(ctx.aiProvider);
  const variableImaginer = new VariableImaginerAgent(ctx.aiProvider);
  const justifier = new JustifierAgent(ctx.aiProvider);
  const discoveryAgent = new ScenarioDiscoveryAgent(ctx.aiProvider);
  const interpreter = new CorrectionInterpreterAgent(ctx.aiProvider);

  const scenarioTracer = new ScenarioTracer(
    parser,
    ctx.queryEngine,
    pathTracer,
    variableImaginer,
    justifier
  );

  const correctionEngine = new CorrectionEngine(
    ctx.driver,
    ctx.scenarioEngine,
    scenarioTracer,
    interpreter
  );

  return { ...ctx, scenarioTracer, correctionEngine, discoveryAgent };
}

/**
 * Format and display an error message with chalk styling.
 *
 * @param err - The error to display
 * @param verbose - Whether to show the full stack trace
 */
export function handleError(err: unknown, verbose = false): void {
  if (err instanceof Error) {
    console.error(chalk.red('✖ Error:'), err.message);
    if (verbose && err.stack) {
      console.error(chalk.dim(err.stack));
    }
  } else {
    console.error(chalk.red('✖ Error:'), String(err));
  }
}

/**
 * Gracefully disconnect the graph driver and exit.
 *
 * @param driver - The graph driver to disconnect
 * @param code - Exit code (default: 0)
 */
export async function gracefulExit(driver: GraphDriver, code = 0): Promise<void> {
  try {
    await driver.disconnect();
  } catch {
    // Ignore disconnect errors during shutdown
  }
  process.exit(code);
}

/**
 * Create and start an ora spinner with consistent styling.
 *
 * @param text - The spinner message text
 * @returns The started spinner instance
 */
export function startSpinner(text: string): Ora {
  return ora({ text, color: 'cyan' }).start();
}

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * @param ms - Duration in milliseconds
 * @returns Formatted string like "1.2s" or "350ms"
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Print a section header with chalk styling.
 *
 * @param title - The section title
 */
export function printHeader(title: string): void {
  console.log();
  console.log(chalk.bold.underline(title));
  console.log();
}

// ---------------------------------------------------------------------------
// Mock data helpers — for demo mode when Neo4j is unavailable
// ---------------------------------------------------------------------------

import type { Scenario, ScenarioStep } from '@codegraph/core';
import type { FunctionNode } from '@codegraph/core';

/** Sample functions for mock/demo mode */
export function getMockFunctions(): FunctionNode[] {
  return [
    {
      id: 'src/auth/login.ts:15',
      name: 'authenticateUser',
      qualifiedName: 'AuthService.authenticateUser',
      filePath: 'src/auth/login.ts',
      startLine: 15,
      endLine: 45,
      signature: 'authenticateUser(email: string, password: string): Promise<AuthResult>',
      isAbstract: false,
      isOverride: false,
      visibility: 'public',
      language: 'ts',
      sourceCode: 'async authenticateUser(email: string, password: string) { ... }',
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
      signature: 'validateCredentials(email: string, hash: string): boolean',
      isAbstract: false,
      isOverride: false,
      visibility: 'private',
      language: 'ts',
      sourceCode: 'private validateCredentials(email: string, hash: string) { ... }',
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
      signature: 'getUserProfile(userId: string): Promise<UserProfile>',
      isAbstract: false,
      isOverride: false,
      visibility: 'public',
      language: 'ts',
      sourceCode: 'async getUserProfile(userId: string) { ... }',
      parameters: [{ name: 'userId', type: 'string', isOptional: false }],
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
      parameters: [{ name: 'id', type: 'string', isOptional: false }],
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
      signature: 'rateLimiter(req: Request, res: Response, next: NextFunction): void',
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

/** Sample scenarios for mock/demo mode */
export function getMockScenarios(): Scenario[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'user-login-flow',
      name: 'User Login Flow',
      description: 'End-to-end user authentication including validation, token generation, and session creation.',
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
      description: 'Retrieve and return a user profile with authorization checks.',
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
      description: 'Middleware that checks request rate limits and blocks excessive requests.',
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

/** Sample steps for a mock scenario */
export function getMockSteps(scenarioId: string): ScenarioStep[] {
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
        justification: 'Entry point: the authenticateUser method is called when the user submits the login form.',
        variableState: { email: '"user@example.com"', password: '"***"' },
        sourceCode: 'const user = await this.userRepo.findByEmail(email);',
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
        justification: 'The credentials are validated by comparing the provided password hash with the stored hash.',
        variableState: { email: '"user@example.com"', hash: '"$2b$10$..."' },
        sourceCode: 'const isValid = await bcrypt.compare(password, user.passwordHash);',
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
        justification: 'The password matches, so the "valid credentials" branch is taken.',
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
        justification: 'A JWT token is generated for the authenticated user.',
        variableState: { userId: '"usr_123"', token: '"eyJhbG..."' },
        sourceCode: 'const token = this.tokenService.generateToken(user.id);',
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
        justification: 'The authentication result is returned with the token and user info.',
        variableState: { result: '{ success: true, token: "eyJhbG..." }' },
        sourceCode: 'return { success: true, token, user: sanitizeUser(user) };',
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
        justification: 'The controller receives the request and extracts the userId parameter.',
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
        justification: 'The repository queries the database for the user record.',
        variableState: { id: '"usr_123"' },
        sourceCode: 'const user = await db.query("SELECT * FROM users WHERE id = $1", [id]);',
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
        justification: 'The user profile is serialized and returned as JSON.',
        variableState: { user: '{ id: "usr_123", name: "John" }' },
        sourceCode: 'return res.json(serializeProfile(user));',
        confidence: 0.92,
      },
    ];
  }
  return [];
}

/** Mock caller/callee data */
export interface MockCallRelation {
  functionName: string;
  filePath: string;
  line: number;
}

/** Get mock callers for a function */
export function getMockCallers(functionName: string): MockCallRelation[] {
  const callerMap: Record<string, MockCallRelation[]> = {
    'AuthService.authenticateUser': [
      { functionName: 'LoginController.handleLogin', filePath: 'src/api/auth.ts', line: 22 },
      { functionName: 'OAuthCallback.onSuccess', filePath: 'src/auth/oauth.ts', line: 45 },
    ],
    'AuthService.validateCredentials': [
      { functionName: 'AuthService.authenticateUser', filePath: 'src/auth/login.ts', line: 25 },
    ],
    'UserController.getUserProfile': [
      { functionName: 'router.get("/users/:id")', filePath: 'src/routes/users.ts', line: 8 },
    ],
    'UserRepository.findById': [
      { functionName: 'UserController.getUserProfile', filePath: 'src/api/users.ts', line: 15 },
      { functionName: 'AuthService.authenticateUser', filePath: 'src/auth/login.ts', line: 20 },
    ],
  };
  return callerMap[functionName] ?? [];
}

/** Get mock callees for a function */
export function getMockCallees(functionName: string): MockCallRelation[] {
  const calleeMap: Record<string, MockCallRelation[]> = {
    'AuthService.authenticateUser': [
      { functionName: 'UserRepository.findByEmail', filePath: 'src/db/repository.ts', line: 40 },
      { functionName: 'AuthService.validateCredentials', filePath: 'src/auth/login.ts', line: 50 },
      { functionName: 'TokenService.generateToken', filePath: 'src/auth/token.ts', line: 10 },
    ],
    'UserController.getUserProfile': [
      { functionName: 'UserRepository.findById', filePath: 'src/db/repository.ts', line: 20 },
      { functionName: 'serializeProfile', filePath: 'src/api/serializers.ts', line: 5 },
    ],
    'UserRepository.findById': [
      { functionName: 'db.query', filePath: 'src/db/connection.ts', line: 15 },
    ],
  };
  return calleeMap[functionName] ?? [];
}

// ---------------------------------------------------------------------------
// Pretty-print helpers for scenarios, steps, and call trees
// ---------------------------------------------------------------------------

/**
 * Pretty-print a scenario summary header.
 */
export function printScenarioSummary(scenario: Scenario): void {
  const statusColors: Record<string, (t: string) => string> = {
    draft: chalk.dim,
    traced: chalk.blue,
    validated: chalk.green,
    corrected: chalk.yellow,
  };
  const colorFn = statusColors[scenario.status] ?? chalk.white;
  const confPct = (scenario.confidence * 100).toFixed(0) + '%';
  const confColor = scenario.confidence >= 0.8
    ? chalk.green(confPct)
    : scenario.confidence >= 0.5
      ? chalk.yellow(confPct)
      : chalk.red(confPct);

  console.log(chalk.bold('╔══════════════════════════════════════════════════════════════╗'));
  console.log(chalk.bold('║  ') + chalk.bold.cyan(scenario.name.padEnd(57)) + chalk.bold('║'));
  console.log(chalk.bold('╚══════════════════════════════════════════════════════════════╝'));
  console.log(`  ${chalk.dim('ID:')}          ${scenario.id}`);
  console.log(`  ${chalk.dim('Status:')}      ${colorFn(scenario.status)}`);
  console.log(`  ${chalk.dim('Confidence:')}  ${confColor}`);
  console.log(`  ${chalk.dim('Entry:')}       ${chalk.cyan(scenario.entryFunction)}`);
  console.log(`  ${chalk.dim('Trigger:')}     ${scenario.triggerCondition}`);
  console.log(`  ${chalk.dim('Version:')}     ${scenario.version}`);
  console.log(`  ${chalk.dim('Discovered:')} ${scenario.discoveredBy === 'ai' ? '🤖 AI' : '👤 Human'}`);
  console.log(`  ${chalk.dim('Description:')} ${scenario.description}`);
}

/**
 * Pretty-print a scenario step with source code and justification.
 */
export function printStepDetail(step: ScenarioStep, totalSteps?: number): void {
  const total = totalSteps ?? '?';
  const actionColors: Record<string, (t: string) => string> = {
    call: chalk.blue,
    branch_taken: chalk.green,
    branch_skipped: chalk.red,
    dispatch: chalk.magenta,
    return: chalk.yellow,
    assign: chalk.cyan,
  };
  const actionFn = actionColors[step.action] ?? chalk.white;

  console.log();
  console.log(chalk.bold(`── Step ${step.stepNumber}/${total} ──`) + '  ' +
    actionFn(step.action) + '  ' +
    chalk.dim(`[${step.functionName}:${step.line}]`));

  if (step.sourceCode) {
    console.log(chalk.dim('  Source: ') + chalk.white(step.sourceCode.trim()));
  }

  console.log(chalk.dim('  Justification: ') + chalk.white(step.justification));

  const confPct = (step.confidence * 100).toFixed(0) + '%';
  const filled = Math.round(step.confidence * 10);
  const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
  const confColor = step.confidence >= 0.8
    ? chalk.green
    : step.confidence >= 0.5
      ? chalk.yellow
      : chalk.red;
  console.log(chalk.dim('  Confidence: ') + confColor(bar + ' ' + confPct));

  // Variable state
  const vars = step.variableState;
  if (Object.keys(vars).length > 0) {
    console.log(chalk.dim('  Variables:'));
    for (const [key, value] of Object.entries(vars)) {
      console.log(chalk.cyan(`    ${key}`) + chalk.dim(' = ') + chalk.white(JSON.stringify(value)));
    }
  }

  if (step.correctedBy) {
    console.log(chalk.magenta('  ✎ Corrected: ') + chalk.dim(step.correctionNote ?? ''));
  }
}

/**
 * Print a tree-formatted call graph showing callers and callees.
 */
export function printCallTree(
  functionName: string,
  callers: MockCallRelation[],
  callees: MockCallRelation[]
): void {
  console.log();
  console.log(chalk.bold('Call Graph for ') + chalk.cyan(functionName));
  console.log();

  // Callers section
  console.log(chalk.dim('  Callers (who calls this):'));
  if (callers.length === 0) {
    console.log(chalk.dim('    (none)'));
  } else {
    for (let i = 0; i < callers.length; i++) {
      const c = callers[i]!;
      const isLast = i === callers.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      console.log(chalk.dim('    ' + connector) + chalk.white(c.functionName) +
        chalk.dim(` (${c.filePath}:${c.line})`));
    }
  }

  // Target
  console.log();
  console.log(chalk.dim('    ') + chalk.bold.cyan('● ' + functionName));
  console.log();

  // Callees section
  console.log(chalk.dim('  Callees (what this calls):'));
  if (callees.length === 0) {
    console.log(chalk.dim('    (none)'));
  } else {
    for (let i = 0; i < callees.length; i++) {
      const c = callees[i]!;
      const isLast = i === callees.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      console.log(chalk.dim('    ' + connector) + chalk.white(c.functionName) +
        chalk.dim(` (${c.filePath}:${c.line})`));
    }
  }
}
