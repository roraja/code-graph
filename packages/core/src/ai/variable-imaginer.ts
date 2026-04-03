/**
 * Variable Imaginer Agent — uses AI to infer realistic variable values
 * during scenario tracing.
 *
 * When the tracer encounters a variable whose value cannot be determined
 * statically, this agent proposes a plausible value based on the scenario
 * context, variable metadata, and surrounding code.
 *
 * @module ai/variable-imaginer
 */

import { AIAgent, type AIProvider, type ChatMessage } from './agent.js';

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

/** Input for variable imagination. */
export interface VariableImaginationInput {
  /** Name of the variable to imagine a value for. */
  variableName: string;
  /** Declared or inferred type of the variable. */
  variableType: string;
  /** Scenario context. */
  scenario: {
    /** Unique ID of the scenario. */
    scenarioId: string;
    /** Human-readable scenario name. */
    scenarioName: string;
    /** Scenario description. */
    scenarioDescription: string;
  };
  /** Source code surrounding the variable usage. */
  surroundingCode: string;
  /** Already-known variable state (name → stringified value). */
  existingState: Record<string, string>;
  /** The function where the variable is used. */
  functionName?: string;
  /** Optional documentation for the variable. */
  documentation?: string;
}

/** Result of variable imagination. */
export interface VariableImaginationResult {
  /**
   * The imagined value as a string literal suitable for display and
   * further tracing (e.g. `'"hello"'`, `'42'`, `'true'`).
   */
  value: string;
  /** Human-readable justification for this value. */
  justification: string;
  /** Alternative plausible values. */
  alternatives: string[];
  /** AI confidence in the primary value (0.0–1.0). */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/**
 * AI agent that imagines realistic values for variables that cannot be
 * resolved statically.
 *
 * @example
 * ```ts
 * const agent = new VariableImaginerAgent(provider);
 * const result = await agent.imagine({
 *   variableName: 'userId',
 *   variableType: 'string',
 *   scenario: { scenarioId: 'login', scenarioName: 'User Login', scenarioDescription: '...' },
 *   surroundingCode: 'const userId = req.params.id;',
 *   existingState: {},
 * });
 * ```
 */
export class VariableImaginerAgent extends AIAgent {
  constructor(provider: AIProvider) {
    super(provider);
  }

  /**
   * Imagine a realistic value for a variable.
   *
   * @param input - Variable context and scenario information.
   * @returns The imagined value, justification, alternatives, and confidence.
   */
  async imagine(
    input: VariableImaginationInput,
  ): Promise<VariableImaginationResult> {
    const messages = this.buildPrompt(input);
    const raw = await this.chatJSON<VariableImaginationResult>(messages);

    return {
      value: String(raw.value ?? 'undefined'),
      justification: String(raw.justification ?? ''),
      alternatives: Array.isArray(raw.alternatives)
        ? raw.alternatives.map(String)
        : [],
      confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
    };
  }

  // -----------------------------------------------------------------------
  // Prompt construction
  // -----------------------------------------------------------------------

  /** Build the chat conversation for variable imagination. */
  private buildPrompt(input: VariableImaginationInput): ChatMessage[] {
    const systemMessage: ChatMessage = {
      role: 'system',
      content: [
        'You are an expert at inferring realistic runtime variable values.',
        'Given a variable name, its type, the scenario being traced, and surrounding code,',
        'propose the most plausible value the variable would hold at runtime.',
        '',
        'Respond with a JSON object containing:',
        '  value          — the imagined value as a string literal (e.g. \'"hello"\', \'42\', \'true\')',
        '  justification  — why this value is appropriate for the scenario',
        '  alternatives   — array of 1–3 alternative plausible values',
        '  confidence     — float 0.0–1.0',
        '',
        'Respond ONLY with a JSON object. No markdown fences, no extra text.',
      ].join('\n'),
    };

    const parts: string[] = [
      `## Scenario: ${input.scenario.scenarioName}`,
      input.scenario.scenarioDescription,
      '',
      `## Variable: \`${input.variableName}\``,
      `Type: \`${input.variableType}\``,
    ];

    if (input.functionName) {
      parts.push(`Function: \`${input.functionName}\``);
    }
    if (input.documentation) {
      parts.push(`Documentation: ${input.documentation}`);
    }

    parts.push(
      '',
      '## Surrounding Code',
      '```',
      input.surroundingCode,
      '```',
    );

    if (Object.keys(input.existingState).length > 0) {
      parts.push(
        '',
        '## Known Variable State',
        JSON.stringify(input.existingState, null, 2),
      );
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content: parts.join('\n'),
    };

    return [systemMessage, userMessage];
  }
}
