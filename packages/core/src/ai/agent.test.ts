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
import { ScenarioDiscoveryAgent, type ScenarioDiscoveryInput } from './scenario-discovery.js';
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
