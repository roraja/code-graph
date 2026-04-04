/**
 * Tests for the AI agent layer.
 *
 * All tests use the {@link MockAIProvider} so no API keys are required.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockAIProvider,
  AIAgent,
  createAIProvider,
  type AIConfig,
  type ChatMessage,
} from './agent.js';
import {
  ScenarioDiscoveryAgent,
  type ScenarioDiscoveryInput,
  type CallEdgeSummary,
  type BranchSummary,
  type ClassSummary,
  type InheritanceSummary,
  type CodebaseSummary,
} from './scenario-discovery.js';
import { PathTracerAgent, type PathTraceInput } from './path-tracer.js';
import { VariableImaginerAgent, type VariableImaginationInput } from './variable-imaginer.js';
import { JustifierAgent, type JustificationRequest } from './justifier.js';
import {
  CorrectionInterpreterAgent,
  type CorrectionInterpreterInput,
} from './correction-interpreter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMock(): MockAIProvider {
  return new MockAIProvider();
}

// ---------------------------------------------------------------------------
// 1. MockAIProvider
// ---------------------------------------------------------------------------

describe('MockAIProvider', () => {
  let mock: MockAIProvider;

  beforeEach(() => {
    mock = makeMock();
  });

  it('returns canned responses in FIFO order', async () => {
    mock.addResponses('first', 'second');
    expect(await mock.chat([])).toBe('first');
    expect(await mock.chat([])).toBe('second');
  });

  it('matches pattern-based rules when no canned response', async () => {
    mock.addRule('hello', '{"greeting":"hi"}');
    const result = await mock.chat([{ role: 'user', content: 'say hello please' }]);
    expect(result).toBe('{"greeting":"hi"}');
  });

  it('matches RegExp patterns', async () => {
    mock.addRule(/user\s*id/i, '{"match":"regex"}');
    const result = await mock.chat([{ role: 'user', content: 'set the User ID' }]);
    expect(result).toBe('{"match":"regex"}');
  });

  it('falls back to smart defaults for scenario prompts', async () => {
    const result = await mock.chat([
      { role: 'user', content: 'Please discover scenarios from these entry points.' },
    ]);
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty('id');
    expect(parsed[0]).toHaveProperty('confidence');
  });

  it('falls back to smart defaults for branch/trace prompts', async () => {
    const result = await mock.chat([
      { role: 'user', content: 'Decide which branch to take for this condition.' },
    ]);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('decision');
    expect(parsed).toHaveProperty('confidence');
  });

  it('falls back to smart defaults for variable prompts', async () => {
    const result = await mock.chat([
      { role: 'user', content: 'Imagine a value for this variable.' },
    ]);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('value');
    expect(parsed).toHaveProperty('alternatives');
  });

  it('falls back to smart defaults for correction prompts', async () => {
    const result = await mock.chat([
      { role: 'user', content: 'Interpret this correction from the user.' },
    ]);
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('correctionType');
  });

  it('records all received messages', async () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ];
    await mock.chat(messages);
    expect(mock.receivedMessages).toHaveLength(1);
    expect(mock.receivedMessages[0]).toEqual(messages);
  });

  it('canned responses take priority over rules', async () => {
    mock.addRule('hello', 'rule-match');
    mock.addResponses('canned');
    const result = await mock.chat([{ role: 'user', content: 'hello' }]);
    expect(result).toBe('canned');
  });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe('createAIProvider', () => {
  it('creates a MockAIProvider for provider "mock"', () => {
    const provider = createAIProvider({ provider: 'mock', model: 'test' });
    expect(provider).toBeInstanceOf(MockAIProvider);
  });

  it('throws for unknown provider', () => {
    expect(() =>
      createAIProvider({ provider: 'unknown' as any, model: 'test' }),
    ).toThrow(/unknown/i);
  });
});

// ---------------------------------------------------------------------------
// 2. ScenarioDiscoveryAgent
// ---------------------------------------------------------------------------

describe('ScenarioDiscoveryAgent', () => {
  it('discovers scenarios from entry points', async () => {
    const mock = makeMock();
    mock.addResponses(
      JSON.stringify([
        {
          id: 'user-login',
          name: 'User Login',
          description: 'User logs in with email and password',
          entryFunction: 'handleLogin',
          triggerCondition: 'POST /api/login',
          confidence: 0.95,
        },
        {
          id: 'file-upload',
          name: 'File Upload',
          description: 'User uploads a file via drag and drop',
          entryFunction: 'handleFileDrop',
          triggerCondition: 'User drags file onto drop zone',
          confidence: 0.88,
        },
      ]),
    );

    const agent = new ScenarioDiscoveryAgent(mock);
    const input: ScenarioDiscoveryInput = {
      entryPoints: [
        {
          id: 'f1',
          name: 'handleLogin',
          signature: 'handleLogin(req: Request): Response',
          filePath: 'src/auth.ts',
        },
      ],
      eventHandlers: [
        {
          id: 'f2',
          name: 'handleFileDrop',
          signature: 'handleFileDrop(event: DragEvent): void',
          filePath: 'src/upload.ts',
        },
      ],
      publicAPIs: [],
    };

    const scenarios = await agent.discover(input);
    expect(scenarios).toHaveLength(2);
    // Should be sorted by descending confidence
    expect(scenarios[0].confidence).toBeGreaterThanOrEqual(scenarios[1].confidence);
    expect(scenarios[0].id).toBe('user-login');
    expect(scenarios[0].entryFunction).toBe('handleLogin');
    expect(scenarios[1].id).toBe('file-upload');
  });

  it('uses smart default when no canned response', async () => {
    const mock = makeMock();
    const agent = new ScenarioDiscoveryAgent(mock);
    const scenarios = await agent.discover({
      entryPoints: [
        { id: 'f1', name: 'main', signature: 'main(): void', filePath: 'src/index.ts' },
      ],
      eventHandlers: [],
      publicAPIs: [],
    });

    expect(scenarios.length).toBeGreaterThan(0);
    expect(scenarios[0]).toHaveProperty('id');
    expect(scenarios[0]).toHaveProperty('name');
    expect(scenarios[0]).toHaveProperty('confidence');
  });

  it('includes existing scenarios in the prompt to avoid duplicates', async () => {
    const mock = makeMock();
    mock.addResponses(JSON.stringify([
      {
        id: 'new-scenario',
        name: 'New Scenario',
        description: 'A brand new scenario',
        entryFunction: 'handleNew',
        triggerCondition: 'New event',
        confidence: 0.7,
      },
    ]));

    const agent = new ScenarioDiscoveryAgent(mock);
    await agent.discover({
      entryPoints: [
        { id: 'f1', name: 'handleNew', signature: 'handleNew(): void', filePath: 'src/new.ts' },
      ],
      eventHandlers: [],
      publicAPIs: [],
      existingScenarios: [
        {
          id: 'existing',
          name: 'Existing',
          description: 'Already discovered',
          entryFunction: 'handleOld',
          triggerCondition: 'Old event',
          confidence: 0.9,
        },
      ],
    });

    // Verify the prompt includes existing scenario info
    const lastMessages = mock.receivedMessages[0];
    const userContent = lastMessages.find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain('existing');
    expect(userContent).toContain('Already discovered');
  });

  it('includes call graph edges in the prompt', async () => {
    const mock = makeMock();
    mock.addResponses(JSON.stringify([
      {
        id: 'login-flow',
        name: 'Login Flow',
        description: 'User logs in',
        entryFunction: 'handleLogin',
        triggerCondition: 'POST /login',
        confidence: 0.9,
        expectedPath: ['handleLogin', 'validateCredentials', 'generateToken'],
        category: 'authentication',
        pathType: 'happy',
      },
    ]));

    const agent = new ScenarioDiscoveryAgent(mock);
    const callGraph: CallEdgeSummary[] = [
      { caller: 'handleLogin', callee: 'validateCredentials' },
      { caller: 'handleLogin', callee: 'generateToken' },
      { caller: 'validateCredentials', callee: 'hashPassword', isVirtualDispatch: true },
    ];

    const scenarios = await agent.discover({
      entryPoints: [
        { id: 'f1', name: 'handleLogin', signature: 'handleLogin(): void', filePath: 'src/auth.ts' },
      ],
      eventHandlers: [],
      publicAPIs: [],
      callGraph,
    });

    // Verify call graph was included in the prompt
    const userContent = mock.receivedMessages[0].find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain('Call Graph');
    expect(userContent).toContain('handleLogin');
    expect(userContent).toContain('validateCredentials');
    expect(userContent).toContain('virtual dispatch');

    // Verify new optional fields are parsed
    expect(scenarios[0].expectedPath).toEqual(['handleLogin', 'validateCredentials', 'generateToken']);
    expect(scenarios[0].category).toBe('authentication');
    expect(scenarios[0].pathType).toBe('happy');
  });

  it('includes branch points in the prompt', async () => {
    const mock = makeMock();
    mock.addResponses(JSON.stringify([
      {
        id: 'invalid-login',
        name: 'Invalid Login',
        description: 'User provides wrong password',
        entryFunction: 'handleLogin',
        triggerCondition: 'POST /login with wrong password',
        confidence: 0.85,
        pathType: 'error',
      },
    ]));

    const agent = new ScenarioDiscoveryAgent(mock);
    const branchPoints: BranchSummary[] = [
      {
        functionName: 'handleLogin',
        type: 'if',
        condition: 'isValid === false',
        line: 25,
        hasElse: true,
      },
      {
        functionName: 'handleLogin',
        type: 'if',
        condition: 'user.isLocked',
        line: 30,
        hasElse: false,
      },
    ];

    const scenarios = await agent.discover({
      entryPoints: [
        { id: 'f1', name: 'handleLogin', signature: 'handleLogin(): void', filePath: 'src/auth.ts' },
      ],
      eventHandlers: [],
      publicAPIs: [],
      branchPoints,
    });

    const userContent = mock.receivedMessages[0].find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain('Decision Points');
    expect(userContent).toContain('isValid === false');
    expect(userContent).toContain('has else');
    expect(userContent).toContain('user.isLocked');
    expect(userContent).toContain('no else');

    expect(scenarios[0].pathType).toBe('error');
  });

  it('includes class hierarchy in the prompt', async () => {
    const mock = makeMock();
    mock.addResponses(JSON.stringify([
      {
        id: 'stripe-payment',
        name: 'Stripe Payment',
        description: 'Process payment via Stripe',
        entryFunction: 'processPayment',
        triggerCondition: 'User submits payment',
        confidence: 0.88,
      },
    ]));

    const agent = new ScenarioDiscoveryAgent(mock);
    const classes: ClassSummary[] = [
      {
        name: 'PaymentProcessor',
        isAbstract: true,
        isInterface: false,
        methods: ['process', 'refund'],
        filePath: 'src/payment/base.ts',
        documentation: 'Base class for payment processing',
      },
      {
        name: 'StripeProcessor',
        isAbstract: false,
        isInterface: false,
        methods: ['process', 'refund', 'createIntent'],
        filePath: 'src/payment/stripe.ts',
      },
    ];
    const inheritances: InheritanceSummary[] = [
      { child: 'StripeProcessor', parent: 'PaymentProcessor', type: 'extends' },
    ];

    await agent.discover({
      entryPoints: [
        { id: 'f1', name: 'processPayment', signature: 'processPayment(): void', filePath: 'src/pay.ts' },
      ],
      eventHandlers: [],
      publicAPIs: [],
      classes,
      inheritances,
    });

    const userContent = mock.receivedMessages[0].find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain('Class Hierarchy');
    expect(userContent).toContain('PaymentProcessor');
    expect(userContent).toContain('abstract class');
    expect(userContent).toContain('StripeProcessor');
    expect(userContent).toContain('extends');
    expect(userContent).toContain('Base class for payment processing');
  });

  it('includes codebase summary in the prompt', async () => {
    const mock = makeMock();
    mock.addResponses(JSON.stringify([]));

    const agent = new ScenarioDiscoveryAgent(mock);
    const codebaseSummary: CodebaseSummary = {
      projectDescription: 'An e-commerce REST API backend',
      languages: ['TypeScript'],
      totalFunctions: 150,
      totalClasses: 25,
      totalFiles: 40,
      moduleGroups: ['src/auth/', 'src/products/', 'src/orders/'],
    };

    await agent.discover({
      entryPoints: [
        { id: 'f1', name: 'main', signature: 'main(): void', filePath: 'src/index.ts' },
      ],
      eventHandlers: [],
      publicAPIs: [],
      codebaseSummary,
    });

    const userContent = mock.receivedMessages[0].find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain('Codebase Overview');
    expect(userContent).toContain('e-commerce REST API');
    expect(userContent).toContain('TypeScript');
    expect(userContent).toContain('Functions: 150');
    expect(userContent).toContain('src/auth/');
    expect(userContent).toContain('src/orders/');
  });

  it('includes structured parameter info in the prompt', async () => {
    const mock = makeMock();
    mock.addResponses(JSON.stringify([]));

    const agent = new ScenarioDiscoveryAgent(mock);
    await agent.discover({
      entryPoints: [
        {
          id: 'f1',
          name: 'createOrder',
          qualifiedName: 'OrderService.createOrder',
          signature: 'createOrder(items: Item[], coupon?: string): Promise<Order>',
          filePath: 'src/orders.ts',
          isAsync: true,
          parameters: [
            { name: 'items', type: 'Item[]', isOptional: false },
            { name: 'coupon', type: 'string', isOptional: true, defaultValue: 'undefined' },
          ],
        },
      ],
      eventHandlers: [],
      publicAPIs: [],
    });

    const userContent = mock.receivedMessages[0].find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain('Parameters:');
    expect(userContent).toContain('`items: Item[]`');
    expect(userContent).toContain('`coupon: string`');
    expect(userContent).toContain('(optional)');
    expect(userContent).toContain('async');
  });

  it('system prompt includes quality guidelines', async () => {
    const mock = makeMock();
    mock.addResponses(JSON.stringify([]));

    const agent = new ScenarioDiscoveryAgent(mock);
    await agent.discover({
      entryPoints: [
        { id: 'f1', name: 'main', signature: 'main(): void', filePath: 'src/index.ts' },
      ],
      eventHandlers: [],
      publicAPIs: [],
    });

    const systemContent = mock.receivedMessages[0].find((m) => m.role === 'system')?.content ?? '';
    expect(systemContent).toContain('GOOD scenario');
    expect(systemContent).toContain('BAD scenario');
    expect(systemContent).toContain('Diversity requirements');
    expect(systemContent).toContain('Analysis strategy');
    expect(systemContent).toContain('expectedPath');
    expect(systemContent).toContain('pathType');
    expect(systemContent).toContain('category');
  });

  it('normalises pathType values correctly', async () => {
    const mock = makeMock();
    mock.addResponses(JSON.stringify([
      {
        id: 'a',
        name: 'A',
        description: 'test',
        entryFunction: 'f',
        triggerCondition: 'x',
        confidence: 0.9,
        pathType: 'edge_case',
      },
      {
        id: 'b',
        name: 'B',
        description: 'test',
        entryFunction: 'f',
        triggerCondition: 'x',
        confidence: 0.8,
        pathType: 'HAPPY',
      },
      {
        id: 'c',
        name: 'C',
        description: 'test',
        entryFunction: 'f',
        triggerCondition: 'x',
        confidence: 0.7,
        pathType: 'unknown',
      },
    ]));

    const agent = new ScenarioDiscoveryAgent(mock);
    const scenarios = await agent.discover({
      entryPoints: [{ id: 'f1', name: 'f', signature: 'f(): void', filePath: 'a.ts' }],
      eventHandlers: [],
      publicAPIs: [],
    });

    expect(scenarios[0].pathType).toBe('edge-case');
    expect(scenarios[1].pathType).toBe('happy');
    expect(scenarios[2].pathType).toBeUndefined();
  });

  it('includes target function and callers/callees in the prompt', async () => {
    const mock = makeMock();
    mock.addResponses(JSON.stringify([
      {
        id: 'login-validates-creds',
        name: 'Login Validates Credentials',
        description: 'User logs in, which calls validateCredentials to check the password hash',
        entryFunction: 'handleLogin',
        triggerCondition: 'POST /login',
        confidence: 0.9,
        expectedPath: ['handleLogin', 'validateCredentials'],
      },
    ]));

    const agent = new ScenarioDiscoveryAgent(mock);
    await agent.discover({
      entryPoints: [
        { id: 'f1', name: 'handleLogin', signature: 'handleLogin(): void', filePath: 'src/auth.ts' },
      ],
      eventHandlers: [],
      publicAPIs: [],
      targetFunction: {
        id: 'f2',
        name: 'validateCredentials',
        qualifiedName: 'AuthService.validateCredentials',
        signature: 'validateCredentials(email: string, hash: string): boolean',
        filePath: 'src/auth/login.ts',
      },
      targetCallers: [
        {
          id: 'f1',
          name: 'handleLogin',
          qualifiedName: 'handleLogin',
          signature: 'handleLogin(): void',
          filePath: 'src/auth.ts',
        },
      ],
      targetCallees: [
        {
          id: 'f3',
          name: 'hashPassword',
          qualifiedName: 'hashPassword',
          signature: 'hashPassword(pw: string): string',
          filePath: 'src/crypto.ts',
        },
      ],
    });

    // Verify the prompt includes the target function section
    const userContent = mock.receivedMessages[0].find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain('Target Function');
    expect(userContent).toContain('AuthService.validateCredentials');
    expect(userContent).toContain('Callers of Target');
    expect(userContent).toContain('handleLogin');
    expect(userContent).toContain('Callees of Target');
    expect(userContent).toContain('hashPassword');

    // Verify the system prompt is tailored for target function discovery
    const systemContent = mock.receivedMessages[0].find((m) => m.role === 'system')?.content ?? '';
    expect(systemContent).toContain('validateCredentials');
    expect(systemContent).toContain('MUST include');
    expect(systemContent).toContain('ANYWHERE');
    expect(systemContent).toContain('CALLERS');
  });

  it('system prompt adapts when targetFunction is set', async () => {
    const mock = makeMock();
    mock.addResponses(JSON.stringify([]));

    const agent = new ScenarioDiscoveryAgent(mock);
    await agent.discover({
      entryPoints: [
        { id: 'f1', name: 'main', signature: 'main(): void', filePath: 'src/index.ts' },
      ],
      eventHandlers: [],
      publicAPIs: [],
      targetFunction: {
        id: 'f2',
        name: 'doWork',
        qualifiedName: 'Worker.doWork',
        signature: 'doWork(data: Buffer): Promise<void>',
        filePath: 'src/worker.ts',
      },
    });

    const systemContent = mock.receivedMessages[0].find((m) => m.role === 'system')?.content ?? '';

    // Should mention target function in the analysis strategy
    expect(systemContent).toContain('Worker.doWork');
    expect(systemContent).toContain('TARGET FUNCTION');

    // Should NOT have the generic "study the entry points" first step
    // (the target-mode strategy leads with studying the target)
    expect(systemContent).not.toContain('1. Study the entry points');
    expect(systemContent).toContain('Study the TARGET FUNCTION');
  });

  it('system prompt uses generic strategy when no targetFunction', async () => {
    const mock = makeMock();
    mock.addResponses(JSON.stringify([]));

    const agent = new ScenarioDiscoveryAgent(mock);
    await agent.discover({
      entryPoints: [
        { id: 'f1', name: 'main', signature: 'main(): void', filePath: 'src/index.ts' },
      ],
      eventHandlers: [],
      publicAPIs: [],
      // No targetFunction
    });

    const systemContent = mock.receivedMessages[0].find((m) => m.role === 'system')?.content ?? '';

    // Should use generic strategy
    expect(systemContent).toContain('Study the entry points');
    // Should NOT mention target-function-specific instructions
    expect(systemContent).not.toContain('TARGET FUNCTION');
    expect(systemContent).not.toContain('CALLERS');
  });
});

// ---------------------------------------------------------------------------
// 3. PathTracerAgent
// ---------------------------------------------------------------------------

describe('PathTracerAgent', () => {
  it('traces a branch decision', async () => {
    const mock = makeMock();
    mock.addResponses(
      JSON.stringify({
        decision: 'else',
        justification: 'orderTotal is 42.50 which is less than 100',
        updatedVariableState: { orderTotal: '42.50', discount: '0' },
        confidence: 0.92,
      }),
    );

    const agent = new PathTracerAgent(mock);
    const input: PathTraceInput = {
      functionSource: 'if (orderTotal > 100) { applyDiscount(); } else { noDiscount(); }',
      functionName: 'processOrder',
      scenario: {
        scenarioId: 'checkout',
        scenarioName: 'Checkout',
        scenarioDescription: 'User checks out with a small order',
      },
      variableState: { orderTotal: '42.50' },
      decisionType: 'branch',
      condition: 'orderTotal > 100',
    };

    const result = await agent.traceStep(input);
    expect(result.decision).toBe('else');
    expect(result.confidence).toBe(0.92);
    expect(result.updatedVariableState).toHaveProperty('discount', '0');
    expect(result.justification).toContain('42.50');
  });

  it('traces a dispatch decision', async () => {
    const mock = makeMock();
    mock.addResponses(
      JSON.stringify({
        decision: 'StripePaymentProcessor',
        justification: 'Stripe is the default payment processor',
        updatedVariableState: { processor: 'stripe' },
        confidence: 0.88,
      }),
    );

    const agent = new PathTracerAgent(mock);
    const result = await agent.traceStep({
      functionSource: 'paymentProcessor.process(order);',
      functionName: 'handlePayment',
      scenario: {
        scenarioId: 'checkout',
        scenarioName: 'Checkout',
        scenarioDescription: 'User pays for their order',
      },
      variableState: {},
      decisionType: 'dispatch',
      dispatchTargets: ['StripePaymentProcessor', 'PayPalPaymentProcessor'],
    });

    expect(result.decision).toBe('StripePaymentProcessor');
    expect(result.confidence).toBe(0.88);
  });

  it('falls back to defaults for missing fields', async () => {
    const mock = makeMock();
    mock.addResponses(JSON.stringify({ decision: 'then' }));

    const agent = new PathTracerAgent(mock);
    const result = await agent.traceStep({
      functionSource: 'if (x) { a(); }',
      functionName: 'test',
      scenario: { scenarioId: 's', scenarioName: 'S', scenarioDescription: 'desc' },
      variableState: { x: 'true' },
      decisionType: 'branch',
      condition: 'x',
    });

    expect(result.decision).toBe('then');
    expect(result.justification).toBe('');
    expect(result.confidence).toBe(0.5);
    expect(result.updatedVariableState).toEqual({ x: 'true' });
  });

  it('includes corrections in the prompt', async () => {
    const mock = makeMock();
    const agent = new PathTracerAgent(mock);

    await agent.traceStep({
      functionSource: 'if (isAdmin) { ... }',
      functionName: 'checkAccess',
      scenario: { scenarioId: 's', scenarioName: 'S', scenarioDescription: 'd' },
      variableState: {},
      decisionType: 'branch',
      condition: 'isAdmin',
      corrections: [{ rule: 'isAdmin is always true', scope: 'scenario' }],
    });

    const userContent =
      mock.receivedMessages[0].find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain('isAdmin is always true');
  });
});

// ---------------------------------------------------------------------------
// 4. VariableImaginerAgent
// ---------------------------------------------------------------------------

describe('VariableImaginerAgent', () => {
  it('imagines a realistic variable value', async () => {
    const mock = makeMock();
    mock.addResponses(
      JSON.stringify({
        value: '"usr_abc123"',
        justification: 'A realistic user ID for a login scenario',
        alternatives: ['"usr_def456"', '"usr_ghi789"'],
        confidence: 0.9,
      }),
    );

    const agent = new VariableImaginerAgent(mock);
    const input: VariableImaginationInput = {
      variableName: 'userId',
      variableType: 'string',
      scenario: {
        scenarioId: 'login',
        scenarioName: 'User Login',
        scenarioDescription: 'User logs in with valid credentials',
      },
      surroundingCode: 'const userId = req.params.id;',
      existingState: { email: '"user@example.com"' },
      functionName: 'handleLogin',
    };

    const result = await agent.imagine(input);
    expect(result.value).toBe('"usr_abc123"');
    expect(result.justification).toContain('user ID');
    expect(result.alternatives).toHaveLength(2);
    expect(result.confidence).toBe(0.9);
  });

  it('falls back to defaults for missing fields', async () => {
    const mock = makeMock();
    mock.addResponses(JSON.stringify({}));

    const agent = new VariableImaginerAgent(mock);
    const result = await agent.imagine({
      variableName: 'x',
      variableType: 'number',
      scenario: { scenarioId: 's', scenarioName: 'S', scenarioDescription: 'd' },
      surroundingCode: 'const x = getX();',
      existingState: {},
    });

    expect(result.value).toBe('undefined');
    expect(result.alternatives).toEqual([]);
    expect(result.confidence).toBe(0.5);
  });

  it('uses smart default when no canned response', async () => {
    const mock = makeMock();
    const agent = new VariableImaginerAgent(mock);
    const result = await agent.imagine({
      variableName: 'count',
      variableType: 'number',
      scenario: { scenarioId: 's', scenarioName: 'S', scenarioDescription: 'd' },
      surroundingCode: 'const count = items.length;',
      existingState: {},
    });

    expect(result).toHaveProperty('value');
    expect(result).toHaveProperty('confidence');
  });
});

// ---------------------------------------------------------------------------
// 5. JustifierAgent
// ---------------------------------------------------------------------------

describe('JustifierAgent', () => {
  it('generates a justification for a branch decision', async () => {
    const mock = makeMock();
    mock.addResponses(
      JSON.stringify({
        explanation: 'The user is an admin so the admin branch is taken.',
        confidence: 0.95,
        assumptions: ['user.isAdmin is true based on the scenario context'],
      }),
    );

    const agent = new JustifierAgent(mock);
    const input: JustificationRequest = {
      decisionType: 'branch',
      condition: 'user.isAdmin',
      chosenPath: 'then',
      scenario: {
        scenarioId: 'admin-action',
        scenarioName: 'Admin Action',
        scenarioDescription: 'An admin user performs a privileged action',
      },
      variableState: { 'user.isAdmin': 'true' },
      codeSnippet: 'if (user.isAdmin) { grantAccess(); }',
    };

    const result = await agent.justify(input);
    expect(result.explanation).toContain('admin');
    expect(result.confidence).toBe(0.95);
    expect(result.assumptions).toHaveLength(1);
    expect(result.assumptions[0]).toContain('isAdmin');
  });

  it('falls back to defaults for incomplete response', async () => {
    const mock = makeMock();
    mock.addResponses(JSON.stringify({ explanation: 'Because reasons.' }));

    const agent = new JustifierAgent(mock);
    const result = await agent.justify({
      decisionType: 'dispatch',
      chosenPath: 'ConcreteImpl',
      implementations: ['ConcreteImpl', 'OtherImpl'],
      scenario: { scenarioId: 's', scenarioName: 'S', scenarioDescription: 'd' },
      variableState: {},
      codeSnippet: 'handler.process(data);',
    });

    expect(result.explanation).toBe('Because reasons.');
    expect(result.confidence).toBe(0.5);
    expect(result.assumptions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. CorrectionInterpreterAgent
// ---------------------------------------------------------------------------

describe('CorrectionInterpreterAgent', () => {
  it('interprets a variable constraint correction', async () => {
    const mock = makeMock();
    mock.addResponses(
      JSON.stringify({
        correctionType: 'variable_constraint',
        target: 'userId',
        rule: 'userId should always be a UUID string',
        scope: 'global',
        confidence: 0.9,
        clarificationNeeded: false,
      }),
    );

    const agent = new CorrectionInterpreterAgent(mock);
    const input: CorrectionInterpreterInput = {
      userMessage: 'userId should always be a UUID string, not a number',
      context: {
        scenario: {
          scenarioId: 'login',
          scenarioName: 'User Login',
          scenarioDescription: 'User logs in',
        },
        currentFunction: 'validateUser',
        variableState: { userId: '123' },
      },
    };

    const result = await agent.interpret(input);
    expect(result.correctionType).toBe('variable_constraint');
    expect(result.target).toBe('userId');
    expect(result.rule).toContain('UUID');
    expect(result.scope).toBe('global');
    expect(result.confidence).toBe(0.9);
    expect(result.clarificationNeeded).toBe(false);
  });

  it('interprets a branch override correction', async () => {
    const mock = makeMock();
    mock.addResponses(
      JSON.stringify({
        correctionType: 'branch_override',
        target: 'isAdmin check',
        rule: 'always take the else branch for isAdmin',
        scope: 'scenario',
        confidence: 0.85,
        clarificationNeeded: false,
      }),
    );

    const agent = new CorrectionInterpreterAgent(mock);
    const result = await agent.interpret({
      userMessage: 'The user is not an admin in this scenario, always take else',
      context: {
        currentStep: 'step 3',
        currentFunction: 'checkAccess',
      },
    });

    expect(result.correctionType).toBe('branch_override');
    expect(result.scope).toBe('scenario');
  });

  it('handles corrections that need clarification', async () => {
    const mock = makeMock();
    mock.addResponses(
      JSON.stringify({
        correctionType: 'function_skip',
        target: '',
        rule: 'skip logging',
        scope: 'global',
        confidence: 0.4,
        clarificationNeeded: true,
        clarificationQuestion: 'Which logging function should be skipped?',
      }),
    );

    const agent = new CorrectionInterpreterAgent(mock);
    const result = await agent.interpret({
      userMessage: 'skip the logging stuff',
      context: {},
    });

    expect(result.clarificationNeeded).toBe(true);
    expect(result.clarificationQuestion).toContain('logging');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('validates unknown correction types to default', async () => {
    const mock = makeMock();
    mock.addResponses(
      JSON.stringify({
        correctionType: 'invalid_type',
        target: 'x',
        rule: 'something',
        scope: 'invalid_scope',
        confidence: 0.5,
        clarificationNeeded: false,
      }),
    );

    const agent = new CorrectionInterpreterAgent(mock);
    const result = await agent.interpret({
      userMessage: 'do something',
      context: {},
    });

    expect(result.correctionType).toBe('variable_constraint');
    expect(result.scope).toBe('global');
  });

  it('includes context in the prompt', async () => {
    const mock = makeMock();
    const agent = new CorrectionInterpreterAgent(mock);

    await agent.interpret({
      userMessage: 'fix this',
      context: {
        scenario: {
          scenarioId: 'test',
          scenarioName: 'Test Scenario',
          scenarioDescription: 'A test',
        },
        currentStep: 'step 5',
        currentFunction: 'doStuff',
        variableState: { x: '42' },
      },
    });

    const userContent =
      mock.receivedMessages[0].find((m) => m.role === 'user')?.content ?? '';
    expect(userContent).toContain('Test Scenario');
    expect(userContent).toContain('step 5');
    expect(userContent).toContain('doStuff');
    expect(userContent).toContain('42');
  });
});
