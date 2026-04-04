/**
 * Types — mirrors the CLI JSON output shapes.
 *
 * These are kept intentionally minimal — just what the extension UI needs.
 * The source of truth for types is @codegraph/core; these are the JSON
 * representations we get back from `codegraph` CLI commands.
 *
 * @module types
 */

/** Scenario as returned by `codegraph view <id> --format json` */
export interface Scenario {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'traced' | 'validated' | 'corrected';
  confidence: number;
  entryFunction: string;
  triggerCondition: string;
  discoveredBy: 'ai' | 'human';
  version: number;
  stepCount?: number;
  createdAt: string;
  updatedAt: string;
}

/** Step within a scenario trace */
export interface ScenarioStep {
  stepNumber: number;
  functionName: string;
  functionId: string;
  line: number;
  action: 'call' | 'branch_taken' | 'branch_skipped' | 'dispatch' | 'return' | 'assign';
  sourceCode: string | null;
  justification: string;
  confidence: number;
  variableState: Record<string, unknown>;
  correctedBy?: string | null;
  correctionNote?: string | null;
}

/** Full scenario view (scenario + steps) from CLI JSON output */
export interface ScenarioView {
  scenario: Scenario;
  steps: ScenarioStep[];
}

/** Function node as returned by `codegraph functions --format json` */
export interface FunctionInfo {
  id: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  returnType: string;
  parameters: { name: string; type: string; isOptional: boolean }[];
  isAsync: boolean;
  isExported: boolean;
  visibility: string;
  documentation?: string;
}
