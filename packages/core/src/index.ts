/**
 * @module @codegraph/core
 *
 * Core engine for CodeGraph — provides parsers, graph database integration,
 * AI agents, scenario management, and correction handling.
 */

// --- Parser Layer ---
export type {
  ICodeParser,
  ParseResult,
  FunctionNode,
  ClassNode,
  CallEdge,
  BranchNode,
  VariableNode,
  InheritanceEdge,
  DispatchResolution,
  CallSite,
  DispatchContext,
} from './parser/interface.js';
export { TypeScriptParser } from './parser/typescript.js';
export { CppParser, type CppParserConfig } from './parser/cpp.js';

// --- Graph Layer ---
export { GraphDriver } from './graph/driver.js';
export { GraphSchema } from './graph/schema.js';
export { CodeIndexer } from './graph/indexer.js';
export { QueryEngine, type CallRelation } from './graph/queries.js';

// --- AI Layer ---
export { AIAgent, createAIProvider, type AIProvider, type AIConfig } from './ai/agent.js';
export { CopilotCLIProvider, type CopilotCLIConfig } from './ai/copilot-cli-provider.js';
export { ScenarioDiscoveryAgent } from './ai/scenario-discovery.js';
export type {
  FunctionSummary,
  ScenarioDiscoveryInput,
  DiscoveredScenario,
  CallEdgeSummary,
  BranchSummary,
  ClassSummary,
  InheritanceSummary,
  CodebaseSummary,
} from './ai/scenario-discovery.js';
export { PathTracerAgent } from './ai/path-tracer.js';
export { VariableImaginerAgent } from './ai/variable-imaginer.js';
export { JustifierAgent } from './ai/justifier.js';
export { CorrectionInterpreterAgent } from './ai/correction-interpreter.js';

// --- Scenario Layer ---
export { ScenarioEngine, type Scenario, type ScenarioStep, type CallStackFrame, type FrameVariable } from './scenario/engine.js';
export { ScenarioTracer, type TraceConfig, type TraceResult } from './scenario/tracer.js';

// --- Correction Layer ---
export {
  CorrectionEngine,
  type Correction,
  type CorrectionType,
  type StructuredCorrection,
} from './correction/engine.js';

// --- Config ---
export { loadConfig, findProjectRoot, getCodeGraphDir, type CodeGraphConfig } from './config/loader.js';

// --- Logger ---
export { logger } from './config/logger.js';

// --- Public API (high-level facade) ---
export {
  createCodeGraphClient,
  CodeGraphClient,
  type CodeGraphClientOptions,
  type ScenarioView,
  type FunctionInfo,
} from './api.js';
