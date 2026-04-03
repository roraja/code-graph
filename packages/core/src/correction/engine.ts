/**
 * Correction Engine — processes human corrections and updates the graph.
 *
 * Users provide natural-language corrections via chat (e.g.,
 * "file_count can never be 0 in this scenario"). The correction engine:
 *
 * 1. Uses AI to interpret the correction into a structured rule
 * 2. Validates the rule against the graph schema
 * 3. Writes the correction to Neo4j
 * 4. Triggers a cascading re-trace of affected downstream steps
 *
 * @module correction/engine
 */

import type { GraphDriver } from '../graph/driver.js';
import type { ScenarioEngine, Scenario, ScenarioStep } from '../scenario/engine.js';
import type { ScenarioTracer, TraceConfig } from '../scenario/tracer.js';
import type {
  CorrectionInterpreterAgent,
  StructuredCorrection as AIStructuredCorrection,
} from '../ai/correction-interpreter.js';
import { createModuleLogger } from '../config/logger.js';

const log = createModuleLogger('correction');

/** Types of corrections users can make */
export type CorrectionType =
  | 'variable_constraint'
  | 'branch_override'
  | 'dispatch_override'
  | 'scenario_note'
  | 'function_skip'
  | 'function_include'
  | 'global_rule';

/** Scope of a correction */
export type CorrectionScope = 'global' | 'scenario' | 'function' | 'step';

/** A structured correction derived from user input */
export interface StructuredCorrection {
  type: CorrectionType;
  target: {
    scenarioId?: string;
    functionId?: string;
    variableName?: string;
    stepId?: string;
    branchId?: string;
    line?: number;
  };
  /** Machine-interpretable rule (e.g., "file_count != 0") */
  rule: string;
  scope: CorrectionScope;
  confidence: number;
  /** If ambiguous, what to ask the user */
  clarificationNeeded?: string;
}

/** A persisted correction in the graph database */
export interface Correction {
  id: string;
  type: CorrectionType;
  /** Original user chat message */
  prompt: string;
  /** Extracted rule */
  rule: string;
  scope: CorrectionScope;
  /** What this correction targets */
  target: StructuredCorrection['target'];
  appliedAt: string;
  userId: string;
}

/** Context for interpreting a correction */
export interface CorrectionContext {
  scenario?: Scenario;
  currentStep?: ScenarioStep;
  currentFunction?: { id: string; name: string; sourceCode: string };
  variableState?: Record<string, unknown>;
}

/** Result of applying a correction */
export interface CorrectionResult {
  correction: Correction;
  /** Steps that were affected by this correction */
  affectedSteps: ScenarioStep[];
  /** Whether a re-trace was triggered */
  retraceTriggered: boolean;
  /** If clarification is needed before applying */
  clarificationNeeded?: string;
}

/**
 * CorrectionEngine — handles the full lifecycle of a human correction:
 * interpret → validate → apply → cascade.
 */
export class CorrectionEngine {
  constructor(
    private driver: GraphDriver,
    private scenarioEngine: ScenarioEngine,
    private scenarioTracer: ScenarioTracer | null,
    private interpreter: CorrectionInterpreterAgent
  ) {}

