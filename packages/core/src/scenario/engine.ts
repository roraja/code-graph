/**
 * Scenario Engine — manages scenario lifecycle, storage, and querying.
 *
 * A "scenario" is a named, traced execution path through the code.
 * Example: "User drops a file onto a browser tab"
 *
 * Lifecycle: Draft → Traced → (Validated | Corrected) → Validated
 *
 * @module scenario/engine
 */

import type { GraphDriver } from '../graph/driver.js';
import type { QueryEngine } from '../graph/queries.js';
import { createModuleLogger } from '../config/logger.js';

const log = createModuleLogger('scenario');

/** Status values for a scenario */
export type ScenarioStatus = 'draft' | 'traced' | 'validated' | 'corrected';

/** A scenario represents a traced execution path through the codebase */
export interface Scenario {
  id: string;
  name: string;
  description: string;
  /** How this scenario was created */
  discoveredBy: 'ai' | 'human';
  /** AI confidence in this scenario (0.0 - 1.0) */
  confidence: number;
  status: ScenarioStatus;
  /** Qualified name of the entry function */
  entryFunction: string;
  /** What triggers this scenario (e.g., "User drags a file") */
  triggerCondition: string;
  /** Current version number */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** A single frame in the call stack at a given step */
export interface CallStackFrame {
  /** Depth in the call stack (0 = entry function) */
  depth: number;
  /** Function ID for this frame */
  functionId: string;
  /** Qualified function name */
  functionName: string;
  /** File path where the function is defined */
  filePath: string;
  /** Line number where execution is at in this frame */
  line: number;
  /** Variable values imagined by AI for this stack frame */
  variables: Record<string, FrameVariable>;
}

/** A variable value within a stack frame, with AI-generated metadata */
export interface FrameVariable {
  /** The imagined value as a display string */
  value: string;
  /** The declared or inferred type */
  type: string;
  /** AI explanation of why this value was chosen */
  rationale: string;
  /** Alternative possible values */
  alternatives: string[];
  /** Confidence in this imagined value (0.0 - 1.0) */
  confidence: number;
}

/** A single step in a scenario's execution trace */
export interface ScenarioStep {
  id: string;
  scenarioId: string;
  stepNumber: number;
  /** The function being executed at this step */
  functionId: string;
  functionName: string;
  /** Specific line within the function */
  line: number;
  /** What happens at this step */
  action: 'call' | 'branch_taken' | 'branch_skipped' | 'dispatch' | 'return' | 'assign';
  /** AI-generated explanation for this step */
  justification: string;
  /** Imagined variable values at this point */
  variableState: Record<string, unknown>;
  /** If corrected, who corrected it */
  correctedBy?: string;
  /** Human correction note */
  correctionNote?: string;
  /** The source code line */
  sourceCode?: string;
  /** Confidence in this step */
  confidence: number;
  /** The call stack at this step, from entry function (depth 0) to current (deepest) */
  callStack?: CallStackFrame[];
}

/** Input for creating a new scenario */
export interface CreateScenarioInput {
  name: string;
  description: string;
  entryFunction: string;
  triggerCondition: string;
  discoveredBy?: 'ai' | 'human';
  confidence?: number;
}

/**
 * ScenarioEngine — manages CRUD operations for scenarios and their steps.
 *
 * Works with the graph database to persist scenarios, supports versioning
 * for corrections, and provides query methods.
 */
export class ScenarioEngine {
  constructor(
    private driver: GraphDriver,
    private queryEngine: QueryEngine
  ) {}

