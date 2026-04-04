/**
 * Scenario Tracer — orchestrates step-by-step tracing of a scenario.
 *
 * Given a scenario's entry function, the tracer walks through the code:
 * 1. Reads the function source code
 * 2. For each call → pushes onto the call stack, recurses
 * 3. For each branch → asks AI to decide which path to take
 * 4. For each virtual dispatch → asks AI to pick an implementation
 * 5. Records each decision as a ScenarioStep
 *
 * @module scenario/tracer
 */

import type { ICodeParser, FunctionNode, BranchNode, CallEdge } from '../parser/interface.js';
import type { PathTracerAgent } from '../ai/path-tracer.js';
import type { VariableImaginerAgent } from '../ai/variable-imaginer.js';
import type { JustifierAgent } from '../ai/justifier.js';
import type { QueryEngine, CallRelation } from '../graph/queries.js';
import type { Scenario, ScenarioStep, CallStackFrame, FrameVariable } from './engine.js';
import { createModuleLogger } from '../config/logger.js';

const log = createModuleLogger('tracer');

/** Configuration for scenario tracing */
export interface TraceConfig {
  /** Maximum call depth to trace (default: 50) */
  maxDepth: number;
  /** Maximum steps per function (default: 200) */
  maxStepsPerFunction: number;
  /** Functions to skip during tracing (glob patterns) */
  boringFunctions: string[];
  /** Namespaces to skip during tracing */
  boringNamespaces: string[];
  /** Functions to always trace (overrides boring) */
  focusFunctions: string[];
}

/** Default tracing configuration */
export const DEFAULT_TRACE_CONFIG: TraceConfig = {
  maxDepth: 50,
  maxStepsPerFunction: 200,
  boringFunctions: [],
  boringNamespaces: [],
  focusFunctions: [],
};

/** Result of tracing a scenario */
export interface TraceResult {
  scenarioId: string;
  steps: Omit<ScenarioStep, 'scenarioId'>[];
  /** Total functions traversed */
  functionsTraversed: number;
  /** Branch decisions made */
  branchDecisions: number;
  /** Virtual dispatches resolved */
  dispatchesResolved: number;
  /** Tracing duration in milliseconds */
  durationMs: number;
}

/** Internal context maintained during tracing */
interface TraceContext {
  scenario: Scenario;
  config: TraceConfig;
  steps: Omit<ScenarioStep, 'scenarioId'>[];
  /** Current variable state across the trace */
  variableState: Record<string, string>;
  /** Current call stack depth */
  depth: number;
  /** Step counter */
  stepCounter: number;
  /** Functions already traced (to avoid infinite loops) */
  visitedFunctions: Set<string>;
  /** Live call stack — pushed on entry, popped on return */
  callStackFrames: CallStackFrame[];
  /** Metrics */
  functionsTraversed: number;
  branchDecisions: number;
  dispatchesResolved: number;
}

/**
 * ScenarioTracer — drives the step-by-step tracing of a scenario's execution path.
 *
 * This is the orchestrator that ties together:
 * - Parser (reads function source, finds branches/calls)
 * - PathTracerAgent (decides branches and dispatch)
 * - VariableImaginerAgent (imagines variable values)
 * - JustifierAgent (explains decisions)
 */
export class ScenarioTracer {
  constructor(
    private parser: ICodeParser,
    private queryEngine: QueryEngine,
    private pathTracer: PathTracerAgent,
    private variableImaginer: VariableImaginerAgent,
    private justifier: JustifierAgent
  ) {}

