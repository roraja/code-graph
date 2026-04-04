/**
 * Core Bridge — direct JS API bridge to @codegraph/core.
 *
 * Replaces the old CLI bridge that shelled out to `codegraph` CLI.
 * Now imports the CodeGraphClient directly from @codegraph/core and
 * calls its methods in-process — no child processes, no JSON parsing.
 *
 * @module core-bridge
 */

import * as vscode from 'vscode';
import {
  createCodeGraphClient,
  type CodeGraphClient,
  type ScenarioView,
  type CallRelation,
} from '@codegraph/core';
import type { Scenario, ScenarioStep, FunctionNode } from '@codegraph/core';
import { log, logEntry, logExit, logError } from './logger.js';

/** Re-export types so the rest of the extension imports from here or @codegraph/core. */
export type { Scenario, ScenarioStep, ScenarioView, CallRelation, FunctionNode as FunctionInfo };

/** The singleton client instance. */
let client: CodeGraphClient | null = null;

/** Whether we've determined the live DB is available. */
let dbAvailable: boolean | undefined;

/**
 * Get the workspace root folder path.
 */
function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Get or create the CodeGraphClient singleton.
 * On first call, probes the database; if unreachable, falls back to mock.
 */
async function getClient(): Promise<CodeGraphClient> {
  logEntry('coreBridge.getClient');
  if (client) {
    log('debug', 'coreBridge.getClient: returning cached client');
    logExit('coreBridge.getClient', 'cached');
    return client;
  }

  const projectRoot = getWorkspaceRoot();

  // First try live mode
  if (dbAvailable === undefined) {
    log('info', 'Probing live database availability...');
    const probe = createCodeGraphClient({ projectRoot });
    try {
      const available = await probe.isAvailable();
      if (available) {
        dbAvailable = true;
        client = probe;
        log('info', 'Live database is available');
        logExit('coreBridge.getClient', 'live');
        return client;
      } else {
        dbAvailable = false;
        await probe.dispose();
        log('warn', 'Live database is NOT available, using mock mode');
      }
    } catch (err) {
      dbAvailable = false;
      await probe.dispose();
      const msg = err instanceof Error ? err.message : String(err);
      log('warn', 'Live database is NOT available, using mock mode', {
        reason: msg.substring(0, 200),
      });
    }
  }

  // Use mock mode
  if (!dbAvailable) {
    client = createCodeGraphClient({ projectRoot, mock: true });
    log('debug', 'coreBridge.getClient: created mock client');
    logExit('coreBridge.getClient', 'mock');
    return client;
  }

  // Live mode (dbAvailable === true but client was disposed)
  client = createCodeGraphClient({ projectRoot });
  await client.connect();
  log('debug', 'coreBridge.getClient: reconnected live client');
  logExit('coreBridge.getClient', 'reconnected');
  return client;
}

/**
 * Reset the DB availability cache and dispose the current client.
 * Call after config changes or to force re-probe.
 */
export async function resetConnection(): Promise<void> {
  logEntry('coreBridge.resetConnection');
  dbAvailable = undefined;
  if (client) {
    await client.dispose();
    client = null;
  }
  logExit('coreBridge.resetConnection');
}

/**
 * Dispose the client. Call on extension deactivation.
 */
export async function dispose(): Promise<void> {
  logEntry('coreBridge.dispose');
  if (client) {
    await client.dispose();
    client = null;
  }
  logExit('coreBridge.dispose');
}

// ---------------------------------------------------------------------------
// Public API — mirrors the old cli-bridge signatures
// ---------------------------------------------------------------------------

/**
 * List all scenarios.
 */
export async function listScenarios(): Promise<Scenario[]> {
  logEntry('coreBridge.listScenarios');
  try {
    const c = await getClient();
    const scenarios = await c.listScenarios();
    logExit('coreBridge.listScenarios', { count: scenarios.length });
    return scenarios;
  } catch (err) {
    logError('coreBridge.listScenarios', err);
    return [];
  }
}

/**
 * Get a full scenario view (scenario + steps) by ID.
 */
export async function getScenarioView(
  scenarioId: string,
): Promise<ScenarioView | null> {
  logEntry('coreBridge.getScenarioView', { scenarioId });
  try {
    const c = await getClient();
    const view = await c.getScenarioView(scenarioId);
    if (view) {
      logExit('coreBridge.getScenarioView', { found: true, stepCount: view.steps.length });
    } else {
      logExit('coreBridge.getScenarioView', { found: false });
    }
    return view;
  } catch (err) {
    logError('coreBridge.getScenarioView', err);
    return null;
  }
}

/**
 * List functions in the graph.
 */
export async function listFunctions(
  search?: string,
): Promise<FunctionNode[]> {
  logEntry('coreBridge.listFunctions', { search });
  try {
    const c = await getClient();
    const result = await c.listFunctions(search);
    logExit('coreBridge.listFunctions', { count: result.length });
    return result;
  } catch (err) {
    logError('coreBridge.listFunctions', err);
    return [];
  }
}

