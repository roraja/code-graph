/**
 * Scenario Discovery Agent — uses AI to identify realistic user-facing
 * scenarios from parsed codebase information.
 *
 * The agent receives structural data (entry points, event handlers, public
 * APIs, call graph edges, branch points, and class hierarchy) and asks the
 * language model to propose scenarios that a real user or system interaction
 * would trigger.
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
  /** Fully qualified name (e.g. `DropHandler::handleFileDrop`). */
  qualifiedName?: string;
  /** Full signature including parameters and return type. */
  signature: string;
  /** JSDoc / comment documentation, if available. */
  documentation?: string;
  /** File where the function is defined. */
  filePath: string;
  /** Start line number (1-indexed). */
  startLine?: number;
  /** End line number (1-indexed). */
  endLine?: number;
  /** Return type of the function. */
  returnType?: string;
  /** Visibility: public, protected, private. */
  visibility?: string;
  /** Source language (e.g. 'ts', 'cpp'). */
  language?: string;
  /** Source code of the function body (truncated for prompt size). */
  sourceCode?: string;
  /** Whether the function is async. */
  isAsync?: boolean;
  /** Whether the function is abstract / virtual. */
  isAbstract?: boolean;
  /** Structured parameter information. */
  parameters?: Array<{
    name: string;
    type: string;
    isOptional: boolean;
    defaultValue?: string;
  }>;
}

/** A call edge between two functions, used to convey call graph context. */
export interface CallEdgeSummary {
  /** Qualified name of the calling function. */
  caller: string;
  /** Qualified name of the called function. */
  callee: string;
  /** Whether this is a virtual / dynamic dispatch call. */
  isVirtualDispatch?: boolean;
}

/** Summary of a branch / decision point inside a function. */
export interface BranchSummary {
  /** Containing function's qualified name. */
  functionName: string;
  /** Type of branch: "if", "switch_case", "ternary", etc. */
  type: string;
  /** The condition expression as source text. */
  condition: string;
  /** Line number of the branch. */
  line: number;
  /** Whether an else / default branch exists. */
  hasElse: boolean;
}

/** Summary of a class / interface for class hierarchy context. */
export interface ClassSummary {
  /** Class or interface name. */
  name: string;
  /** Whether it is an abstract class. */
  isAbstract: boolean;
  /** Whether it is an interface. */
  isInterface: boolean;
  /** Method names defined on this class. */
  methods: string[];
  /** File where the class is defined. */
  filePath: string;
  /** Optional documentation. */
  documentation?: string;
}

/** An inheritance / implementation relationship between classes. */
export interface InheritanceSummary {
  /** Child class name. */
  child: string;
  /** Parent class / interface name. */
  parent: string;
  /** Relationship type. */
  type: 'extends' | 'implements';
}

/** High-level codebase summary for orientation context. */
export interface CodebaseSummary {
  /** Short description of what the codebase does. */
  projectDescription?: string;
  /** Primary language(s) in the codebase. */
  languages?: string[];
  /** Total number of functions in the graph. */
  totalFunctions?: number;
  /** Total number of classes in the graph. */
  totalClasses?: number;
  /** Total number of files parsed. */
  totalFiles?: number;
  /** Distinct file path prefixes / module groupings. */
  moduleGroups?: string[];
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
  /** Call edges showing which functions call which. */
  callGraph?: CallEdgeSummary[];
  /** Branch / decision points in entry-point functions. */
  branchPoints?: BranchSummary[];
  /** Class hierarchy context. */
  classes?: ClassSummary[];
  /** Inheritance relationships between classes. */
  inheritances?: InheritanceSummary[];
  /** High-level codebase summary for orientation. */
  codebaseSummary?: CodebaseSummary;
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
  /**
   * Ordered list of function qualified names the scenario is expected to
   * traverse. Helps downstream tracing validate the AI's reasoning.
   */
  expectedPath?: string[];
  /**
   * Category tag for grouping related scenarios.
   * E.g. "authentication", "error-handling", "data-flow".
   */
  category?: string;
  /**
   * Whether this scenario represents a happy path, error path,
   * or edge case.
   */
  pathType?: 'happy' | 'error' | 'edge-case';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum characters of source code to include per function in the prompt. */
const MAX_SOURCE_CHARS = 800;

/** Maximum call graph edges to include before truncating. */
const MAX_CALL_EDGES = 60;

/** Maximum branch points to include before truncating. */
const MAX_BRANCH_POINTS = 40;

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
 *   callGraph: [...],
 *   branchPoints: [...],
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