  /**
   * Trace a complete scenario from its entry function.
   *
   * @param scenario - The scenario to trace
   * @param config - Tracing configuration (depth limits, boring functions, etc.)
   * @returns TraceResult with all steps and metrics
   */
  async trace(
    scenario: Scenario,
    config: Partial<TraceConfig> = {}
  ): Promise<TraceResult> {
    const fullConfig = { ...DEFAULT_TRACE_CONFIG, ...config };
    const startTime = Date.now();

    log.info(`Starting trace for scenario: ${scenario.name}`);
    log.info(`Entry function: ${scenario.entryFunction}`);

    const ctx: TraceContext = {
      scenario,
      config: fullConfig,
      steps: [],
      variableState: {},
      depth: 0,
      stepCounter: 0,
      visitedFunctions: new Set(),
      callStackFrames: [],
      functionsTraversed: 0,
      branchDecisions: 0,
      dispatchesResolved: 0,
    };

    // Find the entry function in the graph
    // Try exact match first, then fuzzy match by name substring
    let entryFunction = await this.queryEngine.getFunctionByName(
      scenario.entryFunction
    );

    if (!entryFunction) {
      // Fuzzy fallback: search for functions containing the entry name
      const funcName = scenario.entryFunction.includes('::')
        ? scenario.entryFunction.split('::').pop()!
        : scenario.entryFunction.includes('.')
          ? scenario.entryFunction.split('.').pop()!
          : scenario.entryFunction;

      const candidates = await this.queryEngine.searchFunctions(funcName, 10);
      // Pick the best match — prefer exact qualifiedName ending
      entryFunction =
        candidates.find(
          (f) =>
            f.qualifiedName === scenario.entryFunction ||
            f.qualifiedName.endsWith(`::${funcName}`) ||
            f.qualifiedName.endsWith(`.${funcName}`),
        ) ??
        candidates.find((f) => f.name === funcName) ??
        candidates[0] ??
        null;

      if (entryFunction) {
        log.info(
          `Entry function "${scenario.entryFunction}" not found by exact match, ` +
          `using fuzzy match: ${entryFunction.qualifiedName}`
        );
      }
    }

    if (!entryFunction) {
      throw new Error(
        `Entry function not found: ${scenario.entryFunction}. ` +
        `Make sure it has been indexed.`
      );
    }

    // Start tracing from the entry function
    await this.traceFunction(ctx, entryFunction);

    const durationMs = Date.now() - startTime;
    log.info(
      `Trace complete: ${ctx.steps.length} steps, ` +
      `${ctx.functionsTraversed} functions, ` +
      `${ctx.branchDecisions} branches, ` +
      `${ctx.dispatchesResolved} dispatches, ` +
      `${durationMs}ms`
    );

    return {
      scenarioId: scenario.id,
      steps: ctx.steps,
      functionsTraversed: ctx.functionsTraversed,
      branchDecisions: ctx.branchDecisions,
      dispatchesResolved: ctx.dispatchesResolved,
      durationMs,
    };
  }

  /**
   * Trace a single function and its callees recursively.
   */
  private async traceFunction(
    ctx: TraceContext,
    func: FunctionNode
  ): Promise<void> {
    // Depth check
    if (ctx.depth >= ctx.config.maxDepth) {
      log.debug(`Max depth reached at ${func.qualifiedName}`);
      return;
    }

    // Loop detection
    if (ctx.visitedFunctions.has(func.id)) {
      log.debug(`Already visited ${func.qualifiedName}, skipping`);
      return;
    }

    // Check boring functions
    if (this.isBoring(func, ctx.config)) {
      log.debug(`Skipping boring function: ${func.qualifiedName}`);
      return;
    }

    ctx.visitedFunctions.add(func.id);
    ctx.functionsTraversed++;
    ctx.depth++;

    // Push a new frame onto the call stack
    const frame = await this.buildCallStackFrame(ctx, func);
    ctx.callStackFrames.push(frame);

    try {
      // Record the function entry step
      const entryStep = this.createStep(ctx, func, func.startLine, 'call',
        `Entering ${func.qualifiedName}`);
      ctx.steps.push(entryStep);

      // Get callees and branches for this function from the graph
      const [callees, branches] = await Promise.all([
        this.queryEngine.getCallees(func.id),
        this.queryEngine.getBranches(func.id),
      ]);

      // Process branches first — AI decides which path to take
      for (const branch of branches) {
        await this.processBranch(ctx, func, branch);
      }

      // Process call edges — recurse into callees
      for (const callRel of callees) {
        if (ctx.steps.length >= ctx.config.maxStepsPerFunction * 10) {
          log.warn(`Step limit reached, stopping trace`);
          return;
        }
        await this.processCall(ctx, func, callRel);
      }

      // Record function return
      const returnStep = this.createStep(ctx, func, func.endLine, 'return',
        `Returning from ${func.qualifiedName}`);
      ctx.steps.push(returnStep);
    } finally {
      // Pop the frame off the call stack
      ctx.callStackFrames.pop();
      ctx.depth--;
    }
  }

  /**
   * Process a branch: ask AI which path to take and record the decision.
   */
  private async processBranch(
    ctx: TraceContext,
    func: FunctionNode,
    branch: BranchNode
  ): Promise<void> {
    ctx.branchDecisions++;

    // Ask AI to decide branch direction
    const traceResult = await this.pathTracer.traceStep({
      functionSource: func.sourceCode,
      functionName: func.qualifiedName,
      scenario: {
        scenarioId: ctx.scenario.id,
        scenarioName: ctx.scenario.name,
        scenarioDescription: ctx.scenario.description,
      },
      variableState: { ...ctx.variableState },
      decisionType: 'branch',
      condition: branch.condition,
      line: branch.line,
    });

    // Imagine variable values if needed
    if (traceResult.updatedVariableState) {
      Object.assign(ctx.variableState, traceResult.updatedVariableState);
    }

    const action = traceResult.decision === 'then' ? 'branch_taken' : 'branch_skipped';
    const step = this.createStep(
      ctx, func, branch.line, action as ScenarioStep['action'],
      traceResult.justification
    );
    step.confidence = traceResult.confidence;
    ctx.steps.push(step);
  }

