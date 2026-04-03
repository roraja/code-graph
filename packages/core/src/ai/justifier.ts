/**
 * Justifier Agent — generates human-readable explanations for decisions
 * made during scenario tracing.
 *
 * When the tracer takes a branch or dispatches to an implementation,
 * this agent produces an explanation the user can review and potentially
 * correct.
 *
 * @module ai/justifier
 */

import { AIAgent, type AIProvider, type ChatMessage } from './agent.js';

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

/** Request for a justification. */
export interface JustificationRequest {
  /** The kind of decision being justified. */
  decisionType: 'branch' | 'dispatch';
  /**
   * For branches: the condition expression.
   * For dispatch: description of the virtual call.
   */
  condition?: string;
  /**
   * For dispatch: the list of available implementations.
   */
  implementations?: string[];
  /** The path that was chosen (e.g. `'then'`, `'else'`, or an implementation name). */
  chosenPath: string;
  /** Scenario context. */
  scenario: {
    /** Unique ID of the scenario. */
    scenarioId: string;
    /** Human-readable scenario name. */
    scenarioName: string;
    /** Scenario description. */
    scenarioDescription: string;
  };
  /** Current variable state at the decision point. */
  variableState: Record<string, string>;
  /** Source code snippet around the decision point. */
  codeSnippet: string;
}

/** A justification produced by the agent. */
export interface Justification {
  /** Human-readable explanation of why the path was chosen. */
  explanation: string;
  /** AI confidence in the justification (0.0–1.0). */
  confidence: number;
  /** Assumptions the decision relies on. */
  assumptions: string[];
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/**
 * AI agent that generates human-readable justifications for tracing
 * decisions.
 *
 * @example
 * ```ts
 * const agent = new JustifierAgent(provider);
 * const justification = await agent.justify({
 *   decisionType: 'branch',
 *   condition: 'user.isAdmin',
 *   chosenPath: 'then',
 *   scenario: { scenarioId: 'admin-action', ... },
 *   variableState: { 'user.isAdmin': 'true' },
 *   codeSnippet: 'if (user.isAdmin) { ... }',
 * });
 * ```
 */
export class JustifierAgent extends AIAgent {
  constructor(provider: AIProvider) {
    super(provider);
  }

  /**
   * Generate a justification for a tracing decision.
   *
   * @param input - Decision context.
   * @returns An explanation, confidence score, and list of assumptions.
   */
  async justify(input: JustificationRequest): Promise<Justification> {
    const messages = this.buildPrompt(input);
    const raw = await this.chatJSON<Justification>(messages);

    return {
      explanation: String(raw.explanation ?? ''),
      confidence: typeof raw.confidence === 'number' ? raw.confidence : 0.5,
      assumptions: Array.isArray(raw.assumptions)
        ? raw.assumptions.map(String)
        : [],
    };
  }

  // -----------------------------------------------------------------------
  // Prompt construction
  // -----------------------------------------------------------------------

  /** Build the chat conversation for justification generation. */
  private buildPrompt(input: JustificationRequest): ChatMessage[] {
    const systemMessage: ChatMessage = {
      role: 'system',
      content: [
        'You are an expert at explaining code execution decisions in plain English.',
        'Given a decision that was made during scenario tracing (branch taken or dispatch',
        'target chosen), generate a clear human-readable justification the user can review.',
        '',
        'Respond with a JSON object containing:',
        '  explanation — clear, concise explanation of why this path was chosen',
        '  confidence  — float 0.0–1.0 indicating how certain the explanation is',
        '  assumptions — array of strings listing assumptions the decision relies on',
        '',
        'Respond ONLY with a JSON object. No markdown fences, no extra text.',
      ].join('\n'),
    };

    const parts: string[] = [
      `## Scenario: ${input.scenario.scenarioName}`,
      input.scenario.scenarioDescription,
      '',
      `## Decision Type: ${input.decisionType}`,
      `Chosen Path: **${input.chosenPath}**`,
    ];

    if (input.decisionType === 'branch' && input.condition) {
      parts.push(`Condition: \`${input.condition}\``);
    }

    if (input.decisionType === 'dispatch' && input.implementations) {
      parts.push(
        'Available Implementations:',
        ...input.implementations.map((i) => `- ${i}`),
      );
    }

    parts.push(
      '',
      '## Code Snippet',
      '```',
      input.codeSnippet,
      '```',
      '',
      '## Variable State',
      JSON.stringify(input.variableState, null, 2),
    );

    const userMessage: ChatMessage = {
      role: 'user',
      content: parts.join('\n'),
    };

    return [systemMessage, userMessage];
  }
}