    // Build a set of valid qualified names for validation.
    const validNames = new Set<string>();
    for (const f of [
      ...input.entryPoints,
      ...input.eventHandlers,
      ...input.publicAPIs,
    ]) {
      if (f.qualifiedName) validNames.add(f.qualifiedName);
      validNames.add(f.name);
    }

    // Normalise and validate each returned scenario.
    return items
      .map((s) => ({
        id: String(s.id ?? '').replace(/\s+/g, '-').toLowerCase(),
        name: String(s.name ?? 'Unnamed Scenario'),
        description: String(s.description ?? ''),
        entryFunction: String(s.entryFunction ?? ''),
        triggerCondition: String(s.triggerCondition ?? ''),
        confidence: typeof s.confidence === 'number' ? s.confidence : 0.5,
        expectedPath: Array.isArray(s.expectedPath)
          ? s.expectedPath.map(String)
          : undefined,
        category: typeof s.category === 'string' ? s.category : undefined,
        pathType: this.normalisePathType(s.pathType),
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
      content: this.buildSystemPrompt(input),
    };

    const userMessage: ChatMessage = {
      role: 'user',
      content: this.buildUserPrompt(input),
    };

    return [systemMessage, userMessage];
  }

  /**
   * Build a detailed system prompt that guides the AI towards high-quality
   * scenario discovery with rich structural context.
   */
  private buildSystemPrompt(input: ScenarioDiscoveryInput): string {
    const lines: string[] = [
      'You are an expert software analyst specialising in behavioural analysis of codebases.',
      'Your task is to discover realistic, high-value scenarios — concrete user-facing or system-facing',
      'interactions that exercise meaningful execution paths through the code.',
      '',
      '## What makes a GOOD scenario',
      '- It represents a real-world interaction a human user, API consumer, or external system would trigger.',
      '- It starts at a clear entry point and follows a non-trivial path through multiple functions.',
      '- It exercises important decision points (branches, dispatch) in the code.',
      '- It has a clear trigger condition and expected outcome.',
      '- It covers both happy paths AND important error / edge-case paths.',
      '',
      '## What makes a BAD scenario (avoid these)',
      '- Trivial getters/setters or utility functions with no meaningful logic.',
      '- Duplicate or near-duplicate of an already-discovered scenario.',
      '- Scenarios that only touch one function with no branches or calls.',
      '- Scenarios with vague descriptions like "user does something".',
      '- Internal implementation details that no external actor would trigger directly.',
      '',
      '## Diversity requirements',
      '- Include a mix of happy-path, error-handling, and edge-case scenarios.',
      '- Cover different functional areas / modules of the codebase.',
      '- If async functions exist, include at least one scenario that exercises async flows.',
      '- If class hierarchies with virtual dispatch exist, include a scenario that exercises polymorphism.',
      '',
      '## Analysis strategy',
      '1. Study the entry points to understand what external actors can trigger.',
      '2. Follow the call graph to see which functions are reachable and what paths are possible.',
      '3. Look at branch conditions to identify interesting decision points that lead to different outcomes.',
      '4. Consider error conditions: what happens when validation fails, data is missing, or exceptions occur?',
      '5. Check class hierarchies for polymorphic dispatch opportunities.',
      '6. Read function documentation and parameter types to understand domain semantics.',
      '',
      '## Output format',
      'Return a JSON array of scenario objects. Each object MUST have these fields:',
      '  id             — kebab-case identifier (e.g. "user-uploads-large-file")',
      '  name           — short human-readable name (3–8 words)',
      '  description    — detailed 2–4 sentence description explaining:',
      '                    (a) WHO triggers the scenario (user, API client, scheduler, etc.)',
      '                    (b) WHAT they do and WHY',
      '                    (c) WHAT the expected outcome is (success or specific failure)',
      '                    (d) WHAT key decision points are exercised',
      '  entryFunction  — MUST be an exact qualifiedName from the function list below',
      '                    (e.g. "DropHandler::handleFileDrop" or "AuthService.authenticateUser")',
      '  triggerCondition — the specific event, HTTP request, user action, or system event that starts it',
      '  confidence     — float 0.0–1.0 (use >0.8 only when the path is clearly supported by code evidence)',
      '',
      'Optional fields (include when you can infer them from the call graph):',
      '  expectedPath   — ordered array of qualifiedName strings showing the expected call sequence',
      '  category       — grouping tag (e.g. "authentication", "file-handling", "error-recovery")',
      '  pathType       — "happy", "error", or "edge-case"',
      '',
      'Respond ONLY with a JSON array. No markdown fences, no commentary, no extra text.',
    ];

    return lines.join('\n');
  }

  /** Build the user message with all available structural context. */
  private buildUserPrompt(input: ScenarioDiscoveryInput): string {
    const sections: string[] = [];

    // ---- Codebase summary (orientation) ----
    if (input.codebaseSummary) {
      sections.push(this.formatCodebaseSummary(input.codebaseSummary));
    }

    // ---- Entry points ----
    if (input.entryPoints.length > 0) {
      sections.push(
        '## Entry Points',
        'These are the top-level functions that external actors invoke (route handlers, main functions, CLI commands).',
        '',
        ...input.entryPoints.map((f) => this.formatFunction(f)),
      );
    }

    // ---- Event handlers ----
    if (input.eventHandlers.length > 0) {
      sections.push(
        '## Event Handlers',
        'These functions respond to events (user interactions, messages, lifecycle hooks).',
        '',
        ...input.eventHandlers.map((f) => this.formatFunction(f)),
      );
    }

    // ---- Public APIs ----
    if (input.publicAPIs.length > 0) {
      sections.push(
        '## Public APIs',
        'Exported functions available to external consumers.',
        '',
        ...input.publicAPIs.map((f) => this.formatFunction(f)),
      );
    }

    // ---- Call graph ----
    if (input.callGraph && input.callGraph.length > 0) {
      sections.push(this.formatCallGraph(input.callGraph));
    }

    // ---- Branch / decision points ----
    if (input.branchPoints && input.branchPoints.length > 0) {
      sections.push(this.formatBranchPoints(input.branchPoints));
    }

    // ---- Class hierarchy ----
    if (input.classes && input.classes.length > 0) {
      sections.push(
        this.formatClassHierarchy(input.classes, input.inheritances ?? []),
      );
    }

    // ---- Existing scenarios to avoid ----
    if (input.existingScenarios && input.existingScenarios.length > 0) {
      sections.push(
        '## Already Discovered Scenarios (do NOT duplicate these)',
        'Each scenario below has already been identified. Propose DIFFERENT scenarios',
        'that cover different paths, different error conditions, or different entry points.',
        '',
        ...input.existingScenarios.map(
          (s) =>
            `- **${s.id}**: ${s.name} — ${s.description}` +
            (s.pathType ? ` [${s.pathType}]` : '') +
            (s.category ? ` (${s.category})` : ''),
        ),
      );
    }

    // ---- User hint ----
    if (input.userHint) {
      sections.push(
        '## User Guidance',
        'The user has provided the following hint to focus your analysis:',
        '',
        input.userHint,
      );
    }

    return sections.join('\n\n');
  }

  // -----------------------------------------------------------------------
  // Section formatters
  // -----------------------------------------------------------------------

  /** Format the high-level codebase summary for orientation. */
  private formatCodebaseSummary(summary: CodebaseSummary): string {
    const lines: string[] = ['## Codebase Overview'];

    if (summary.projectDescription) {
      lines.push(summary.projectDescription);
      lines.push('');
    }

    const stats: string[] = [];
    if (summary.languages && summary.languages.length > 0) {
      stats.push(`Languages: ${summary.languages.join(', ')}`);
    }
    if (summary.totalFunctions != null) {
      stats.push(`Functions: ${summary.totalFunctions}`);
    }
    if (summary.totalClasses != null) {
      stats.push(`Classes/Interfaces: ${summary.totalClasses}`);
    }
    if (summary.totalFiles != null) {
      stats.push(`Files: ${summary.totalFiles}`);
    }
    if (stats.length > 0) {
      lines.push(stats.join(' | '));
    }

    if (summary.moduleGroups && summary.moduleGroups.length > 0) {
      lines.push('');
      lines.push('Module structure:');
      for (const mod of summary.moduleGroups) {
        lines.push(`  - ${mod}`);
      }
    }

    return lines.join('\n');
  }

  /** Format a function summary into a detailed readable block for the AI. */
  private formatFunction(f: FunctionSummary): string {
    const parts: string[] = [];
    const displayName = f.qualifiedName ?? f.name;
    const location = f.startLine
      ? `${f.filePath}:${f.startLine}${f.endLine ? `-${f.endLine}` : ''}`
      : f.filePath;

    // Header line with name and location
    parts.push(`- \`${displayName}\` (${location})`);
    parts.push(`  Signature: \`${f.signature}\``);

    // Structured parameter details
    if (f.parameters && f.parameters.length > 0) {
      const paramDescs = f.parameters.map((p) => {
        let desc = `\`${p.name}: ${p.type}\``;
        if (p.isOptional) desc += ' (optional)';
        if (p.defaultValue) desc += ` = ${p.defaultValue}`;
        return desc;
      });
      parts.push(`  Parameters: ${paramDescs.join(', ')}`);
    }

    if (f.returnType) {
      parts.push(`  Returns: \`${f.returnType}\``);
    }

    // Annotations
    const annotations: string[] = [];
    if (f.isAsync) annotations.push('async');
    if (f.isAbstract) annotations.push('abstract');
    if (f.visibility && f.visibility !== 'public') annotations.push(f.visibility);
    if (f.language) annotations.push(f.language);
    if (annotations.length > 0) {
      parts.push(`  Attributes: ${annotations.join(', ')}`);
    }

    if (f.documentation) {
      // Include full documentation — it has high signal-to-noise ratio
      parts.push(`  Documentation: ${f.documentation}`);
    }

    if (f.sourceCode) {
      const truncated =
        f.sourceCode.length > MAX_SOURCE_CHARS
          ? f.sourceCode.slice(0, MAX_SOURCE_CHARS) + '\n    // ... (truncated)'
          : f.sourceCode;
      parts.push(`  Source:\n    ${truncated.split('\n').join('\n    ')}`);
    }

    return parts.join('\n');
  }

  /** Format call graph edges into a readable section. */
  private formatCallGraph(edges: CallEdgeSummary[]): string {
    const lines: string[] = [
      '## Call Graph',
      'Shows which functions call which. Use this to trace possible execution paths',
      'from entry points through the codebase.',
      '',
    ];

    const displayed = edges.slice(0, MAX_CALL_EDGES);
    for (const edge of displayed) {
      const dispatch = edge.isVirtualDispatch ? ' [virtual dispatch]' : '';
      lines.push(`- \`${edge.caller}\` → \`${edge.callee}\`${dispatch}`);
    }

    if (edges.length > MAX_CALL_EDGES) {
      lines.push(
        `  ... and ${edges.length - MAX_CALL_EDGES} more call edges (truncated)`,
      );
    }

    return lines.join('\n');
  }

  /** Format branch / decision points into a readable section. */
  private formatBranchPoints(branches: BranchSummary[]): string {
    const lines: string[] = [
      '## Decision Points (Branches)',
      'These are the if/switch/ternary conditions in key functions.',
      'Interesting scenarios should exercise different branches of these conditions.',
      '',
    ];

    const displayed = branches.slice(0, MAX_BRANCH_POINTS);
    for (const b of displayed) {
      const elseInfo = b.hasElse ? ' (has else/default)' : ' (no else)';
      lines.push(
        `- In \`${b.functionName}\` at line ${b.line} [${b.type}]: \`${b.condition}\`${elseInfo}`,
      );
    }

    if (branches.length > MAX_BRANCH_POINTS) {
      lines.push(
        `  ... and ${branches.length - MAX_BRANCH_POINTS} more branch points (truncated)`,
      );
    }

    return lines.join('\n');
  }

  /** Format class hierarchy into a readable section. */
  private formatClassHierarchy(
    classes: ClassSummary[],
    inheritances: InheritanceSummary[],
  ): string {
    const lines: string[] = [
      '## Class Hierarchy',
      'Classes and interfaces with their relationships. Virtual dispatch scenarios',
      'should consider which concrete implementation would be called.',
      '',
    ];

    for (const cls of classes) {
      const kind = cls.isInterface
        ? 'interface'
        : cls.isAbstract
          ? 'abstract class'
          : 'class';
      const methods =
        cls.methods.length > 0
          ? ` — methods: ${cls.methods.join(', ')}`
          : '';
      const doc = cls.documentation ? ` — ${cls.documentation}` : '';
      lines.push(`- **${cls.name}** (${kind}, ${cls.filePath})${methods}${doc}`);
    }

    if (inheritances.length > 0) {
      lines.push('');
      lines.push('Inheritance relationships:');
      for (const inh of inheritances) {
        lines.push(`- \`${inh.child}\` ${inh.type} \`${inh.parent}\``);
      }
    }

    return lines.join('\n');
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  /** Normalise the pathType field to one of the known values, or undefined. */
  private normalisePathType(
    value: unknown,
  ): 'happy' | 'error' | 'edge-case' | undefined {
    if (typeof value !== 'string') return undefined;
    const lower = value.toLowerCase().replace(/[\s_]+/g, '-');
    if (lower === 'happy') return 'happy';
    if (lower === 'error') return 'error';
    if (lower === 'edge-case' || lower === 'edgecase' || lower === 'edge') {
      return 'edge-case';
    }
    return undefined;
  }
}