  /**
   * Process a function call: resolve dispatch if virtual, then trace callee.
   */
  private async processCall(
    ctx: TraceContext,
    caller: FunctionNode,
    callRel: CallRelation
  ): Promise<void> {
    const callee = callRel.function;

    // Check if this is a virtual dispatch that needs resolution
    if (callee.isAbstract) {
      ctx.dispatchesResolved++;

      const implementations = await this.parser.findImplementations(callee);

      if (implementations.length > 0) {
        // Ask AI which implementation to use
        const traceResult = await this.pathTracer.traceStep({
          functionSource: caller.sourceCode,
          functionName: caller.qualifiedName,
          scenario: {
            scenarioId: ctx.scenario.id,
            scenarioName: ctx.scenario.name,
            scenarioDescription: ctx.scenario.description,
          },
          variableState: { ...ctx.variableState },
          decisionType: 'dispatch',
          dispatchTargets: implementations.map(i => i.qualifiedName),
        });

        // Find the selected implementation
        const selected = implementations.find(
          i => i.qualifiedName === traceResult.decision
        ) ?? implementations[0]!;

        const step = this.createStep(
          ctx, caller, callee.startLine, 'dispatch',
          traceResult.justification
        );
        step.confidence = traceResult.confidence;
        ctx.steps.push(step);

        // Trace into the selected implementation
        await this.traceFunction(ctx, selected);
        return;
      }
    }

    // Normal (non-virtual) call — trace into the callee
    await this.traceFunction(ctx, callee);
  }

  /** Check if a function should be skipped during tracing */
  private isBoring(func: FunctionNode, config: TraceConfig): boolean {
    // Check focus functions first (override boring)
    for (const pattern of config.focusFunctions) {
      if (this.matchesPattern(func.qualifiedName, pattern)) {
        return false;
      }
    }

    // Check boring functions
    for (const pattern of config.boringFunctions) {
      if (this.matchesPattern(func.qualifiedName, pattern)) {
        return true;
      }
    }

    // Check boring namespaces
    for (const ns of config.boringNamespaces) {
      if (func.qualifiedName.startsWith(ns)) {
        return true;
      }
    }

    return false;
  }

  /** Simple glob-like pattern matching */
  private matchesPattern(name: string, pattern: string): boolean {
    if (pattern.endsWith('*')) {
      return name.startsWith(pattern.slice(0, -1));
    }
    return name === pattern;
  }

  /** Create a new scenario step */
  private createStep(
    ctx: TraceContext,
    func: FunctionNode,
    line: number,
    action: ScenarioStep['action'],
    justification: string
  ): Omit<ScenarioStep, 'scenarioId'> {
    const stepNumber = ++ctx.stepCounter;

    // Snapshot the current call stack (deep copy)
    const callStack = ctx.callStackFrames.map(frame => ({
      ...frame,
      variables: { ...frame.variables },
    }));

    // Update the current (top) frame's line to the active line
    if (callStack.length > 0) {
      callStack[callStack.length - 1]!.line = line;
    }

    return {
      id: `${ctx.scenario.id}-step-${stepNumber}`,
      stepNumber,
      functionId: func.id,
      functionName: func.qualifiedName,
      line,
      action,
      justification,
      variableState: { ...ctx.variableState },
      sourceCode: func.sourceCode,
      confidence: 1.0,
      callStack,
    };
  }

  /**
   * Build a CallStackFrame for a function being entered.
   * Uses the VariableImaginerAgent to imagine values for the function's parameters.
   */
  private async buildCallStackFrame(
    ctx: TraceContext,
    func: FunctionNode
  ): Promise<CallStackFrame> {
    const filePath = func.filePath || (func.id.includes(':') ? func.id.split(':').slice(0, -1).join(':') : func.id);

    const variables: Record<string, FrameVariable> = {};

    // Imagine values for each parameter of the function
    if (func.parameters && func.parameters.length > 0) {
      for (const param of func.parameters) {
        try {
          const result = await this.variableImaginer.imagine({
            variableName: param.name,
            variableType: param.type || 'unknown',
            scenario: {
              scenarioId: ctx.scenario.id,
              scenarioName: ctx.scenario.name,
              scenarioDescription: ctx.scenario.description,
            },
            surroundingCode: func.sourceCode,
            existingState: ctx.variableState,
            functionName: func.qualifiedName,
          });

          variables[param.name] = {
            value: result.value,
            type: param.type || 'unknown',
            rationale: result.justification,
            alternatives: result.alternatives,
            confidence: result.confidence,
          };
        } catch (err) {
          log.debug(`Failed to imagine variable ${param.name} in ${func.qualifiedName}: ${err instanceof Error ? err.message : String(err)}`);
          variables[param.name] = {
            value: param.defaultValue ?? 'undefined',
            type: param.type || 'unknown',
            rationale: 'Default value (AI imagination unavailable)',
            alternatives: [],
            confidence: 0.1,
          };
        }
      }
    }

    return {
      depth: ctx.depth - 1, // depth was already incremented before this call
      functionId: func.id,
      functionName: func.qualifiedName,
      filePath,
      line: func.startLine,
      variables,
    };
  }
}
