/**
 * Scenario File Reader — reads scenario JSON files from disk.
 *
 * Scenarios are stored as JSON files in `.vscode/code-graph/scenarios/`.
 * This reader replaces Neo4j-based scenario reads: once a scenario is
 * traced and saved to JSON, it can be read directly from disk without
 * a running database.
 *
 * Neo4j remains the source of truth during tracing/correction (write path),
 * but the read path is purely file-based.
 *
 * @module scenario/file-reader
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createModuleLogger } from '../config/logger.js';
import type { Scenario, ScenarioStep, CallStackFrame } from './engine.js';

const log = createModuleLogger('scenario-file-reader');

/** The subdirectory under the CodeGraph dir where scenario JSONs live */
const SCENARIOS_SUBDIR = 'scenarios';

/** The CodeGraph directory inside the target project */
const CODEGRAPH_DIR = '.vscode/code-graph';

/**
 * Shape of a scenario JSON file on disk.
 *
 * Matches the export format produced by `codegraph export --format json`
 * and accepted by `codegraph import`.
 */
interface ScenarioFileData {
  _format?: string;
  scenario: {
    id?: string;
    name: string;
    description: string;
    status?: string;
    confidence?: number;
    entryFunction: string;
    triggerCondition: string;
    discoveredBy?: 'ai' | 'human' | 'manual';
    version?: number;
    tags?: string[];
    createdAt?: string;
    updatedAt?: string;
  };
  steps?: Array<{
    id: string;
    stepNumber: number;
    functionId: string;
    functionName: string;
    line: number;
    action: string;
    sourceCode?: string | null;
    justification: string;
    confidence: number;
    variableState: Record<string, unknown>;
    correctedBy?: string | null;
    correctionNote?: string | null;
    callStack?: CallStackFrame[] | null;
  }>;
}

/**
 * ScenarioFileReader — reads scenarios and steps from JSON files on disk.
 *
 * Scans `<projectRoot>/.vscode/code-graph/scenarios/*.json` and parses
 * each file into Scenario + ScenarioStep[] objects, using the same types
 * as the Neo4j-based ScenarioEngine.
 */
export class ScenarioFileReader {
  private readonly scenariosDir: string;

  constructor(projectRoot: string) {
    this.scenariosDir = resolve(projectRoot, CODEGRAPH_DIR, SCENARIOS_SUBDIR);
  }

  /**
   * Get the scenarios directory path.
   */
  getScenariosDir(): string {
    return this.scenariosDir;
  }

  /**
   * List all scenarios from JSON files on disk.
   *
   * @param status - Optional status filter
   * @param tags - Optional tag filter (scenarios must have all specified tags)
   */
  listScenarios(
    status?: 'draft' | 'traced' | 'validated' | 'corrected',
    tags?: string[],
  ): Scenario[] {
    const files = this.getScenarioFiles();
    let scenarios: Scenario[] = [];

    for (const filePath of files) {
      try {
        const data = this.readScenarioFile(filePath);
        if (data) {
          scenarios.push(this.toScenario(data, filePath));
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`Skipping invalid scenario file ${filePath}: ${msg}`);
      }
    }

    // Apply status filter
    if (status) {
      scenarios = scenarios.filter(s => s.status === status);
    }

    // Apply tag filter
    if (tags && tags.length > 0) {
      const normalized = tags.map(t => {
        const trimmed = t.trim().toLowerCase();
        return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
      });
      scenarios = scenarios.filter(s =>
        normalized.every(filterTag =>
          s.tags.some(scenarioTag => scenarioTag === filterTag),
        ),
      );
    }

    // Sort by updatedAt descending (most recent first)
    scenarios.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return scenarios;
  }

  /**
   * Get a single scenario by ID.
   */
  getScenario(id: string): Scenario | null {
    const files = this.getScenarioFiles();

    for (const filePath of files) {
      try {
        const data = this.readScenarioFile(filePath);
        if (!data) continue;
        const scenario = this.toScenario(data, filePath);
        if (scenario.id === id) {
          return scenario;
        }
      } catch {
        // Skip invalid files
      }
    }

    return null;
  }

  /**
   * Get steps for a scenario by ID, optionally filtered by range.
   */
  getSteps(scenarioId: string, from?: number, to?: number): ScenarioStep[] {
    const files = this.getScenarioFiles();

    for (const filePath of files) {
      try {
        const data = this.readScenarioFile(filePath);
        if (!data) continue;
        const scenario = this.toScenario(data, filePath);
        if (scenario.id === scenarioId) {
          let steps = this.toSteps(data, scenarioId);

          if (from !== undefined) {
            steps = steps.filter(s => s.stepNumber >= from);
          }
          if (to !== undefined) {
            steps = steps.filter(s => s.stepNumber <= to);
          }

          return steps;
        }
      } catch {
        // Skip invalid files
      }
    }

    return [];
  }

