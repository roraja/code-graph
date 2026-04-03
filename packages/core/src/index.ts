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

// --- Graph Layer ---
export { GraphDriver } from './graph/driver.js';
export { GraphSchema } from './graph/schema.js';
export { CodeIndexer } from './graph/indexer.js';
export { QueryEngine } from './graph/queries.js';

// --- AI Layer ---
export { AIAgent, type AIProvider, type AIConfig } from './ai/agent.js';
export { ScenarioDiscoveryAgent } from './ai/scenario-discovery.js';
export { PathTracerAgent } from './ai/path-tracer.js';
export { VariableImaginerAgent } from './ai/variable-imaginer.js';
export { JustifierAgent } from './ai/justifier.js';
export { CorrectionInterpreterAgent } from './ai/correction-interpreter.js';

// --- Scenario Layer ---
export { ScenarioEngine, type Scenario, type ScenarioStep } from './scenario/engine.js';
export { ScenarioTracer, type TraceConfig } from './scenario/tracer.js';

// --- Correction Layer ---
export {
  CorrectionEngine,
  type Correction,
  type CorrectionType,
  type StructuredCorrection,
} from './correction/engine.js';

// --- Config ---
export { loadConfig, type CodeGraphConfig } from './config/loader.js';

// --- Logger ---
export { logger } from './config/logger.js';
