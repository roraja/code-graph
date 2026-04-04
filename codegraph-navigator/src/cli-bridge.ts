/**
 * CLI Bridge — thin wrapper that shells out to the globally installed
 * `codegraph` CLI and parses the JSON output.
 *
 * This keeps the extension independent of @codegraph/core — it only
 * depends on the CLI being available in $PATH (or a configured path).
 *
 * All CLI calls go through {@link runCodeGraph} which handles:
 *   - workspace-relative execution (cwd)
 *   - JSON parsing
 *   - error handling + logging
 *
 * Strategy for listing scenarios:
 *   1. Try `codegraph view <id> --format json` against the live DB.
 *   2. If the live DB isn't available (no config, Neo4j down), fall back
 *      to `--mock` mode which returns built-in demo data.
 *   The CLI's `scenarios` command doesn't support `--format json`, and
 *   `query scenarios` doesn't exist, so we list by iterating `view`.
 *
 * @module cli-bridge
 */

import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import { log } from './logger.js';
import type { Scenario, ScenarioView, FunctionInfo } from './types.js';

/** Maximum time (ms) to wait for a CLI command */
const DEFAULT_TIMEOUT = 30_000;

/** Longer timeout for AI-heavy commands like discover */
const DISCOVER_TIMEOUT = 120_000;

/** Whether we've determined the live DB is available */
let dbAvailable: boolean | undefined;

/**
 * Get the codegraph binary path.
 * Users can override via settings; defaults to "codegraph" (in PATH).
 */
function getBinary(): string {
  const config = vscode.workspace.getConfiguration('codegraph');
  return config.get<string>('cliPath', 'codegraph');
}

/**
 * Get the workspace root folder path.
 */
function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Run a codegraph CLI command and return the raw stdout string.
 *
 * @param args - CLI arguments (e.g. ['view', 'id', '--format', 'json'])
 * @param timeoutMs - Max execution time in ms
 * @returns stdout as a string
 */
function runCodeGraph(
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT
): Promise<string> {
  const binary = getBinary();
  const cwd = getWorkspaceRoot();

  log('debug', `CLI exec: ${binary} ${args.join(' ')}`, { cwd, timeoutMs });

  return new Promise((resolve, reject) => {
    const child = execFile(
      binary,
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10 MB
        env: {
          ...process.env,
          // Force no color so JSON output is clean
          NO_COLOR: '1',
          FORCE_COLOR: '0',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const errMsg = `codegraph ${args.join(' ')} failed: ${error.message}`;
          const stderrSnippet = stderr?.substring(0, 1000) || '';
          log('error', errMsg, { stderr: stderrSnippet, exitCode: (error as NodeJS.ErrnoException).code });
          reject(new Error(`${errMsg}\n${stderrSnippet}`));
          return;
        }
        if (stderr) {
          log('warn', `CLI stderr`, { cmd: args.join(' '), stderr: stderr.substring(0, 500) });
        }
        log('debug', `CLI success: ${args.join(' ')}`, { stdoutLen: stdout.length });
        resolve(stdout);
      }
    );

    // Safety net: kill if execFile timeout doesn't fire
    setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs + 2000);
  });
}

/**
 * Parse JSON from CLI stdout. Handles cases where CLI writes
 * progress text before the JSON (e.g., ora spinners) and strips
 * ANSI escape codes that chalk may emit.
 */
function parseJSON<T>(stdout: string): T {
  const trimmed = stripAnsi(stdout).trim();

  // Try parsing the whole thing first
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Fall through
  }

  // Find the first JSON-starting character
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '{' || ch === '[') {
      try {
        return JSON.parse(trimmed.substring(i)) as T;
      } catch {
        continue;
      }
    }
  }

  throw new Error(`Could not parse JSON from CLI output (${trimmed.length} chars): ${trimmed.substring(0, 300)}`);
}

/**
 * Probe whether the live database is reachable by running
 * `codegraph view <id> --format json` without --mock.
 * Caches the result so we only probe once per session.
 */
async function probeDB(): Promise<boolean> {
  if (dbAvailable !== undefined) {
    return dbAvailable;
  }

  log('info', 'Probing live database availability...');
  try {
    // Try a quick view call without --mock
    await runCodeGraph(['view', 'probe-test', '--format', 'json'], 10_000);
    // If it doesn't throw, the DB is up (even if scenario not found, it exits 0 after connecting)
    dbAvailable = true;
    log('info', 'Live database is available');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Configuration error') || msg.includes('connect') || msg.includes('ECONNREFUSED')) {
      dbAvailable = false;
      log('warn', 'Live database is NOT available, using --mock mode', { reason: msg.substring(0, 200) });
    } else {
      // Could be "scenario not found" which is fine — DB is up
      dbAvailable = true;
      log('info', 'Live database appears available (got non-config error)');
    }
  }
  return dbAvailable;
}