  /**
   * Create a new scenario in the graph database.
   * The scenario starts in 'draft' status.
   */
  async createScenario(input: CreateScenarioInput): Promise<Scenario> {
    const id = this.generateId(input.name);
    const now = new Date().toISOString();

    const scenario: Scenario = {
      id,
      name: input.name,
      description: input.description,
      discoveredBy: input.discoveredBy ?? 'human',
      confidence: input.confidence ?? 1.0,
      status: 'draft',
      entryFunction: input.entryFunction,
      triggerCondition: input.triggerCondition,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    await this.driver.run(
      `CREATE (s:Scenario {
        id: $id, name: $name, description: $description,
        discoveredBy: $discoveredBy, confidence: $confidence,
        status: $status, entryFunction: $entryFunction,
        triggerCondition: $triggerCondition, version: $version,
        createdAt: $createdAt, updatedAt: $updatedAt
      })`,
      { ...scenario }
    );

    log.info(`Created scenario: ${scenario.name} (${scenario.id})`);
    return scenario;
  }

  /** Get a scenario by ID */
  async getScenario(id: string): Promise<Scenario | null> {
    const result = await this.driver.run(
      'MATCH (s:Scenario {id: $id}) RETURN s',
      { id }
    );
    if (result.records.length === 0) return null;
    return this.recordToScenario(result.records[0].toObject());
  }

  /** List all scenarios with optional status filter */
  async listScenarios(status?: ScenarioStatus): Promise<Scenario[]> {
    const query = status
      ? 'MATCH (s:Scenario {status: $status}) RETURN s ORDER BY s.updatedAt DESC'
      : 'MATCH (s:Scenario) RETURN s ORDER BY s.updatedAt DESC';

    const results = await this.driver.run(query, { status });
    return results.records.map(r => this.recordToScenario(r.toObject()));
  }

  /** Update a scenario's status */
  async updateStatus(id: string, status: ScenarioStatus): Promise<void> {
    await this.driver.run(
      `MATCH (s:Scenario {id: $id})
       SET s.status = $status, s.updatedAt = $updatedAt`,
      { id, status, updatedAt: new Date().toISOString() }
    );
    log.info(`Updated scenario ${id} status to ${status}`);
  }

  /**
   * Save a list of traced steps for a scenario.
   * Replaces any existing steps (for re-tracing after corrections).
   */
  async saveSteps(scenarioId: string, steps: Omit<ScenarioStep, 'scenarioId'>[]): Promise<void> {
    // Remove existing steps
    await this.driver.run(
      `MATCH (s:Scenario {id: $scenarioId})-[r:HAS_STEP]->(step:ScenarioStep)
       DETACH DELETE step`,
      { scenarioId }
    );

    // Create new steps with relationships
    for (const step of steps) {
      await this.driver.run(
        `MATCH (s:Scenario {id: $scenarioId})
         CREATE (step:ScenarioStep {
           id: $id, stepNumber: $stepNumber,
           functionId: $functionId, functionName: $functionName,
           line: $line, action: $action,
           justification: $justification,
           variableState: $variableState,
           correctedBy: $correctedBy,
           correctionNote: $correctionNote,
           sourceCode: $sourceCode,
           confidence: $confidence,
           callStack: $callStack
         })
         CREATE (s)-[:HAS_STEP {order: $stepNumber}]->(step)`,
        {
          scenarioId,
          ...step,
          variableState: JSON.stringify(step.variableState),
          correctedBy: step.correctedBy ?? null,
          correctionNote: step.correctionNote ?? null,
          sourceCode: step.sourceCode ?? null,
          callStack: step.callStack ? JSON.stringify(step.callStack) : null,
        }
      );
    }

    // Create NEXT relationships between consecutive steps
    for (let i = 0; i < steps.length - 1; i++) {
      await this.driver.run(
        `MATCH (s1:ScenarioStep {id: $fromId})
         MATCH (s2:ScenarioStep {id: $toId})
         CREATE (s1)-[:NEXT]->(s2)`,
        { fromId: steps[i]!.id, toId: steps[i + 1]!.id }
      );
    }

    // Update scenario status
    await this.updateStatus(scenarioId, 'traced');
    log.info(`Saved ${steps.length} steps for scenario ${scenarioId}`);
  }

  /** Get steps for a scenario, optionally filtered by range */
  async getSteps(scenarioId: string, from?: number, to?: number): Promise<ScenarioStep[]> {
    let query = `
      MATCH (s:Scenario {id: $scenarioId})-[:HAS_STEP]->(step:ScenarioStep)
    `;

    if (from !== undefined && to !== undefined) {
      query += ` WHERE step.stepNumber >= $from AND step.stepNumber <= $to`;
    } else if (from !== undefined) {
      query += ` WHERE step.stepNumber >= $from`;
    } else if (to !== undefined) {
      query += ` WHERE step.stepNumber <= $to`;
    }

    query += ` RETURN step ORDER BY step.stepNumber`;

    const results = await this.driver.run(query, { scenarioId, from, to });
    return results.records.map(r => this.recordToStep(r.toObject(), scenarioId));
  }

  /** Get a single step */
  async getStep(scenarioId: string, stepNumber: number): Promise<ScenarioStep | null> {
    const results = await this.driver.run(
      `MATCH (s:Scenario {id: $scenarioId})-[:HAS_STEP]->(step:ScenarioStep {stepNumber: $stepNumber})
       RETURN step`,
      { scenarioId, stepNumber }
    );
    if (results.records.length === 0) return null;
    return this.recordToStep(results.records[0].toObject(), scenarioId);
  }

  /** Update a single step (for corrections) */
  async updateStep(
    scenarioId: string,
    stepNumber: number,
    updates: Partial<Pick<ScenarioStep, 'action' | 'justification' | 'variableState' | 'correctedBy' | 'correctionNote' | 'confidence'>>
  ): Promise<void> {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { scenarioId, stepNumber };

    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        const paramKey = `update_${key}`;
        setClauses.push(`step.${key} = $${paramKey}`);
        params[paramKey] = key === 'variableState' ? JSON.stringify(value) : value;
      }
    }