/**
 * Get scenarios that include a specific function.
 */
export async function getScenariosForFunction(
  functionName: string,
): Promise<Scenario[]> {
  logEntry('coreBridge.getScenariosForFunction', { functionName });
  try {
    const c = await getClient();
    const matching = await c.getScenariosForFunction(functionName);
    logExit('coreBridge.getScenariosForFunction', { count: matching.length });
    return matching;
  } catch (err) {
    logError('coreBridge.getScenariosForFunction', err);
    return [];
  }
}

/**
 * Find all functions that call the given function.
 */
export async function getCallers(
  functionName: string,
): Promise<CallRelation[]> {
  logEntry('coreBridge.getCallers', { functionName });
  try {
    const c = await getClient();
    const callers = await c.getCallers(functionName);
    logExit('coreBridge.getCallers', { count: callers.length });
    return callers;
  } catch (err) {
    logError('coreBridge.getCallers', err);
    return [];
  }
}

/**
 * Find all functions called by the given function.
 */
export async function getCallees(
  functionName: string,
): Promise<CallRelation[]> {
  logEntry('coreBridge.getCallees', { functionName });
  try {
    const c = await getClient();
    const callees = await c.getCallees(functionName);
    logExit('coreBridge.getCallees', { count: callees.length });
    return callees;
  } catch (err) {
    logError('coreBridge.getCallees', err);
    return [];
  }
}

/**
 * Discover scenarios starting from a function.
 */
export async function discoverFromFunction(
  functionName: string,
): Promise<void> {
  logEntry('coreBridge.discoverFromFunction', { functionName });
  try {
    const c = await getClient();
    const discovered = await c.discoverFromFunction(functionName, 3);
    log('debug', 'coreBridge.discoverFromFunction: discovered scenarios', {
      count: discovered.length,
      names: discovered.map((d) => d.name),
    });
    logExit('coreBridge.discoverFromFunction', { count: discovered.length });
    vscode.window.showInformationMessage(
      `CodeGraph: Discovered and traced ${discovered.length} scenario(s) from ${functionName}.`,
    );
  } catch (err) {
    logError('coreBridge.discoverFromFunction', err);
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(
      `CodeGraph: Discovery failed — ${message}`,
    );
  }
}

/**
 * Set the tags on a scenario, replacing any existing tags.
 */
export async function setTags(
  scenarioId: string,
  tags: string[],
): Promise<void> {
  logEntry('coreBridge.setTags', { scenarioId, tags });
  try {
    const c = await getClient();
    await c.setTags(scenarioId, tags);
    logExit('coreBridge.setTags');
  } catch (err) {
    logError('coreBridge.setTags', err);
  }
}

/**
 * Add tags to a scenario (merged with existing, no duplicates).
 */
export async function addTags(
  scenarioId: string,
  tags: string[],
): Promise<void> {
  logEntry('coreBridge.addTags', { scenarioId, tags });
  try {
    const c = await getClient();
    await c.addTags(scenarioId, tags);
    logExit('coreBridge.addTags');
  } catch (err) {
    logError('coreBridge.addTags', err);
  }
}

/**
 * Remove specific tags from a scenario.
 */
export async function removeTags(
  scenarioId: string,
  tags: string[],
): Promise<void> {
  logEntry('coreBridge.removeTags', { scenarioId, tags });
  try {
    const c = await getClient();
    await c.removeTags(scenarioId, tags);
    logExit('coreBridge.removeTags');
  } catch (err) {
    logError('coreBridge.removeTags', err);
  }
}

/**
 * Trace a scenario to generate step-by-step execution walkthrough.
 * Reads the entry function, follows calls, asks AI to decide branches
 * and virtual dispatch, and saves the resulting steps to the graph.
 *
 * @returns The trace result with steps and metrics, or null on failure.
 */
export async function traceScenario(
  scenarioId: string,
): Promise<{ steps: number; durationMs: number } | null> {
  logEntry('coreBridge.traceScenario', { scenarioId });
  try {
    const c = await getClient();
    const result = await c.traceScenario(scenarioId);
    const summary = {
      steps: result.steps.length,
      durationMs: result.durationMs,
    };
    logExit('coreBridge.traceScenario', summary);
    return summary;
  } catch (err) {
    logError('coreBridge.traceScenario', err);
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(
      `CodeGraph: Trace failed — ${message}`,
    );
    return null;
  }
}

/**
 * Check if the CodeGraph core is available and can initialize.
 * Always returns true since @codegraph/core is a direct dependency.
 */
export async function checkAvailability(): Promise<boolean> {
  logEntry('coreBridge.checkAvailability');
  try {
    log('info', 'CodeGraph core module loaded successfully');
    logExit('coreBridge.checkAvailability', true);
    return true;
  } catch (err) {
    logError('coreBridge.checkAvailability', err);
    logExit('coreBridge.checkAvailability', false);
    return false;
  }
}
