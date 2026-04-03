/**
 * Correction Interpreter Agent — translates natural-language user
 * corrections into structured correction objects.
 *
 * When a user disagrees with a tracing decision and types something like
 * _"userId should be a UUID, not a number"_ or _"always take the else
 * branch here"_, this agent parses the intent into a machine-actionable
 * {@link StructuredCorrection}.
 *
 * @module ai/correction-interpreter
 */

import { AIAgent, type AIProvider, type ChatMessage } from './agent.js';

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

/** Context provided alongside the user's correction message. */
export interface CorrectionContext {
  /** Currently active scenario. */
  scenario?: {
    scenarioId: string;
    scenarioName: string;
    scenarioDescription: string;
  };
  /** The current tracing step (e.g. "step 3 of scenario checkout"). */
  currentStep?: string;
  /** The function being traced when the correction was given. */
  currentFunction?: string;
  /** Current variable state at the point of correction. */
  variableState?: Record<string, string>;
}

/** Input for the correction interpreter. */
export interface CorrectionInterpreterInput {
  /** The user's natural-language correction message. */
  userMessage: string;
  /** Contextual information about the current tracing state. */
  context: CorrectionContext;
}

/**
 * Correction types supported by the system.
 *
 * - `variable_constraint` — constrain a variable's value or type.
 * - `branch_override`     — force a specific branch direction.
 * - `dispatch_override`   — force dispatch to a specific implementation.
 * - `scenario_note`       — add a note/annotation to the current scenario.
 * - `function_skip`       — skip tracing a particular function.
 * - `function_include`    — explicitly include a function in the trace.
 * - `global_rule`         — add a project-wide tracing rule.
 */
export type CorrectionType =
  | 'variable_constraint'
  | 'branch_override'
  | 'dispatch_override'
  | 'scenario_note'
  | 'function_skip'
  | 'function_include'
  | 'global_rule';

/** A structured correction derived from a user's natural-language input. */
export interface StructuredCorrection {
  /** The type of correction. */
  correctionType: CorrectionType;
  /** What the correction applies to (variable name, function name, etc.). */
  target: string;
  /** The rule expressed by the user (e.g. "userId should be a UUID"). */
  rule: string;
  /**
   * Scope of the correction.
   * - `'local'`    — applies only to the current step.
   * - `'scenario'` — applies for the entire scenario.
   * - `'global'`   — applies across all scenarios.
   */
  scope: 'local' | 'scenario' | 'global';
  /** AI confidence in the interpretation (0.0–1.0). */
  confidence: number;
  /** Whether the agent needs more information to process the correction. */
  clarificationNeeded: boolean;
  /** If `clarificationNeeded` is `true`, the question to ask the user. */
  clarificationQuestion?: string;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/**
 * AI agent that interprets natural-language user corrections and converts
 * them into structured {@link StructuredCorrection} objects.
 *
 * @example
 * ```ts
 * const agent = new CorrectionInterpreterAgent(provider);
 * const correction = await agent.interpret({
 *   userMessage: 'userId should always be a UUID string',
 *   context: {
 *     scenario: { scenarioId: 'login', ... },
 *     currentFunction: 'validateUser',
 *     variableState: { userId: '123' },
 *   },
 * });
 * ```
 */
export class CorrectionInterpreterAgent extends AIAgent {
  constructor(provider: AIProvider) {
    super(provider);
  }

  /**
   * Interpret a user's natural-language correction.
   *
   * @param input - The user message and current tracing context.
   * @returns A structured correction with type, target, rule, and scope.
   */
  async interpret(
    input: CorrectionInterpreterInput,
  ): Promise<StructuredCorrection> {
    const messages = this.buildPrompt(input);
    const raw = await this.chatJSON<StructuredCorrection>(messages);

    return {
      correctionType: this.validateCorrectionType(raw.correctionType),
      target: String(raw.target ?? ''),
      rule: String(raw.rule ?? ''),
      scope: this.validateScope(raw.scope),
      confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
      clarificationNeeded: Boolean(raw.clarificationNeeded),
      ...(raw.clarificationQuestion
        ? { clarificationQuestion: String(raw.clarificationQuestion) }
        : {}),
    };
  }

  // -----------------------------------------------------------------------
  // Prompt construction
  // -----------------------------------------------------------------------

  /** Build the chat conversation for correction interpretation. */
  private buildPrompt(input: CorrectionInterpreterInput): ChatMessage[] {
    const systemMessage: ChatMessage = {
      role: 'system',
      content: [
        'You are an expert at understanding user corrections to code tracing decisions.',
        'The user has provided a natural-language correction. Parse it into a structured object.',
        '',
        'Correction types:',
        '  variable_constraint — constrain a variable value or type',
        '  branch_override     — force a specific branch direction',
        '  dispatch_override   — force dispatch to a specific implementation',
        '  scenario_note       — add a note to the scenario',
        '  function_skip       — skip tracing a function',
        '  function_include    — explicitly include a function in the trace',
        '  global_rule         — add a project-wide rule',
        '',
        'Respond with a JSON object containing:',
        '  correctionType        — one of the types listed above',
        '  target                — what the correction applies to (variable name, function, etc.)',
        '  rule                  — the rule expressed by the user',
        '  scope                 — "local" | "scenario" | "global"',
        '  confidence            — float 0.0–1.0',
        '  clarificationNeeded   — boolean: true if you need more info from the user',
        '  clarificationQuestion — (optional) question to ask if clarification is needed',
        '',
        'Respond ONLY with a JSON object. No markdown fences, no extra text.',
      ].join('\n'),
    };

    const parts: string[] = [
      `## User Correction`,
      `"${input.userMessage}"`,
    ];

    const ctx = input.context;
    if (ctx.scenario) {
      parts.push(
        '',
        `## Current Scenario: ${ctx.scenario.scenarioName}`,
        ctx.scenario.scenarioDescription,
      );
    }
    if (ctx.currentStep) {
      parts.push(`Current Step: ${ctx.currentStep}`);
    }
    if (ctx.currentFunction) {
      parts.push(`Current Function: \`${ctx.currentFunction}\``);
    }
    if (ctx.variableState && Object.keys(ctx.variableState).length > 0) {
      parts.push(
        '',
        '## Variable State',
        JSON.stringify(ctx.variableState, null, 2),
      );
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content: parts.join('\n'),
    };

    return [systemMessage, userMessage];
  }

  // -----------------------------------------------------------------------
  // Validation helpers
  // -----------------------------------------------------------------------

  /** Validate and normalise the correction type. */
  private validateCorrectionType(value: unknown): CorrectionType {
    const valid: CorrectionType[] = [
      'variable_constraint',
      'branch_override',
      'dispatch_override',
      'scenario_note',
      'function_skip',
      'function_include',
      'global_rule',
    ];
    if (typeof value === 'string' && (valid as string[]).includes(value)) {
      return value as CorrectionType;
    }
    return 'variable_constraint';
  }

  /** Validate and normalise the scope. */
  private validateScope(value: unknown): 'local' | 'scenario' | 'global' {
    const valid = ['local', 'scenario', 'global'] as const;
    if (typeof value === 'string' && (valid as readonly string[]).includes(value)) {
      return value as 'local' | 'scenario' | 'global';
    }
    return 'global';
  }
}