    if (setClauses.length === 0) return;

    await this.driver.run(
      `MATCH (s:Scenario {id: $scenarioId})-[:HAS_STEP]->(step:ScenarioStep {stepNumber: $stepNumber})
       SET ${setClauses.join(', ')}`,
      params
    );
  }

  /** Delete a scenario and all its steps */
  async deleteScenario(id: string): Promise<void> {
    await this.driver.run(
      `MATCH (s:Scenario {id: $id})
       OPTIONAL MATCH (s)-[:HAS_STEP]->(step:ScenarioStep)
       DETACH DELETE step, s`,
      { id }
    );
    log.info(`Deleted scenario ${id}`);
  }

  /** Get scenarios that include a specific function */
  async getScenariosForFunction(functionId: string): Promise<Scenario[]> {
    const results = await this.driver.run(
      `MATCH (s:Scenario)-[:HAS_STEP]->(step:ScenarioStep {functionId: $functionId})
       RETURN DISTINCT s ORDER BY s.updatedAt DESC`,
      { functionId }
    );
    return results.records.map(r => this.recordToScenario(r.toObject()));
  }

  /** Generate a kebab-case ID from a name */
  private generateId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 50);
  }

  /** Convert a Neo4j record to a Scenario object */
  private recordToScenario(record: Record<string, unknown>): Scenario {
    const s = (record['s'] ?? record) as Record<string, unknown>;
    const props = (s['properties'] ?? s) as Record<string, unknown>;
    return {
      id: String(props['id'] ?? ''),
      name: String(props['name'] ?? ''),
      description: String(props['description'] ?? ''),
      discoveredBy: (props['discoveredBy'] as 'ai' | 'human') ?? 'human',
      confidence: Number(props['confidence'] ?? 1),
      status: (props['status'] as ScenarioStatus) ?? 'draft',
      entryFunction: String(props['entryFunction'] ?? ''),
      triggerCondition: String(props['triggerCondition'] ?? ''),
      version: Number(props['version'] ?? 1),
      createdAt: String(props['createdAt'] ?? ''),
      updatedAt: String(props['updatedAt'] ?? ''),
    };
  }

  /** Convert a Neo4j record to a ScenarioStep object */
  private recordToStep(record: Record<string, unknown>, scenarioId: string): ScenarioStep {
    const step = (record['step'] ?? record) as Record<string, unknown>;
    const props = (step['properties'] ?? step) as Record<string, unknown>;
    let variableState: Record<string, unknown> = {};
    try {
      const vs = props['variableState'];
      variableState = typeof vs === 'string' ? JSON.parse(vs) : (vs as Record<string, unknown>) ?? {};
    } catch {
      // ignore parse errors
    }

    let callStack: CallStackFrame[] | undefined;
    try {
      const cs = props['callStack'];
      if (cs) {
        callStack = typeof cs === 'string' ? JSON.parse(cs) : (cs as CallStackFrame[]);
      }
    } catch {
      // ignore parse errors
    }

    return {
      id: String(props['id'] ?? ''),
      scenarioId,
      stepNumber: Number(props['stepNumber'] ?? 0),
      functionId: String(props['functionId'] ?? ''),
      functionName: String(props['functionName'] ?? ''),
      line: Number(props['line'] ?? 0),
      action: (props['action'] as ScenarioStep['action']) ?? 'call',
      justification: String(props['justification'] ?? ''),
      variableState,
      correctedBy: props['correctedBy'] as string | undefined,
      correctionNote: props['correctionNote'] as string | undefined,
      sourceCode: props['sourceCode'] as string | undefined,
      confidence: Number(props['confidence'] ?? 0),
      callStack,
    };
  }
}