/**
 * Reset the DB availability cache (e.g., after config changes).
 */
export function resetDBProbe(): void {
  dbAvailable = undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all scenarios.
 *
 * Strategy:
 *   1. If live DB is available, run `codegraph scenarios` and parse the
 *      table output for scenario IDs, then `view` each one.
 *   2. If live DB is not available, use --mock mode with known mock IDs.
 */
export async function listScenarios(): Promise<Scenario[]> {
  const useMock = !(await probeDB());

  if (useMock) {
    return listScenariosMock();
  }

  return listScenariosLive();
}

/**
 * List scenarios from live DB by parsing `codegraph scenarios` text output
 * and then loading each via `view --format json`.
 */
async function listScenariosLive(): Promise<Scenario[]> {
  log('info', 'Listing scenarios from live database');
  try {
    const stdout = await runCodeGraph(['scenarios']);
    log('debug', 'Raw scenarios output', { stdout: stdout.substring(0, 500) });
    // Parse the table output to extract scenario IDs from the first column.
    const ids = extractIdsFromTable(stdout);
    log('info', `Parsed ${ids.length} scenario ID(s) from table output`, { ids });

    if (ids.length === 0) {
      log('info', 'No scenarios found in live database');
      return [];
    }

    const scenarios: Scenario[] = [];
    for (const id of ids) {
      try {
        const view = await getScenarioView(id);
        if (view) {
          scenarios.push(view.scenario);
        }
      } catch (err) {
        log('warn', `Skipping scenario ${id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return scenarios;
  } catch (err) {
    log('error', 'Failed to list scenarios from live DB', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * List scenarios using --mock mode (built-in demo data).
 */
async function listScenariosMock(): Promise<Scenario[]> {
  log('info', 'Listing scenarios using --mock mode');
  const mockIds = ['user-login-flow', 'fetch-user-profile', 'rate-limit-check'];
  const scenarios: Scenario[] = [];

  for (const id of mockIds) {
    try {
      const view = await getScenarioViewMock(id);
      if (view) {
        scenarios.push(view.scenario);
      }
    } catch (err) {
      log('warn', `Mock scenario ${id} failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log('info', `Loaded ${scenarios.length} mock scenario(s)`);
  return scenarios;
}

/**
 * Strip ANSI escape codes from a string.
 * Chalk and ora emit these even when NO_COLOR is set in some environments.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

/**
 * Replicate the CLI's generateId logic: kebab-case from name, max 50 chars.
 */
function generateIdFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
}

/**
 * Extract scenario IDs from the CLI table output of `codegraph scenarios`.
 * The table uses cli-table3 with Unicode box-drawing characters (│ U+2502)
 * and may contain ANSI color codes.
 *
 * Because cli-table3 truncates long IDs with … (ellipsis), we also read
 * the Name column and regenerate the ID using the same algorithm as
 * ScenarioEngine.generateId().
 */
function extractIdsFromTable(tableOutput: string): string[] {
  const ids: string[] = [];
  const cleaned = stripAnsi(tableOutput);
  const lines = cleaned.split('\n');

  log('debug', 'Parsing table output for scenario IDs', {
    lineCount: lines.length,
    rawLength: tableOutput.length,
    cleanedSample: cleaned.substring(0, 300),
  });

  // cli-table3 with wordWrap can split a single row across multiple lines.
  // We need to collect multi-line cell content. A data row starts with
  // │ <content> │ ... and continuation lines also start with │ but have
  // empty first cells or continuation text.
  //
  // Strategy: collect all data lines (those with │ separators), group by
  // row (a new row starts when the first cell is non-empty and not the
  // header), and reconstruct the full Name for each row.

  const dataRows: { idCell: string; nameCell: string }[] = [];
  let currentRow: { idCell: string; nameParts: string[] } | null = null;

  for (const line of lines) {
    if (!line.includes('\u2502')) { continue; }

    const cells = line.split('\u2502').map(c => c.trim());
    // cells[0] is empty (before first │), cells[1] is ID column, cells[2] is Name, etc.
    if (cells.length < 3) { continue; }

    const idCell = cells[1] ?? '';
    const nameCell = cells[2] ?? '';

    // Skip border rows
    if (/[─═┌┐└┘┬┴├┤┼╔╗╚╝╠╣╦╩╬]/.test(idCell)) { continue; }
    // Skip header row
    if (idCell === 'ID') { continue; }

    if (idCell.length > 0) {
      // Start of a new data row
      if (currentRow) {
        dataRows.push({
          idCell: currentRow.idCell,
          nameCell: currentRow.nameParts.join(' '),
        });
      }
      currentRow = { idCell, nameParts: nameCell ? [nameCell] : [] };
    } else if (currentRow && nameCell) {
      // Continuation line — append to current row's name
      currentRow.nameParts.push(nameCell);
    }
  }
  // Flush last row
  if (currentRow) {
    dataRows.push({
      idCell: currentRow.idCell,
      nameCell: currentRow.nameParts.join(' '),
    });
  }

  for (const row of dataRows) {
    // If the ID cell is truncated (ends with …), regenerate from the name
    const isTruncated = row.idCell.endsWith('\u2026');
    let id: string;

    if (isTruncated && row.nameCell) {
      id = generateIdFromName(row.nameCell);
      log('debug', `Regenerated truncated ID from name: "${row.nameCell}" -> "${id}"`);
    } else {
      id = row.idCell;
    }

    if (id.length > 0) {
      ids.push(id);
      log('debug', `Found scenario ID: "${id}"`);
    }
  }

  return ids;
}

/**
 * Get a full scenario view (scenario + steps) by ID.
 * Tries live DB first, falls back to --mock.
 */
export async function getScenarioView(scenarioId: string): Promise<ScenarioView | null> {
  const useMock = !(await probeDB());

  if (useMock) {
    return getScenarioViewMock(scenarioId);
  }

  return getScenarioViewLive(scenarioId);
}

/**
 * Get scenario view from live DB.
 * Runs: `codegraph view <id> --format json`
 */
async function getScenarioViewLive(scenarioId: string): Promise<ScenarioView | null> {
  try {
    log('info', `Loading scenario from live DB: ${scenarioId}`);
    const stdout = await runCodeGraph(['view', scenarioId, '--format', 'json']);
    const result = parseJSON<ScenarioView>(stdout);
    log('info', `Loaded scenario: ${scenarioId}`, { stepCount: result.steps.length });
    return result;
  } catch (err) {
    log('error', `Failed to load scenario from live DB: ${scenarioId}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Get scenario view using --mock mode.
 * Runs: `codegraph view <id> --format json --mock`
 */
async function getScenarioViewMock(scenarioId: string): Promise<ScenarioView | null> {
  try {
    log('info', `Loading mock scenario: ${scenarioId}`);
    const stdout = await runCodeGraph(['view', scenarioId, '--format', 'json', '--mock']);
    const result = parseJSON<ScenarioView>(stdout);
    log('info', `Loaded mock scenario: ${scenarioId}`, { stepCount: result.steps.length });
    return result;
  } catch (err) {
    log('error', `Failed to load mock scenario: ${scenarioId}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * List functions in the graph.
 * Runs: `codegraph functions --format json [--mock]`
 */
export async function listFunctions(search?: string): Promise<FunctionInfo[]> {
  const useMock = !(await probeDB());

  try {
    const args = ['functions', '--format', 'json'];
    if (search) {
      args.push('--search', search);
    }
    if (useMock) {
      args.push('--mock');
    }
    log('info', 'Listing functions', { search, useMock });
    const stdout = await runCodeGraph(args);
    const result = parseJSON<FunctionInfo[]>(stdout);
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
 * Loads all scenarios and filters by checking step function names.
 */
export async function getScenariosForFunction(
  functionName: string
): Promise<Scenario[]> {
  log('info', `Finding scenarios for function: ${functionName}`);
  const allScenarios = await listScenarios();
  const matching: Scenario[] = [];

  for (const s of allScenarios) {
    try {
      const view = await getScenarioView(s.id);
      if (view?.steps.some(step =>
        step.functionName === functionName ||
        step.functionName.includes(functionName) ||
        functionName.includes(step.functionName.split('.').pop() ?? '')
      )) {
        matching.push(s);
      }
    } catch {
      // skip
    }
  }

  log('info', `Found ${matching.length} scenario(s) for function ${functionName}`);
  return matching;
}

/**
 * Discover scenarios starting from a function.
 * Runs: `codegraph discover --hint "starting from <functionName>"`
 */
export async function discoverFromFunction(functionName: string): Promise<void> {
  log('info', `Discovering scenarios from function: ${functionName}`);
  try {
    const stdout = await runCodeGraph(
      ['discover', '--hint', `Focus on scenarios starting from ${functionName}`, '--count', '3'],
      DISCOVER_TIMEOUT
    );
    log('info', 'Discovery complete', { output: stdout.substring(0, 500) });
    vscode.window.showInformationMessage(
      `CodeGraph: Discovery complete for ${functionName}. Refresh scenarios to see results.`
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'Discovery failed', { error: message });
    vscode.window.showErrorMessage(`CodeGraph: Discovery failed — ${message}`);
  }
}

/**
 * Check if codegraph CLI is available and log diagnostic info.
 */
export async function checkCLI(): Promise<boolean> {
  try {
    const stdout = await runCodeGraph(['--version'], 5000);
    log('info', 'CLI check passed', { version: stdout.trim() });
    return true;
  } catch (err) {
    log('error', 'codegraph CLI not available in PATH', {
      error: err instanceof Error ? err.message : String(err),
      binary: getBinary(),
    });
    return false;
  }
}
