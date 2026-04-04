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
} from '@codegraph/core';
import type { Scenario, ScenarioStep, FunctionNode } from '@codegraph/core';
import { log } from './logger.js';

/** Re-export types so the rest of the extension imports from here or @codegraph/core. */
export type { Scenario, ScenarioStep, ScenarioView, FunctionNode as FunctionInfo };

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
  if (client) return client;

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
    return client;
  }

  // Live mode (dbAvailable === true but client was disposed)
  client = createCodeGraphClient({ projectRoot });
  await client.connect();
  return client;
}

/**
 * Reset the DB availability cache and dispose the current client.
 * Call after config changes or to force re-probe.
 */
export async function resetConnection(): Promise<void> {
  dbAvailable = undefined;
  if (client) {
    await client.dispose();
    client = null;
  }
}

/**
 * Dispose the client. Call on extension deactivation.
 */
export async function dispose(): Promise<void> {
  if (client) {
    await client.dispose();
    client = null;
  }
}

// ---------------------------------------------------------------------------
// Public API — mirrors the old cli-bridge signatures
// ---------------------------------------------------------------------------

/**
 * List all scenarios.
 */
export async function listScenarios(): Promise<Scenario[]> {
  try {
    const c = await getClient();
    const scenarios = await c.listScenarios();
    log('info', `Listed ${scenarios.length} scenario(s)`);
    return scenarios;
  } catch (err) {
    log('error', 'Failed to list scenarios', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Get a full scenario view (scenario + steps) by ID.
 */
export async function getScenarioView(
  scenarioId: string,
): Promise<ScenarioView | null> {
  try {
    const c = await getClient();
    const view = await c.getScenarioView(scenarioId);
    if (view) {
      log('info', `Loaded scenario: ${scenarioId}`, {
        stepCount: view.steps.length,
      });
    }
    return view;
  } catch (err) {
    log('error', `Failed to load scenario: ${scenarioId}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * List functions in the graph.
 */
export async function listFunctions(
  search?: string,
): Promise<FunctionNode[]> {
  try {
    const c = await getClient();
    const result = await c.listFunctions(search);
    log('info', `Listed ${result.length} functions`, { search });
    return result;
  } catch (err) {
    log('error', 'Failed to list functions', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Get scenarios that include a specific function.
 */
export async function getScenariosForFunction(
  functionName: string,
): Promise<Scenario[]> {
  try {
    log('info', `Finding scenarios for function: ${functionName}`);
    const c = await getClient();
    const matching = await c.getScenariosForFunction(functionName);
    log('info', `Found ${matching.length} scenario(s) for function ${functionName}`);
    return matching;
  } catch (err) {
    log('error', 'Failed to get scenarios for function', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Discover scenarios starting from a function.
 */
export async function discoverFromFunction(
  functionName: string,
): Promise<void> {
  log('info', `Discovering scenarios from function: ${functionName}`);
  try {
    const c = await getClient();
    const discovered = await c.discoverFromFunction(functionName, 3);
    log('info', `Discovery complete: ${discovered.length} scenario(s)`, {
      names: discovered.map((d) => d.name),
    });
    vscode.window.showInformationMessage(
      `CodeGraph: Discovery complete for ${functionName}. ` +
        `Found ${discovered.length} scenario(s). Refresh to see results.`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'Discovery failed', { error: message });
    vscode.window.showErrorMessage(
      `CodeGraph: Discovery failed — ${message}`,
    );
  }
}

/**
 * Check if the CodeGraph core is available and can initialize.
 * Always returns true since @codegraph/core is a direct dependency.
 */
export async function checkAvailability(): Promise<boolean> {
  try {
    // The module is imported — that means it's available.
    // We'll probe the DB separately during first use.
    log('info', 'CodeGraph core module loaded successfully');
    return true;
  } catch (err) {
    log('error', '@codegraph/core not available', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
