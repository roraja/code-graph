/**
 * GraphQL Schema — type definitions for the CodeGraph API.
 *
 * Defines every type, query, mutation, input, and enum that the
 * Apollo Server instance exposes.  Uses the `gql` tag from
 * `graphql-tag` for editor highlighting and compile-time validation.
 *
 * @module server/graphql/schema
 */

import gql from 'graphql-tag';

/**
 * Complete GraphQL type definitions for the CodeGraph API.
 */
export const typeDefs = gql`
  # ------------------------------------------------------------------
  # Enums
  # ------------------------------------------------------------------

  """Lifecycle status of a scenario."""
  enum ScenarioStatus {
    draft
    traced
    validated
    corrected
  }

  """Type of a human correction."""
  enum CorrectionType {
    variable_constraint
    branch_override
    dispatch_override
    scenario_note
    function_skip
    function_include
    global_rule
  }

  """Scope to which a correction applies."""
  enum CorrectionScope {
    global
    scenario
    function
    step
  }

  """Action performed at a single scenario step."""
  enum StepAction {
    call
    branch_taken
    branch_skipped
    dispatch
    return
    assign
  }

  # ------------------------------------------------------------------
  # Object types
  # ------------------------------------------------------------------

  """A traced execution-path scenario through the codebase."""
  type Scenario {
    id: ID!
    name: String!
    description: String!
    discoveredBy: String!
    confidence: Float!
    status: ScenarioStatus!
    entryFunction: String!
    triggerCondition: String!
    version: Int!
    createdAt: String!
    updatedAt: String!
    steps: [ScenarioStep!]
  }

  """A single step in a scenario's traced execution path."""
  type ScenarioStep {
    id: ID!
    scenarioId: ID!
    stepNumber: Int!
    functionId: String!
    functionName: String!
    line: Int!
    action: StepAction!
    justification: String!
    variableState: String
    correctedBy: String
    correctionNote: String
    sourceCode: String
    confidence: Float!
    callStack: [CallStackFrame!]
  }

  """A single frame in the call stack at a given scenario step."""
  type CallStackFrame {
    depth: Int!
    functionId: String!
    functionName: String!
    filePath: String!
    line: Int!
    variables: String
  }

  """A variable value within a stack frame, with AI-generated metadata."""
  type FrameVariable {
    value: String!
    type: String!
    rationale: String!
    alternatives: [String!]!
    confidence: Float!
  }

  """A parsed function node stored in the graph."""
  type Function {
    id: ID!
    name: String!
    qualifiedName: String!
    filePath: String!
    startLine: Int!
    endLine: Int!
    signature: String!
    isAbstract: Boolean!
    isOverride: Boolean!
    visibility: String!
    language: String!
    sourceCode: String!
    returnType: String!
    isExported: Boolean!
    isAsync: Boolean!
    documentation: String
  }

  """A parsed class / interface node stored in the graph."""
  type Class {
    id: ID!
    name: String!
    qualifiedName: String!
    filePath: String!
    startLine: Int!
    endLine: Int!
    isAbstract: Boolean!
    isInterface: Boolean!
    language: String!
    documentation: String
  }

  """A branch (if / switch) in the source code."""
  type Branch {
    id: ID!
    type: String!
    condition: String!
    functionId: String!
    filePath: String!
    line: Int!
  }

  """A variable declaration / usage."""
  type Variable {
    id: ID!
    name: String!
    type: String!
    scope: String!
    filePath: String!
    line: Int!
    functionId: String
    classId: String
    initialValue: String
  }

  """A directed call-edge from one function to another."""
  type CallEdge {
    function: Function!
    filePath: String!
    line: Int!
    callExpression: String!
  }

  """A persisted human correction."""
  type Correction {
    id: ID!
    type: CorrectionType!
    prompt: String!
    rule: String!
    scope: CorrectionScope!
    appliedAt: String!
    userId: String!
  }

  """Result of an indexing operation."""
  type IndexJob {
    filesProcessed: Int!
    functionsIndexed: Int!
    classesIndexed: Int!
    callEdgesIndexed: Int!
    durationMs: Int!
  }

  """Result of tracing a scenario."""
  type TraceResult {
    scenarioId: ID!
    stepsCreated: Int!
    functionsTraversed: Int!
    branchDecisions: Int!
    dispatchesResolved: Int!
    durationMs: Int!
  }

  """Result of submitting a correction."""
  type CorrectionResult {
    correction: Correction!
    affectedSteps: [ScenarioStep!]!
    retraceTriggered: Boolean!
    clarificationNeeded: String
  }

  """Aggregate statistics for the graph database."""
  type Stats {
    totalNodes: Int!
    totalRelationships: Int!
    nodes: String!
    relationships: String!
  }

  # ------------------------------------------------------------------
  # Inputs
  # ------------------------------------------------------------------

  """Filter for listing scenarios."""
  input ScenarioFilter {
    status: ScenarioStatus
  }

  """Input for creating a new scenario."""
  input CreateScenarioInput {
    name: String!
    description: String!
    entryFunction: String!
    triggerCondition: String!
    discoveredBy: String
    confidence: Float
  }

  """Input for submitting a correction."""
  input CorrectionInput {
    message: String!
    scenarioId: String
    stepNumber: Int
    functionId: String
    userId: String
  }

  """Configuration for an index operation."""
  input IndexConfig {
    rootDirs: [String!]
    excludeDirs: [String!]
  }

  # ------------------------------------------------------------------
  # Queries
  # ------------------------------------------------------------------

  type Query {
    """List all scenarios, optionally filtered by status."""
    scenarios(filter: ScenarioFilter): [Scenario!]!

    """Get a single scenario by ID."""
    scenario(id: ID!): Scenario

    """Get walkthrough steps for a scenario."""
    scenarioSteps(scenarioId: ID!, from: Int, to: Int): [ScenarioStep!]!

    """Get a function by its unique ID."""
    function(id: ID!): Function

    """Find a function by its fully-qualified name."""
    functionByName(qualifiedName: String!): Function

    """Get functions that call the given function."""
    callers(functionId: ID!): [CallEdge!]!

    """Get functions called by the given function."""
    callees(functionId: ID!): [CallEdge!]!

    """Find call-chain paths between two functions."""
    callChain(fromId: ID!, toId: ID!, maxDepth: Int): [String!]!

    """Get the class hierarchy (parents + children) for a class."""
    classHierarchy(classId: ID!): [Class!]!

    """Find concrete implementations of an abstract method."""
    implementations(methodId: ID!): [Function!]!

    """Full-text search across function names."""
    searchFunctions(query: String!, limit: Int): [Function!]!

    """Search scenarios by name or description substring."""
    searchScenarios(query: String!): [Scenario!]!

    """List persisted corrections."""
    corrections(scenarioId: ID, scope: CorrectionScope): [Correction!]!

    """Get aggregate graph statistics."""
    stats: Stats!
  }

  # ------------------------------------------------------------------
  # Mutations
  # ------------------------------------------------------------------

  type Mutation {
    """Parse and index the codebase into Neo4j."""
    indexCodebase(config: IndexConfig): IndexJob!

    """Use AI to discover scenarios from the indexed codebase."""
    discoverScenarios(hint: String): [Scenario!]!

    """Create a new scenario manually."""
    createScenario(input: CreateScenarioInput!): Scenario!

    """Trace a scenario through the codebase."""
    traceScenario(scenarioId: ID!): TraceResult!

    """Submit a natural-language correction."""
    submitCorrection(input: CorrectionInput!): CorrectionResult!

    """Undo (delete) a previously-applied correction."""
    undoCorrection(correctionId: ID!): Boolean!

    """Delete a scenario and all its steps."""
    deleteScenario(id: ID!): Boolean!
  }
`;
