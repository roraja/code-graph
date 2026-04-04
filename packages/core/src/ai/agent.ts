/**
 * AI Agent Layer — base classes, providers, and factory for AI interactions.
 *
 * Provides the foundational types and implementations for all AI agents
 * in the CodeGraph system. Agents use an {@link AIProvider} to communicate
 * with a language model (or a mock for testing).
 *
 * @module ai/agent
 */

import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Configuration for creating an AI provider. */
export interface AIConfig {
  /** Which provider backend to use. `'mock'` requires no API key. */
  provider: 'openai' | 'mock' | 'copilot';
  /** Model identifier, e.g. `'gpt-4-turbo'`. */
  model: string;
  /** API key for the provider (not required for `'mock'`). */
  apiKey?: string;
  /** Maximum tokens in the completion response. */
  maxTokens?: number;
  /** Sampling temperature (0–2). Lower values are more deterministic. */
  temperature?: number;
}

// ---------------------------------------------------------------------------
// Chat primitives
// ---------------------------------------------------------------------------

/** A single message in a chat conversation. */
export interface ChatMessage {
  /** The role of the message author. */
  role: 'system' | 'user' | 'assistant';
  /** The text content of the message. */
  content: string;
}

/** Options that can be passed per-call to {@link AIProvider.chat}. */
export interface ChatOptions {
  /** Sampling temperature override for this call. */
  temperature?: number;
  /** Max-tokens override for this call. */
  maxTokens?: number;
  /** When `true`, instructs the provider to return valid JSON. */
  jsonMode?: boolean;
}

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

/**
 * An AI provider abstracts communication with a language-model backend.
 *
 * Implementations must convert the generic {@link ChatMessage} array into
 * the provider-specific API format and return the assistant's response text.
 */
export interface AIProvider {
  /**
   * Send a conversation to the model and return the assistant reply.
   *
   * @param messages - Ordered conversation messages.
   * @param options  - Per-call overrides.
   * @returns The assistant's response text.
   */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}

// ---------------------------------------------------------------------------
// OpenAI provider
// ---------------------------------------------------------------------------

/**
 * Production AI provider backed by the OpenAI API.
 *
 * Requires a valid `apiKey` and uses the Chat Completions endpoint.
 */
export class OpenAIProvider implements AIProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly defaultMaxTokens: number;
  private readonly defaultTemperature: number;

  constructor(config: AIConfig) {
    if (!config.apiKey) {
      throw new Error('OpenAIProvider requires an apiKey in AIConfig');
    }
    this.client = new OpenAI({ apiKey: config.apiKey });
    this.model = config.model;
    this.defaultMaxTokens = config.maxTokens ?? 4096;
    this.defaultTemperature = config.temperature ?? 0.3;
  }

  /** @inheritdoc */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      max_tokens: options?.maxTokens ?? this.defaultMaxTokens,
      temperature: options?.temperature ?? this.defaultTemperature,
      ...(options?.jsonMode
        ? { response_format: { type: 'json_object' as const } }
        : {}),
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned an empty response');
    }
    return content;
  }
}

// ---------------------------------------------------------------------------
// Mock provider (for testing)
// ---------------------------------------------------------------------------

/** A single mock response rule. */
export interface MockResponseRule {
  /** Substring or RegExp to match against the last user message. */
  pattern: string | RegExp;
  /** The response text to return when the pattern matches. */
  response: string;
}

/**
 * Mock AI provider for deterministic testing without API keys.
 *
 * Supports two modes:
 * 1. **Canned responses** — a queue of responses returned in order.
 * 2. **Pattern-based responses** — rules matched against the last user
 *    message content. Rules are evaluated in order; the first match wins.
 *
 * If neither produces a match the provider returns a sensible default
 * JSON response inferred from the prompt content.
 */
export class MockAIProvider implements AIProvider {
  /** Ordered queue of canned responses (consumed FIFO). */
  private cannedResponses: string[] = [];
  /** Pattern→response rules evaluated when no canned response is available. */
  private rules: MockResponseRule[] = [];
  /** All messages received, useful for test assertions. */
  public readonly receivedMessages: ChatMessage[][] = [];

  /**
   * Enqueue one or more canned responses.
   *
   * @param responses - Responses returned in FIFO order.
   */
  addResponses(...responses: string[]): void {
    this.cannedResponses.push(...responses);
  }

  /**
   * Add a pattern-based response rule.
   *
   * @param pattern  - Substring or RegExp to match against the last user
   *                   message in the conversation.
   * @param response - Text to return when matched.
   */
  addRule(pattern: string | RegExp, response: string): void {
    this.rules.push({ pattern, response });
  }