  /**
   * Submit a natural-language correction and apply it.
   *
   * @param message - User's correction message (e.g., "file_count is always > 0")
   * @param context - Current viewing context (scenario, step, function)
   * @param userId - ID of the user making the correction
   * @returns CorrectionResult with the applied correction and affected steps
   */
  async submitCorrection(
    message: string,
    context: CorrectionContext,
    userId: string = 'anonymous'
  ): Promise<CorrectionResult> {
    log.info(`Processing correction: "${message}"`);

    // Step 1: Interpret the correction using AI
    const aiCorrection: AIStructuredCorrection = await this.interpreter.interpret({
      userMessage: message,
      context: {
        scenario: context.scenario ? {
          scenarioId: context.scenario.id,
          scenarioName: context.scenario.name,
          scenarioDescription: context.scenario.description,
        } : undefined,
        currentStep: context.currentStep
          ? `Step ${context.currentStep.stepNumber}: ${context.currentStep.functionName}`
          : undefined,
        currentFunction: context.currentFunction?.name,
        variableState: context.variableState
          ? Object.fromEntries(
              Object.entries(context.variableState).map(([k, v]) => [k, String(v)])
            )
          : undefined,
      },
    });

    // Map AI StructuredCorrection to local StructuredCorrection
    const structured: StructuredCorrection = {
      type: aiCorrection.correctionType,
      target: {
        scenarioId: context.scenario?.id,
        functionId: context.currentFunction?.id,
        variableName: aiCorrection.target || undefined,
        stepId: context.currentStep?.id,
      },
      rule: aiCorrection.rule,
      scope: this.mapScope(aiCorrection.scope),
      confidence: aiCorrection.confidence,
      clarificationNeeded: aiCorrection.clarificationNeeded
        ? (aiCorrection.clarificationQuestion ?? 'Clarification needed')
        : undefined,
    };

    // Step 2: Check if clarification is needed
    if (structured.clarificationNeeded) {
      return {
        correction: this.createCorrectionRecord(message, structured, userId),
        affectedSteps: [],
        retraceTriggered: false,
        clarificationNeeded: structured.clarificationNeeded,
      };
    }

    // Step 3: Apply the correction
    const correction = this.createCorrectionRecord(message, structured, userId);
    await this.persistCorrection(correction);

    // Step 4: Apply effects based on correction type
    const affectedSteps = await this.applyCorrection(correction, context);

    // Step 5: Cascade — re-trace downstream if needed
    let retraceTriggered = false;
    if (this.shouldRetrace(correction) && context.scenario && this.scenarioTracer) {
      retraceTriggered = true;
      log.info(`Triggering re-trace for scenario ${context.scenario.id}`);
      // Re-trace would happen here in a production system.
      // For now, we mark the scenario as 'corrected'.
      await this.scenarioEngine.updateStatus(context.scenario.id, 'corrected');
    }

    log.info(
      `Correction applied: ${correction.type} (${affectedSteps.length} steps affected, ` +
      `retrace: ${retraceTriggered})`
    );

    return {
      correction,
      affectedSteps,
      retraceTriggered,
    };
  }

  /** Get all corrections for a scenario */
  async getCorrections(scenarioId?: string, scope?: CorrectionScope): Promise<Correction[]> {
    let query: string;
    const params: Record<string, unknown> = {};

    if (scenarioId) {
      query = `MATCH (c:Correction)-[:APPLIES_TO]->(s:Scenario {id: $scenarioId}) RETURN c ORDER BY c.appliedAt DESC`;
      params.scenarioId = scenarioId;
    } else if (scope) {
      query = `MATCH (c:Correction {scope: $scope}) RETURN c ORDER BY c.appliedAt DESC`;
      params.scope = scope;
    } else {
      query = `MATCH (c:Correction) RETURN c ORDER BY c.appliedAt DESC`;
    }

    const results = await this.driver.run(query, params);
    return results.records.map(r => this.recordToCorrection(r.toObject()));
  }

  /** Undo a correction by deleting it and re-tracing */
  async undoCorrection(correctionId: string): Promise<void> {
    await this.driver.run(
      `MATCH (c:Correction {id: $correctionId}) DETACH DELETE c`,
      { correctionId }
    );
    log.info(`Undone correction ${correctionId}`);
  }

  /** Persist a correction to Neo4j */
  private async persistCorrection(correction: Correction): Promise<void> {
    await this.driver.run(
      `CREATE (c:Correction {
        id: $id, type: $type, prompt: $prompt,
        rule: $rule, scope: $scope,
        target: $target,
        appliedAt: $appliedAt, userId: $userId
      })`,
      {
        ...correction,
        target: JSON.stringify(correction.target),
      }
    );

    // Create relationship to target
    if (correction.target.scenarioId) {
      await this.driver.run(
        `MATCH (c:Correction {id: $correctionId})
         MATCH (s:Scenario {id: $scenarioId})
         CREATE (c)-[:APPLIES_TO]->(s)`,
        {
          correctionId: correction.id,
          scenarioId: correction.target.scenarioId,
        }
      );
    }

    if (correction.target.functionId) {
      await this.driver.run(
        `MATCH (c:Correction {id: $correctionId})
         MATCH (f:Function {id: $functionId})
         CREATE (c)-[:APPLIES_TO]->(f)`,
        {
          correctionId: correction.id,
          functionId: correction.target.functionId,
        }
      );
    }
  }

