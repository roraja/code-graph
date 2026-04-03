/**
 * Scenario Discovery Agent — uses AI to identify realistic user-facing
 * scenarios from parsed codebase information.
 *
 * The agent receives structural data (entry points, event handlers, public
 * APIs) and asks the language model to propose scenarios that a real user
 * or system interaction would trigger.
 *
 * @module ai/scenario-discovery
 */

import { AIAgent, type AIProvider, type ChatMessage } from './agent.js';
import type { FunctionNode } from '../parser/interface.js';

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

/** Summary of a function provided as context to the discovery agent. */
export interface FunctionSummary {
  /** Unique identifier of the function. */
  id: string;
  /** Simple name (e.g. `handleFileDrop`). */
  name: string;
  /** Full signature including parameters and return type. */
  signature: string;
  /** JSDoc / comment documentation, if available. */
  documentation?: string;
  /** File where the function is defined. */
  filePath: string;
}

/** Input data for scenario discovery. */
export interface ScenarioDiscoveryInput {
  /** Top-level entry points (e.g. route handlers, main functions). */
  entryPoints: FunctionSummary[];
  /** Event handler functions (e.g. onClick, onMessage). */
  eventHandlers: FunctionSummary[];
  /** Publicly exported API functions. */
  publicAPIs: FunctionSummary[];
  /** Optional natural-language hint from the user about what to look for. */
  userHint?: string;
  /** Already-discovered scenarios to avoid duplicates. */
  existingScenarios?: DiscoveredScenario[];
}

/**
 * A scenario proposed by the AI agent.
 *
 * Scenarios represent concrete, user-facing interactions that exercise
 * meaningful paths through the codebase.
 */
export interface DiscoveredScenario {
  /** Kebab-case unique identifier (e.g. `user-uploads-file`). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Detailed description of the scenario. */
  description: string;
  /** The function where this scenario begins execution. */
  entryFunction: string;
  /** The condition / event that triggers this scenario. */
  triggerCondition: string;
  /**
   * AI confidence in this scenario being realistic and useful.
   * Range: 0.0 – 1.0.
   */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

/**
 * AI agent that discovers realistic user-facing scenarios from parsed
 * codebase structure.
 *
 * @example
 * ```ts
 * const agent = new ScenarioDiscoveryAgent(provider);
 * const scenarios = await agent.discover({
 *   entryPoints: [...],
 *   eventHandlers: [...],
 *   publicAPIs: [...],
 * });
 * ```
 */
export class ScenarioDiscoveryAgent extends AIAgent {
  constructor(provider: AIProvider) {
    super(provider);
  }

  /**
   * Discover scenarios from the provided codebase context.
   *
   * @param input - Structural context for discovery.
   * @returns An array of discovered scenarios sorted by descending confidence.
   */
  async discover(input: ScenarioDiscoveryInput): Promise<DiscoveredScenario[]> {
    const messages = this.buildPrompt(input);
    const raw = await this.chatJSON<DiscoveredScenario[] | unknown>(messages);

    // The AI may return a non-array; normalise to an array.
    const items: DiscoveredScenario[] = Array.isArray(raw) ? raw : [];

    // Normalise and validate each returned scenario.
    return items
      .map((s) => ({
        id: String(s.id ?? '').replace(/\s+/g, '-').toLowerCase(),
        name: String(s.name ?? 'Unnamed Scenario'),
        description: String(s.description ?? ''),
        entryFunction: String(s.entryFunction ?? ''),
        triggerCondition: String(s.triggerCondition ?? ''),
        confidence: typeof s.confidence === 'number' ? s.confidence : 0.5,
      }))
      .sort((a, b) => b.confidence - a.confidence);
  }

  // -----------------------------------------------------------------------
  // Prompt construction
  // -----------------------------------------------------------------------

  /** Build the chat conversation for scenario discovery. */
  private buildPrompt(input: ScenarioDiscoveryInput): ChatMessage[] {
    const systemMessage: ChatMessage = {
      role: 'system',
      content: [
        'You are an expert software analyst.',
        'Given structural information about a codebase (entry points, event handlers, public APIs),',
        'identify realistic user-facing scenarios — concrete interactions a real user or external system would trigger.',
        '',
        'For each scenario, return a JSON array of objects with these fields:',
        '  id            — kebab-case identifier (e.g. "user-uploads-file")',
        '  name          — short human-readable name',
        '  description   — detailed description of the scenario',
        '  entryFunction — the function where execution begins',
        '  triggerCondition — the event or condition that triggers it',
        '  confidence    — float 0.0–1.0 indicating how realistic and useful the scenario is',
        '',
        'Respond ONLY with a JSON array. No markdown fences, no extra text.',
      ].join('\n'),
    };

    const sections: string[] = [];

    if (input.entryPoints.length > 0) {
      sections.push(
        '## Entry Points',
        ...input.entryPoints.map((f) => this.formatFunction(f)),
      );
    }
    if (input.eventHandlers.length > 0) {
      sections.push(
        '## Event Handlers',
        ...input.eventHandlers.map((f) => this.formatFunction(f)),
      );
    }
    if (input.publicAPIs.length > 0) {
      sections.push(
        '## Public APIs',
        ...input.publicAPIs.map((f) => this.formatFunction(f)),
      );
    }
    if (input.existingScenarios && input.existingScenarios.length > 0) {
      sections.push(
        '## Already Discovered Scenarios (do not duplicate)',
        ...input.existingScenarios.map(
          (s) => `- ${s.id}: ${s.name} — ${s.description}`,
        ),
      );
    }
    if (input.userHint) {
      sections.push(`## User Hint\n${input.userHint}`);
    }

    const userMessage: ChatMessage = {
      role: 'user',
      content: sections.join('\n\n'),
    };

    return [systemMessage, userMessage];
  }

  /** Format a function summary into a concise readable block. */
  private formatFunction(f: FunctionSummary): string {
    const doc = f.documentation ? ` — ${f.documentation}` : '';
    return `- \`${f.name}\` (${f.filePath}): ${f.signature}${doc}`;
  }
}