  /** @inheritdoc */
  async chat(messages: ChatMessage[], _options?: ChatOptions): Promise<string> {
    this.receivedMessages.push([...messages]);

    // 1. Canned response takes priority.
    if (this.cannedResponses.length > 0) {
      return this.cannedResponses.shift()!;
    }

    // 2. Pattern matching on the last user message.
    const lastUserMessage =
      [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

    for (const rule of this.rules) {
      const matches =
        typeof rule.pattern === 'string'
          ? lastUserMessage.includes(rule.pattern)
          : rule.pattern.test(lastUserMessage);
      if (matches) {
        return rule.response;
      }
    }

    // 3. Smart default — infer from all message content (system + user).
    const allContent = messages.map((m) => m.content).join('\n');
    return this.inferDefaultResponse(allContent);
  }

  // -----------------------------------------------------------------------
  // Smart default inference
  // -----------------------------------------------------------------------

  /**
   * Produce a reasonable mock response based on prompt content keywords.
   * This allows tests that don't pre-configure responses to still get
   * structurally valid JSON back.
   */
  private inferDefaultResponse(prompt: string): string {
    const lower = prompt.toLowerCase();

    if (lower.includes('scenario') || lower.includes('discover')) {
      return JSON.stringify([
        {
          id: 'mock-scenario-1',
          name: 'Mock Scenario',
          description: 'A mock scenario for testing',
          entryFunction: 'handleRequest',
          triggerCondition: 'User sends a request',
          confidence: 0.85,
        },
      ]);
    }

    if (lower.includes('branch') || lower.includes('trace') || lower.includes('decision')) {
      return JSON.stringify({
        decision: 'then',
        justification: 'The condition evaluates to true given the scenario context.',
        updatedVariableState: {},
        confidence: 0.9,
      });
    }

    if (lower.includes('variable') || lower.includes('imagine') || lower.includes('value')) {
      return JSON.stringify({
        value: '"mock-value"',
        justification: 'A reasonable mock value for testing purposes.',
        alternatives: ['"alt-value-1"', '"alt-value-2"'],
        confidence: 0.8,
      });
    }

    if (lower.includes('correction') || lower.includes('interpret')) {
      return JSON.stringify({
        correctionType: 'variable_constraint',
        target: 'userId',
        rule: 'userId should always be a positive integer',
        scope: 'global',
        confidence: 0.75,
        clarificationNeeded: false,
      });
    }

    if (lower.includes('justif') || lower.includes('explain')) {
      return JSON.stringify({
        explanation:
          'The branch was taken because the condition matched the scenario context.',
        confidence: 0.85,
        assumptions: ['Variable state is as described.'],
      });
    }

    // Fallback
    return JSON.stringify({ result: 'mock-response' });
  }
}

// ---------------------------------------------------------------------------
// Base AI agent class
// ---------------------------------------------------------------------------

/**
 * Base class for all specialised AI agents.
 *
 * Subclasses implement domain-specific methods (e.g. `discover`, `traceStep`)
 * that compose prompts, call {@link AIProvider.chat}, and parse the response
 * into structured types.
 */
export class AIAgent {
  /** The underlying provider used for chat completions. */
  protected readonly provider: AIProvider;

  constructor(provider: AIProvider) {
    this.provider = provider;
  }

  /**
   * Send a conversation to the provider and return the raw text response.
   *
   * @param messages - Ordered conversation messages.
   * @param options  - Per-call overrides.
   */
  protected async chat(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<string> {
    return this.provider.chat(messages, options);
  }

  /**
   * Convenience: send a conversation expecting a JSON response and parse it.
   *
   * @param messages - Ordered conversation messages.
   * @param options  - Per-call overrides (jsonMode is forced to `true`).
   * @returns Parsed JSON value.
   */
  protected async chatJSON<T = unknown>(
    messages: ChatMessage[],
    options?: ChatOptions,
  ): Promise<T> {
    const raw = await this.chat(messages, { ...options, jsonMode: true });
    // Strip markdown fences that some models wrap around JSON.
    const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '');
    return JSON.parse(cleaned) as T;
  }
}

// ---------------------------------------------------------------------------
import { CopilotCLIProvider } from './copilot-cli-provider.js';

// Factory
// ---------------------------------------------------------------------------

/**
 * Create an {@link AIProvider} from a configuration object.
 *
 * @param config - Provider configuration.
 * @returns A ready-to-use provider instance.
 */
export function createAIProvider(config: AIConfig): AIProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAIProvider(config);
    case 'mock':
      return new MockAIProvider();
    case 'copilot':
      return new CopilotCLIProvider();
    default:
      throw new Error(`Unknown AI provider: ${String((config as AIConfig).provider)}`);
  }
}
