/** Status of a scenario in the tracing lifecycle. */
export type ScenarioStatus = 'draft' | 'traced' | 'validated' | 'corrected';

/** Who discovered the scenario. */
export type DiscoveredBy = 'ai' | 'human';

/** Action type for a scenario step. */
export type StepAction =
  | 'call'
  | 'branch_taken'
  | 'branch_skipped'
  | 'dispatch'
  | 'return'
  | 'assign';

/** Type of correction a user can submit. */
export type CorrectionType =
  | 'variable_constraint'
  | 'branch_override'
  | 'dispatch_override'
  | 'scenario_note'
  | 'function_skip'
  | 'function_include'
  | 'global_rule';

/** Scope at which a correction applies. */
export type CorrectionScope = 'global' | 'scenario' | 'function' | 'step';

/** A traced execution scenario through the codebase. */
export interface Scenario {
  id: string;
  name: string;
  description: string;
  discoveredBy: DiscoveredBy;
  confidence: number;
  status: ScenarioStatus;
  entryFunction: string;
  triggerCondition: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  stepCount?: number;
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

/** A single step in a scenario execution trace. */
export interface ScenarioStep {
  id: string;
  scenarioId: string;
  stepNumber: number;
  functionId: string;
  functionName: string;
  line: number;
  action: StepAction;
  justification: string;
  variableState: Record<string, unknown>;
  correctedBy?: string;
  correctionNote?: string;
  sourceCode?: string;
  confidence: number;
  /** The call stack at this step, from entry function (depth 0) to current (deepest) */
  callStack?: CallStackFrame[];
}

/** A parsed function/method in the codebase. */
export interface FunctionNode {
  id: string;
  name: string;
  qualifiedName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  isAbstract: boolean;
  isOverride: boolean;
  visibility: 'public' | 'protected' | 'private' | 'default';
  language: string;
  sourceCode: string;
  returnType: string;
  isExported: boolean;
  isAsync: boolean;
  documentation?: string;
}

/** A function call relationship edge. */
export interface CallEdge {
  callerId: string;
  calleeId: string;
  calleeName: string;
  filePath: string;
  line: number;
  column: number;
  isVirtualDispatch: boolean;
  callExpression: string;
}

/** A branch node in the code (if/else/switch). */
export interface BranchNode {
  id: string;
  type: 'if' | 'else_if' | 'switch_case' | 'ternary' | 'logical_and' | 'logical_or';
  condition: string;
  functionId: string;
  filePath: string;
  line: number;
}

/** A persisted correction in the database. */
export interface Correction {
  id: string;
  type: CorrectionType;
  prompt: string;
  rule: string;
  scope: CorrectionScope;
  target: {
    scenarioId?: string;
    functionId?: string;
    variableName?: string;
    stepId?: string;
    branchId?: string;
    line?: number;
  };
  appliedAt: string;
  userId: string;
}

/** Result of applying a correction. */
export interface CorrectionResult {
  correction: Correction;
  affectedSteps: ScenarioStep[];
  retraceTriggered: boolean;
  clarificationNeeded?: string;
}

/** Graph data for visualization. */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** A node in the visualization graph. */
export interface GraphNode {
  id: string;
  label: string;
  type: 'function' | 'branch' | 'class';
  filePath: string;
  line?: number;
  sourceCode?: string;
  qualifiedName?: string;
  signature?: string;
}

/** An edge in the visualization graph. */
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  isVirtualDispatch?: boolean;
}

/** Database statistics. */
export interface DatabaseStats {
  functions: number;
  classes: number;
  calls: number;
  scenarios: number;
  branches: number;
  variables: number;
}
