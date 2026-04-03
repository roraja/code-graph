/**
 * Path Tracer Agent — uses AI to decide which branch or dispatch target
 * to follow at a single decision point during scenario tracing.
 *
 * The agent does **not** orchestrate the full trace; it processes one
 * decision at a time. The `ScenarioTracer` calls this agent repeatedly
 * as it walks the call graph.
 *
 * @module ai/path-tracer
 */

import { AIAgent, type AIProvider, type ChatMessage } from './agent.js';

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

/** Context about the scenario being traced. */
export interface ScenarioContext {
  /** Unique ID of the scenario. */
  scenarioId: string;
  /** Human-readable scenario name. */
  scenarioName: string;
  /** Description of the scenario. */
  scenarioDescription: string;
}

/**
 * Input for a single path-trace decision.
 *
 * The agent is given the source code of the current function, the scenario
 * context, current variable state, and the decision to make.
 */
export interface PathTraceInput {
  /** Source code of the function containing the decision point. */
  functionSource: string;
  /** Name of the current function. */
  functionName: string;
  /** Scenario context. */
  scenario: ScenarioContext;
  /** Current known variable values (variable name → stringified value). */
  variableState: Record<string, string>;
  /**
   * The decision to make.
   * - `'branch'`: choose `then` or `else` for a conditional.
   * - `'dispatch'`: choose which concrete implementation to call.
   */
  decisionType: 'branch' | 'dispatch';
  /** The condition expression (for branch decisions). */
  condition?: string;
  /** Available dispatch targets (for dispatch decisions). */
  dispatchTargets?: string[];
  /** Line number in the source code where the decision occurs. */
  line?: number;
  /** User-supplied corrections that override default behaviour. */
  corrections?: Array<{ rule: string; scope: string }>;
}

/**
 * Result of a single path-trace decision.
 */
export interface PathTraceResult {
  /**
   * The chosen path.
   * - For branches: `'then'` or `'else'`.
   * - For dispatch: the name/ID of the chosen implementation.
   */
  decision: string;
  /** Human-readable justification for the decision. */
  justification: string;
  /** Updated variable state after this decision. */
  updatedVariableState: Record<string, string>;
  /** AI confidence in this decision (0.0–1.0). */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/**
 * AI agent that decides which branch or dispatch target to follow at a
 * single decision point during scenario tracing.
 *
 * @example
 * ```ts
 * const agent = new PathTracerAgent(provider);
 * const result = await agent.traceStep({
 *   functionSource: '...',
 *   functionName: 'processOrder',
 *   scenario: { scenarioId: 'checkout', scenarioName: 'Checkout', scenarioDescription: '...' },
 *   variableState: { orderTotal: '42.50' },
 *   decisionType: 'branch',
 *   condition: 'orderTotal > 100',
 * });
 * ```
 */
export class PathTracerAgent extends AIAgent {
  constructor(provider: AIProvider) {
    super(provider);
  }

  /**
   * Decide which path to take at a single decision point.
   *
   * @param input - Decision context including source code and variable state.
   * @returns The decision, justification, updated state, and confidence.
   */
  async traceStep(input: PathTraceInput): Promise<PathTraceResult> {
    const messages = this.buildPrompt(input);
    const raw = await this.chatJSON<PathTraceResult>(messages);

    return {
      decision: String(raw.decision ?? 'then'),
      justification: String(raw.justification ?? ''),
      updatedVariableState:
        raw.updatedVariableState && typeof raw.updatedVariableState === 'object'
          ? raw.updatedVariableState
          : { ...input.variableState },
      confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
    };
  }

  // -----------------------------------------------------------------------
  // Prompt construction
  // -----------------------------------------------------------------------

  /** Build the chat conversation for a path-trace decision. */
  private buildPrompt(input: PathTraceInput): ChatMessage[] {
    const systemMessage: ChatMessage = {
      role: 'system',
      content: [
        'You are an expert code tracer. You are tracing execution through a codebase',
        'for a specific user-facing scenario. At each decision point you must decide',
        'which path execution would take given the scenario context and variable state.',
        '',
        'Respond with a JSON object containing:',
        '  decision             — for branches: "then" or "else"; for dispatch: the target name',
        '  justification        — human-readable explanation of why this path was chosen',
        '  updatedVariableState — the variable state after this decision (object of name→value)',
        '  confidence           — float 0.0–1.0',
        '',
        'Respond ONLY with a JSON object. No markdown fences, no extra text.',
      ].join('\n'),
    };

    const parts: string[] = [
      `## Scenario: ${input.scenario.scenarioName}`,
      input.scenario.scenarioDescription,
      '',
      `## Current Function: ${input.functionName}`,
      '```',
      input.functionSource,
      '```',
      '',
      '## Variable State',
      JSON.stringify(input.variableState, null, 2),
      '',
      `## Decision Type: ${input.decisionType}`,
    ];

    if (input.decisionType === 'branch' && input.condition) {
      parts.push(`Condition: \`${input.condition}\``);
      if (input.line != null) {
        parts.push(`Line: ${input.line}`);
      }
      parts.push('Choose "then" (condition true) or "else" (condition false).');
    }

    if (input.decisionType === 'dispatch' && input.dispatchTargets) {
      parts.push(
        'Available implementations:',
        ...input.dispatchTargets.map((t) => `- ${t}`),
        'Choose one implementation to dispatch to.',
      );
    }

    if (input.corrections && input.corrections.length > 0) {
      parts.push(
        '',
        '## User Corrections (override defaults)',
        ...input.corrections.map((c) => `- [${c.scope}] ${c.rule}`),
      );
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content: parts.join('\n'),
    };

    return [systemMessage, userMessage];
  }
}