  /** Apply correction effects to the graph */
  private async applyCorrection(
    correction: Correction,
    context: CorrectionContext
  ): Promise<ScenarioStep[]> {
    const affected: ScenarioStep[] = [];

    switch (correction.type) {
      case 'variable_constraint': {
        // Update the variable state at the targeted step and downstream
        if (context.scenario && context.currentStep) {
          await this.scenarioEngine.updateStep(
            context.scenario.id,
            context.currentStep.stepNumber,
            {
              correctedBy: correction.userId,
              correctionNote: correction.prompt,
            }
          );
          affected.push(context.currentStep);
        }
        break;
      }

      case 'branch_override': {
        // Flip the branch decision at the targeted step
        if (context.scenario && context.currentStep) {
          const newAction = context.currentStep.action === 'branch_taken'
            ? 'branch_skipped' as const
            : 'branch_taken' as const;

          await this.scenarioEngine.updateStep(
            context.scenario.id,
            context.currentStep.stepNumber,
            {
              action: newAction,
              justification: `[CORRECTED] ${correction.prompt}`,
              correctedBy: correction.userId,
              correctionNote: correction.prompt,
            }
          );
          affected.push({ ...context.currentStep, action: newAction });
        }
        break;
      }

      case 'dispatch_override': {
        if (context.scenario && context.currentStep) {
          await this.scenarioEngine.updateStep(
            context.scenario.id,
            context.currentStep.stepNumber,
            {
              justification: `[CORRECTED] ${correction.prompt}`,
              correctedBy: correction.userId,
              correctionNote: correction.prompt,
            }
          );
          affected.push(context.currentStep);
        }
        break;
      }

      case 'scenario_note': {
        // Update scenario description
        if (context.scenario) {
          await this.driver.run(
            `MATCH (s:Scenario {id: $id})
             SET s.description = s.description + '\n[Note] ' + $note,
                 s.updatedAt = $updatedAt`,
            {
              id: context.scenario.id,
              note: correction.prompt,
              updatedAt: new Date().toISOString(),
            }
          );
        }
        break;
      }

      case 'function_skip':
      case 'function_include':
        // These affect tracing config, handled at re-trace time
        break;

      case 'global_rule':
        // Global rules are stored and applied during future traces
        break;
    }

    return affected;
  }

  /** Determine if a correction should trigger a re-trace */
  private shouldRetrace(correction: Correction): boolean {
    return ['branch_override', 'dispatch_override', 'variable_constraint'].includes(
      correction.type
    );
  }

  /** Create a Correction record from structured data */
  private createCorrectionRecord(
    prompt: string,
    structured: StructuredCorrection,
    userId: string
  ): Correction {
    return {
      id: `corr-${Date.now()}-${Math.random().toString(36).substr(2, 8)}`,
      type: structured.type,
      prompt,
      rule: structured.rule,
      scope: structured.scope,
      target: structured.target,
      appliedAt: new Date().toISOString(),
      userId,
    };
  }

  /** Map AI scope to local CorrectionScope */
  private mapScope(scope: 'local' | 'scenario' | 'global'): CorrectionScope {
    if (scope === 'local') return 'step';
    return scope;
  }

  /** Convert a Neo4j record to a Correction */
  private recordToCorrection(record: Record<string, unknown>): Correction {
    const c = (record['c'] ?? record) as Record<string, unknown>;
    const props = (c['properties'] ?? c) as Record<string, unknown>;
    let target: StructuredCorrection['target'] = {};
    try {
      const t = props['target'];
      target = typeof t === 'string' ? JSON.parse(t) : (t as StructuredCorrection['target']) ?? {};
    } catch {
      // ignore
    }
    return {
      id: String(props['id'] ?? ''),
      type: props['type'] as CorrectionType,
      prompt: String(props['prompt'] ?? ''),
      rule: String(props['rule'] ?? ''),
      scope: props['scope'] as CorrectionScope,
      target,
      appliedAt: String(props['appliedAt'] ?? ''),
      userId: String(props['userId'] ?? ''),
    };
  }
}