  /**
   * Get a single step by scenario ID and step number.
   */
  getStep(scenarioId: string, stepNumber: number): ScenarioStep | null {
    const steps = this.getSteps(scenarioId);
    return steps.find(s => s.stepNumber === stepNumber) ?? null;
  }

  /**
   * Get scenarios that include a specific function (by name substring match).
   */
  getScenariosForFunction(functionName: string): Scenario[] {
    const allScenarios = this.listScenarios();
    const matching: Scenario[] = [];

    for (const scenario of allScenarios) {
      const steps = this.getSteps(scenario.id);
      const hasFunction = steps.some(
        step =>
          step.functionName === functionName ||
          step.functionName.includes(functionName) ||
          functionName.includes(step.functionName.split('.').pop() ?? ''),
      );
      if (hasFunction) {
        matching.push(scenario);
      }
    }

    return matching;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Get all JSON file paths in the scenarios directory.
   */
  private getScenarioFiles(): string[] {
    if (!existsSync(this.scenariosDir)) {
      log.debug(`Scenarios directory not found: ${this.scenariosDir}`);
      return [];
    }

    try {
      const entries = readdirSync(this.scenariosDir);
      return entries
        .filter(f => f.endsWith('.json'))
        .map(f => join(this.scenariosDir, f));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to read scenarios directory: ${msg}`);
      return [];
    }
  }

  /**
   * Read and parse a single scenario JSON file.
   */
  private readScenarioFile(filePath: string): ScenarioFileData | null {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as ScenarioFileData;

      // Validate minimal structure
      if (!data.scenario || !data.scenario.name) {
        log.warn(`Invalid scenario file (missing scenario.name): ${filePath}`);
        return null;
      }

      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to parse scenario file ${filePath}: ${msg}`);
      return null;
    }
  }

  /**
   * Convert parsed JSON data to a Scenario object.
   *
   * If the JSON doesn't include an `id`, one is generated from the name
   * (same kebab-case algorithm as ScenarioEngine).
   */
  private toScenario(data: ScenarioFileData, filePath: string): Scenario {
    const s = data.scenario;
    const now = new Date().toISOString();

    // Generate ID from name if not provided
    const id = s.id ?? this.generateId(s.name);

    // Normalize tags
    let tags: string[] = [];
    if (s.tags && Array.isArray(s.tags)) {
      tags = s.tags.map(t => {
        const trimmed = t.trim().toLowerCase();
        return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
      });
    }

    // Normalize discoveredBy (accept 'manual' as alias for 'human')
    const discoveredBy =
      s.discoveredBy === 'manual' ? 'human' : (s.discoveredBy ?? 'human');

    return {
      id,
      name: s.name,
      description: s.description ?? '',
      discoveredBy,
      confidence: s.confidence ?? 1.0,
      status: (s.status as Scenario['status']) ?? 'draft',
      entryFunction: s.entryFunction ?? '',
      triggerCondition: s.triggerCondition ?? '',
      tags,
      version: s.version ?? 1,
      createdAt: s.createdAt ?? now,
      updatedAt: s.updatedAt ?? now,
    };
  }

  /**
   * Convert parsed JSON steps to ScenarioStep objects.
   */
  private toSteps(data: ScenarioFileData, scenarioId: string): ScenarioStep[] {
    if (!data.steps || !Array.isArray(data.steps)) {
      return [];
    }

    return data.steps
      .map(s => ({
        id: s.id,
        scenarioId,
        stepNumber: s.stepNumber,
        functionId: s.functionId ?? '',
        functionName: s.functionName ?? '',
        line: s.line ?? 0,
        action: (s.action as ScenarioStep['action']) ?? 'call',
        justification: s.justification ?? '',
        variableState: s.variableState ?? {},
        correctedBy: s.correctedBy ?? undefined,
        correctionNote: s.correctionNote ?? undefined,
        sourceCode: s.sourceCode ?? undefined,
        confidence: s.confidence ?? 0,
        callStack: s.callStack ?? undefined,
      }))
      .sort((a, b) => a.stepNumber - b.stepNumber);
  }

  /**
   * Generate a kebab-case ID from a name.
   * Same algorithm as ScenarioEngine.generateId().
   */
  private generateId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 50);
  }
}
